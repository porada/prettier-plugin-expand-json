import type { Parser, ParserOptions, Plugin } from 'prettier';
import type { ParserName } from './types/index.d.ts';
import { parsers as babelParsers } from 'prettier/plugins/babel';
import * as pluginEstree from 'prettier/plugins/estree';
import {
	callParserWithCompatibility,
	createPriorParserResolver,
	markParserAsExpandJSON,
	withPriorParserOptions,
} from './plugin-hooks/index.ts';
import printExpandedJSON from './print-expanded-json/index.ts';

const estreeOptions = (pluginEstree as Plugin).options!;
const { printers: estreePrinters } = pluginEstree;

const EXPANDED_ESTREE_FORMAT = 'estree-expand-json';

function createParser(name: ParserName): Parser {
	async function parse(
		text: string,
		options: ParserOptions
	): Promise<unknown> {
		const resolvedPriorParser = await resolvePriorParser(options, 'parse');
		const priorParser = resolvedPriorParser?.parser;

		if (
			resolvedPriorParser &&
			priorParser &&
			typeof priorParser.parse === 'function' &&
			priorParser.parse !== parse
		) {
			return withPriorParserOptions(
				options,
				resolvedPriorParser,
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

	const preprocess: NonNullable<Parser['preprocess']> = async (
		text: string,
		options: ParserOptions
	) => {
		const resolvedPriorParser = await resolvePriorParser(
			options,
			'preprocess'
		);

		const priorParser = resolvedPriorParser?.parser;
		const priorPreprocess = priorParser?.preprocess;

		if (
			resolvedPriorParser &&
			priorParser &&
			typeof priorPreprocess === 'function' &&
			priorPreprocess !== preprocess
		) {
			return withPriorParserOptions(
				options,
				resolvedPriorParser,
				(delegatedOptions): Promise<string> | string =>
					priorPreprocess.call(priorParser, text, delegatedOptions)
			);
		}

		return text;
	};

	const parser: Parser = {
		...babelParsers[name],
		astFormat:
			name === 'json-stringify'
				? babelParsers[name].astFormat
				: EXPANDED_ESTREE_FORMAT,
		parse,
		preprocess,
	};

	const resolvePriorParser = createPriorParserResolver(
		name,
		babelParsers[name].astFormat,
		parser
	);

	return markParserAsExpandJSON(parser);
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

export const options: Plugin['options'] = { ...estreeOptions };
