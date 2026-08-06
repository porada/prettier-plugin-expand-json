import type { Parser, ParserOptions, Plugin } from 'prettier';
import { format } from 'prettier';
import { parsers as babelParsers } from 'prettier/plugins/babel';
import { printers as estreePrinters } from 'prettier/plugins/estree';
import { expect, test, vi } from 'vite-plus/test';
import * as pluginExpandJSON from '../index.ts';
import { createPriorParserResolver } from './index.ts';

const TEST_JSON = '{"foo":[1]}';

function getConcreteParser(
	plugin: typeof pluginExpandJSON,
	parserName: 'json' | 'jsonc'
): Parser {
	const parser = plugin.parsers?.[parserName];

	if (!parser || typeof parser === 'function') {
		throw new TypeError(`Expected a concrete \`${parserName}\` parser.`);
	}

	return parser;
}

test('returns `undefined` without a prior parser', async () => {
	const resolvePriorParser = createPriorParserResolver(
		'json',
		babelParsers.json.parse,
		babelParsers.json.astFormat
	);
	const options = {
		plugins: [null, 'missing-plugin', { parsers: { json: undefined } }],
	} as unknown as ParserOptions;

	await expect(resolvePriorParser(options)).resolves.toBeUndefined();
});

test.each(['json', 'jsonc'] as const)(
	'supports independently loaded plugin copies with the `%s` parser',
	async (parserName) => {
		vi.resetModules();

		const firstPlugin = await import('../index.ts');

		vi.resetModules();

		const secondPlugin = await import('../index.ts');
		const firstParser = getConcreteParser(firstPlugin, parserName);
		const secondParser = getConcreteParser(secondPlugin, parserName);

		expect(firstParser.parse).not.toBe(secondParser.parse);

		const singleCopyOutput = await format(TEST_JSON, {
			parser: parserName,
			plugins: [secondPlugin],
		});

		const duplicateCopyOutput = await format(TEST_JSON, {
			parser: parserName,
			plugins: [firstPlugin, secondPlugin],
		});

		expect(duplicateCopyOutput).toBe(singleCopyOutput);
	}
);

test('rejects prior parsers with incompatible AST formats', async () => {
	const customPlugin: Plugin = {
		parsers: {
			json: {
				astFormat: 'custom-json',
				locEnd: () => TEST_JSON.length,
				locStart: () => 0,
				parse: () => ({ type: 'CustomJSON' }),
			},
		},
		printers: {
			'custom-json': {
				print: () => 'CUSTOM',
			},
		},
	};

	await expect(
		format(TEST_JSON, {
			parser: 'json',
			plugins: [customPlugin, pluginExpandJSON],
		})
	).rejects.toThrow(
		'prettier-plugin-expand-json cannot compose with the `json` parser because it uses the `custom-json` AST format instead of `estree`.'
	);
});

test('passes compatible options to prior parsers', async () => {
	let hasMatchingPrinter = false;
	let observedAstFormat: unknown;
	let observedPrintWidth: number | undefined;
	const observingPlugin: Plugin = {
		parsers: {
			jsonc: {
				...babelParsers.jsonc,
				parse: (text, options) => {
					observedAstFormat = options.astFormat;
					observedPrintWidth = options.printWidth;
					hasMatchingPrinter =
						options.astFormat === 'estree' &&
						options.plugins.includes(observingPlugin);
					return babelParsers.jsonc.parse(text, options);
				},
			},
		},
		printers: {
			estree: estreePrinters.estree,
		},
	};

	await format(TEST_JSON, {
		parser: 'jsonc',
		plugins: [observingPlugin, pluginExpandJSON],
		printWidth: 80,
	});

	expect(hasMatchingPrinter).toBe(true);
	expect(observedAstFormat).toBe('estree');
	expect(observedPrintWidth).toBe(80);
});

test('shares options between prior `preprocess` and `parse` hooks', async () => {
	const statefulPlugin: Plugin = {
		parsers: {
			json: {
				...babelParsers.json,
				parse: (_text, options) =>
					babelParsers.json.parse(
						JSON.stringify({
							foo: options.expandJSONState === true,
						}),
						options
					),
				preprocess: (text, options) => {
					options.expandJSONState = true;
					return text;
				},
			},
		},
	};

	const output = await format(TEST_JSON, {
		parser: 'json',
		plugins: [statefulPlugin, pluginExpandJSON],
	});

	expect(output).toMatchInlineSnapshot(`
		"{
		  "foo": true
		}
		"
	`);
});

test('ignores plugins with an `undefined` parser map', async () => {
	const output = await format(TEST_JSON, {
		parser: 'json',
		plugins: [
			/* prettier-ignore */
			{ parsers: undefined },
			pluginExpandJSON,
		],
	});

	expect(output).toMatchInlineSnapshot(`
		"{
		  "foo": [
		    1
		  ]
		}
		"
	`);
});

test('reuses a resolved lazy parser between hooks', async () => {
	let initializationCount = 0;
	const lazyPlugin = {
		parsers: {
			json: async () => {
				initializationCount += 1;
				let preprocessed = false;
				await Promise.resolve();

				return {
					...babelParsers.json,
					parse: (_text: string, options: ParserOptions) =>
						babelParsers.json.parse(
							JSON.stringify({ foo: preprocessed }),
							options
						),
					preprocess: (text: string) => {
						preprocessed = true;
						return text;
					},
				};
			},
		},
	} as unknown as Plugin;

	const output = await format(TEST_JSON, {
		parser: 'json',
		plugins: [lazyPlugin, pluginExpandJSON],
	});

	expect(initializationCount).toBe(1);
	expect(output).toMatchInlineSnapshot(`
		"{
		  "foo": true
		}
		"
	`);
});

test('passes the compatibility options argument to prior parsers', async () => {
	let receivedDuplicatedOptions = false;
	const legacyPlugin: Plugin = {
		parsers: {
			json: {
				...babelParsers.json,
				parse: (
					text: string,
					options: ParserOptions,
					compatibilityOptions?: ParserOptions
				) => {
					receivedDuplicatedOptions =
						compatibilityOptions === options;
					return babelParsers.json.parse(
						text,
						compatibilityOptions ?? options
					);
				},
			},
		},
	};

	await format(TEST_JSON, {
		parser: 'json',
		plugins: [legacyPlugin, pluginExpandJSON],
	});

	expect(receivedDuplicatedOptions).toBe(true);
});
