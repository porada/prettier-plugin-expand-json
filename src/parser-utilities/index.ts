import type { Parser, ParserOptions } from 'prettier';
import type {
	ParserName,
	ParseWithCompatibility,
	PluginWithParsers,
} from '../types/index.d.ts';

const EXPAND_JSON_PARSER_MARKER = Symbol.for(
	'prettier-plugin-expand-json.parser'
);

export function markParserAsExpandJSON(parser: Parser): Parser {
	Object.defineProperty(parser, EXPAND_JSON_PARSER_MARKER, { value: true });
	return parser;
}

function isExpandJSONParser(parser: Parser): boolean {
	return Reflect.get(parser, EXPAND_JSON_PARSER_MARKER) === true;
}

export function callParserWithCompatibility(
	parser: Parser,
	text: string,
	options: ParserOptions
): unknown {
	const parse = parser.parse as ParseWithCompatibility;
	return parse.call(parser, text, options, options);
}

export function createPriorParserResolver(
	name: ParserName,
	currentParse: Parser['parse'],
	expectedAstFormat: string
): (options: ParserOptions) => Promise<Parser | undefined> {
	const priorParserByOptions = new WeakMap<
		ParserOptions,
		Promise<Parser | undefined>
	>();

	return async (options) => {
		const cachedParser = priorParserByOptions.get(options);

		if (cachedParser) {
			return cachedParser;
		}

		const parser = findPriorParser(
			name,
			options,
			currentParse,
			expectedAstFormat
		);
		priorParserByOptions.set(options, parser);
		return parser;
	};
}

async function findPriorParser(
	name: ParserName,
	options: ParserOptions,
	currentParse: Parser['parse'],
	expectedAstFormat: string
): Promise<Parser | undefined> {
	for (const plugin of options.plugins.toReversed()) {
		if (!hasParsers(plugin) || !Object.hasOwn(plugin.parsers, name)) {
			continue;
		}

		const parserOrInitializer = plugin.parsers[name];

		if (!parserOrInitializer) {
			continue;
		}

		const parser =
			typeof parserOrInitializer === 'function'
				? await parserOrInitializer()
				: parserOrInitializer;

		if (parser.parse === currentParse || isExpandJSONParser(parser)) {
			continue;
		}

		assertCompatibleParser(name, parser, expectedAstFormat);
		return parser;
	}

	return undefined;
}

function assertCompatibleParser(
	name: ParserName,
	parser: Parser,
	expectedAstFormat: string
): void {
	if (parser.astFormat !== expectedAstFormat) {
		throw new TypeError(
			`prettier-plugin-expand-json cannot compose with the \`${name}\` parser because it uses the \`${parser.astFormat}\` AST format instead of \`${expectedAstFormat}\`.`
		);
	}
}

function hasParsers(plugin: unknown): plugin is PluginWithParsers {
	if (!plugin || typeof plugin !== 'object') {
		return false;
	}

	const { parsers } = plugin as { parsers?: unknown };
	return typeof parsers === 'object' && parsers !== null;
}

export async function withPriorParserOptions<T>(
	name: ParserName,
	options: ParserOptions,
	currentParse: Parser['parse'],
	priorParser: Parser,
	callback: (options: ParserOptions) => T
): Promise<Awaited<T>> {
	const { astFormat, plugins } = options;
	options.astFormat = priorParser.astFormat;
	options.plugins = plugins.filter((plugin) => {
		if (!hasParsers(plugin) || !Object.hasOwn(plugin.parsers, name)) {
			return true;
		}

		const parserOrInitializer = plugin.parsers[name];
		return (
			typeof parserOrInitializer === 'function' ||
			parserOrInitializer?.parse !== currentParse
		);
	});

	try {
		return await callback(options);
	} finally {
		options.astFormat = astFormat;
		options.plugins = plugins;
	}
}
