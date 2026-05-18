import type { Parser, ParserOptions, Plugin } from 'prettier';
import type { ParserName, PluginWithParsers } from './types/index.d.ts';
import { parsers as babelParsers } from 'prettier/plugins/babel';
import { printers as estreePrinters } from 'prettier/plugins/estree';

function createParser(name: ParserName): Parser {
	const parse: Parser['parse'] = async (
		text: string,
		options: ParserOptions
	) => {
		const priorParser = findPriorParser(name, options, parse);

		// Force the JSONC printer to wrap all lines
		if (name === 'jsonc') {
			options.printWidth = 1;
		}

		/* oxlint-disable-next-line typescript/no-unsafe-return */
		return typeof priorParser?.parse === 'function'
			? await priorParser.parse(
					text,
					omitCurrentParser(name, options, parse)
				)
			: babelParsers[name].parse(text, options);
	};

	const preprocess: NonNullable<Parser['preprocess']> = async (
		text: string,
		options: ParserOptions
	) => {
		const priorParser = findPriorParser(name, options, parse);

		if (typeof priorParser?.preprocess === 'function') {
			return priorParser.preprocess(
				text,
				omitCurrentParser(name, options, parse)
			);
		}

		return text;
	};

	return {
		...babelParsers[name],
		astFormat: name === 'jsonc' ? 'estree' : 'estree-json',
		parse,
		preprocess,
	};
}

function findPriorParser(
	name: ParserName,
	options: ParserOptions,
	currentParse: Parser['parse']
): Parser | undefined {
	for (const plugin of options.plugins.toReversed()) {
		if (!hasParsers(plugin)) {
			continue;
		}

		const parser = plugin.parsers[name];

		if (parser && parser.parse !== currentParse) {
			return parser;
		}
	}

	/* v8 ignore next -- @preserve */
	return undefined;
}

function hasParsers(plugin: unknown): plugin is PluginWithParsers {
	/* v8 ignore if -- @preserve */
	if (!plugin) {
		return false;
	}

	return typeof plugin === 'object' && Object.hasOwn(plugin, 'parsers');
}

function omitCurrentParser(
	name: ParserName,
	options: ParserOptions,
	currentParse: Parser['parse']
): ParserOptions {
	return {
		...options,
		plugins: options.plugins.filter((plugin) => {
			if (!hasParsers(plugin)) {
				return true;
			}

			const parser = plugin.parsers[name];
			return !(parser && parser.parse === currentParse);
		}),
	};
}

export const parsers: Plugin['parsers'] = {
	'json': createParser('json'),
	'json-stringify': createParser('json-stringify'),
	'jsonc': createParser('jsonc'),
};

export const printers: Plugin['printers'] = {
	'estree': estreePrinters.estree,
	'estree-json': estreePrinters['estree-json'],
};
