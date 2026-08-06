import type { Parser, ParserOptions, Plugin } from 'prettier';
import type { ParserName } from './types/index.d.ts';
import { parsers as babelParsers } from 'prettier/plugins/babel';
import { printers as estreePrinters } from 'prettier/plugins/estree';
import {
	callParserWithCompatibility,
	createPriorParserResolver,
	markParserAsExpandJSON,
	withPriorParserOptions,
} from './parser-utilities/index.ts';
import printExpandedJSON from './print-expanded-json/index.ts';

const EXPANDED_ESTREE_FORMAT = 'estree-expand-json';

function createParser(name: ParserName): Parser {
	async function parse(
		text: string,
		options: ParserOptions
	): Promise<unknown> {
		const priorParser = await resolvePriorParser(options);

		if (priorParser) {
			return withPriorParserOptions(
				name,
				options,
				parse,
				priorParser,
				(delegatedOptions) =>
					callParserWithCompatibility(
						priorParser,
						text,
						delegatedOptions
					)
			);
		}

		return await babelParsers[name].parse(text, options);
	}

	const resolvePriorParser = createPriorParserResolver(
		name,
		parse,
		babelParsers[name].astFormat
	);

	const preprocess: NonNullable<Parser['preprocess']> = async (
		text: string,
		options: ParserOptions
	) => {
		const priorParser = await resolvePriorParser(options);
		const priorPreprocess = priorParser?.preprocess;

		if (priorParser && typeof priorPreprocess === 'function') {
			return withPriorParserOptions(
				name,
				options,
				parse,
				priorParser,
				(delegatedOptions): Promise<string> | string =>
					priorPreprocess.call(priorParser, text, delegatedOptions)
			);
		}

		return text;
	};

	return markParserAsExpandJSON({
		...babelParsers[name],
		astFormat:
			name === 'json-stringify'
				? babelParsers[name].astFormat
				: EXPANDED_ESTREE_FORMAT,
		parse,
		preprocess,
	});
}

export const parsers: Plugin['parsers'] = {
	'json': createParser('json'),
	'json-stringify': createParser('json-stringify'),
	'jsonc': createParser('jsonc'),
};

export const printers: Plugin['printers'] = {
	[EXPANDED_ESTREE_FORMAT]: {
		...estreePrinters.estree,
		print: printExpandedJSON,
	},
	'estree-json': estreePrinters['estree-json'],
};
