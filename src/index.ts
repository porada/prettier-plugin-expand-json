import type { Parser, ParserOptions, Plugin } from 'prettier';
import { applyEdits, format } from 'jsonc-parser';
import { parsers as babelParsers } from 'prettier/plugins/babel';
import { printers as estreePrinters } from 'prettier/plugins/estree';

type ParserName = keyof typeof babelParsers;

type ParserPlugin = Omit<Plugin, 'parsers'> & {
	parsers: NonNullable<Plugin['parsers']>;
};

function createParser(name: ParserName): Parser {
	const parse: Parser['parse'] = async (
		text: string,
		options: ParserOptions
	) => {
		const priorParser = findPriorParser(name, options, parse, preprocess);

		/* oxlint-disable-next-line typescript/no-unsafe-return */
		return typeof priorParser?.parse === 'function'
			? await priorParser.parse(text, options)
			: babelParsers[name].parse(text, options);
	};

	const preprocess: NonNullable<Parser['preprocess']> = async (
		text: string,
		options: ParserOptions
	) => {
		const priorParser = findPriorParser(name, options, parse, preprocess);

		if (typeof priorParser?.preprocess === 'function') {
			/* oxlint-disable-next-line eslint/no-param-reassign */
			text = await priorParser.preprocess(text, options);
		}

		// This is where the actual expansion happens
		const edits = format(text, undefined, {
			insertSpaces: !options.useTabs,
			tabSize: options.tabWidth,
		});

		return applyEdits(text, edits);
	};

	return {
		...babelParsers[name],
		astFormat: 'estree-json',
		parse,
		preprocess,
	};
}

function findPriorParser(
	name: ParserName,
	options: ParserOptions,
	ownParser: Parser['parse'],
	ownPreprocessor: Parser['preprocess']
): Parser | undefined {
	const plugins = options.plugins ?? [];

	for (const plugin of plugins.toReversed()) {
		if (!isParserPlugin(plugin)) {
			continue;
		}

		const parser = plugin.parsers[name];

		if (
			parser &&
			parser.parse !== ownParser &&
			parser.preprocess !== ownPreprocessor
		) {
			return parser;
		}
	}

	return undefined;
}

function isParserPlugin(plugin: unknown): plugin is ParserPlugin {
	if (!plugin) {
		return false;
	}

	return typeof plugin === 'object' && Object.hasOwn(plugin, 'parsers');
}

export const parsers: Plugin['parsers'] = {
	'json': createParser('json'),
	'json-stringify': createParser('json-stringify'),
	'jsonc': createParser('jsonc'),
};

// Necessary for comment support in JSONC files
const { canAttachComment, isBlockComment, printComment } =
	estreePrinters.estree;

export const printers: Plugin['printers'] = {
	'estree-json': {
		...estreePrinters['estree-json'],
		canAttachComment,
		isBlockComment,
		printComment,
	},
};
