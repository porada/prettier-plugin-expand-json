import type { Parser, ParserOptions, Plugin } from 'prettier';
import { format } from 'prettier';
import { parsers as babelParsers } from 'prettier/plugins/babel';
import { printers as estreePrinters } from 'prettier/plugins/estree';
import { expect, test, vi } from 'vite-plus/test';
import * as pluginExpandJSON from '../index.ts';
import { createPriorParserResolver, withPriorParserOptions } from './index.ts';

const TEST_JSON = '{"foo":[1]}';

function getDirectParser(
	plugin: typeof pluginExpandJSON,
	parserName: 'json' | 'jsonc'
): Parser {
	const parser = plugin.parsers?.[parserName];

	if (!parser || typeof parser === 'function') {
		throw new TypeError(`Expected a direct \`${parserName}\` parser.`);
	}

	return parser;
}

function createJSONWrapperPlugin(parser: Parser): Plugin {
	return {
		parsers: { json: parser },
		printers: pluginExpandJSON.printers,
	};
}

test('returns `undefined` without a prior parser', async () => {
	const resolvePriorParser = createPriorParserResolver(
		'json',
		babelParsers.json.astFormat,
		getDirectParser(pluginExpandJSON, 'json')
	);

	const options = {
		plugins: [
			null,
			'missing-plugin',
			{ parsers: undefined },
			{ parsers: { json: undefined } },
		],
	} as unknown as ParserOptions;

	await expect(resolvePriorParser(options, 'parse')).resolves.toBeUndefined();
	await expect(resolvePriorParser(options, 'parse')).resolves.toBeUndefined();
});

test('doesn’t resolve canonical parsers for aliased exports', async () => {
	const currentParser = getDirectParser(pluginExpandJSON, 'jsonc');
	const initializeCanonicalParser = vi.fn(async (): Promise<Parser> => {
		await Promise.resolve();
		return babelParsers.jsonc;
	});

	const canonicalPlugin = {
		parsers: { jsonc: initializeCanonicalParser },
	} as unknown as Plugin;

	const aliasPlugin: Plugin = {
		parsers: { 'jsonc-alias': currentParser },
	};

	const resolvePriorParser = createPriorParserResolver(
		'jsonc',
		babelParsers.jsonc.astFormat,
		currentParser
	);

	const options = {
		parser: 'jsonc-alias',
		plugins: [canonicalPlugin, aliasPlugin],
	} as unknown as ParserOptions;

	await expect(resolvePriorParser(options, 'parse')).resolves.toBeUndefined();

	expect(initializeCanonicalParser).not.toHaveBeenCalled();
});

test('preserves the selected parser name between hooks', async () => {
	const currentParser = getDirectParser(pluginExpandJSON, 'json');
	const priorParser: Parser = {
		...babelParsers.json,
		preprocess: (text) => text,
	};

	const priorPlugin: Plugin = { parsers: { json: priorParser } };

	const resolvePriorParser = createPriorParserResolver(
		'json',
		babelParsers.json.astFormat,
		currentParser
	);

	const options = {
		parser: 'json',
		plugins: [priorPlugin, pluginExpandJSON],
	} as unknown as ParserOptions;

	await expect(
		resolvePriorParser(options, 'preprocess')
	).resolves.toMatchObject({ parser: priorParser });

	options.parser = 'jsonc';

	await expect(resolvePriorParser(options, 'parse')).resolves.toMatchObject({
		parser: priorParser,
	});
});

test('sets and restores prior parser location functions', async () => {
	const currentParser = getDirectParser(pluginExpandJSON, 'json');

	const locEnd: Parser['locEnd'] = (node) => babelParsers.json.locEnd(node);
	const locStart: Parser['locStart'] = (node) =>
		babelParsers.json.locStart(node);

	const priorParser: Parser = {
		...babelParsers.json,
		locEnd,
		locStart,
	};

	const plugins: ParserOptions['plugins'] = [];

	const options = {
		astFormat: currentParser.astFormat,
		locEnd: currentParser.locEnd,
		locStart: currentParser.locStart,
		plugins: [pluginExpandJSON],
	} as unknown as ParserOptions;

	const originalPlugins = options.plugins;

	await withPriorParserOptions(
		options,
		{ locationState: {}, parser: priorParser, plugins },
		async (delegatedOptions) => {
			await Promise.resolve();
			expect(delegatedOptions.locEnd).toBe(locEnd);
			expect(delegatedOptions.locStart).toBe(locStart);
		}
	);

	expect(options.locEnd).toBe(currentParser.locEnd);
	expect(options.locStart).toBe(currentParser.locStart);
	expect(options.plugins).toBe(originalPlugins);
});

test('preserves plugin lists reassigned by prior parsers', async () => {
	const currentParser = getDirectParser(pluginExpandJSON, 'json');
	const reassignedPlugins: ParserOptions['plugins'] = [];

	const options = {
		astFormat: currentParser.astFormat,
		locEnd: currentParser.locEnd,
		locStart: currentParser.locStart,
		plugins: [pluginExpandJSON],
	} as unknown as ParserOptions;

	await withPriorParserOptions(
		options,
		{
			locationState: {},
			parser: babelParsers.json,
			plugins: [],
		},
		async (delegatedOptions) => {
			await Promise.resolve();
			delegatedOptions.plugins = reassignedPlugins;
		}
	);

	expect(options.plugins).toBe(reassignedPlugins);
});

test.each(['json', 'jsonc'] as const)(
	'works with independently loaded plugin copies using the `%s` parser',
	async (parserName) => {
		vi.resetModules();

		const firstPlugin = await import('../index.ts');

		vi.resetModules();

		const secondPlugin = await import('../index.ts');
		const firstParser = getDirectParser(firstPlugin, parserName);
		const secondParser = getDirectParser(secondPlugin, parserName);

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
	).rejects.toThrowErrorMatchingInlineSnapshot(
		`[TypeError: [prettier-plugin-expand-json] Unsupported AST format for the \`json\` parser. Expected \`estree\` or \`estree-expand-json\`, received \`custom-json\`]`
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
	let observedState = false;

	const locEnd: Parser['locEnd'] = (node) => babelParsers.json.locEnd(node);
	const locStart: Parser['locStart'] = (node) =>
		babelParsers.json.locStart(node);

	const statefulPlugin: Plugin = {
		parsers: {
			json: {
				...babelParsers.json,
				parse: (text, options) => {
					observedState =
						options.expandJSONState === true &&
						options.locEnd === locEnd &&
						options.locStart === locStart;
					return babelParsers.json.parse(text, options);
				},
				preprocess: async (text, options) => {
					await Promise.resolve();
					options.expandJSONState = true;
					options.locEnd = locEnd;
					options.locStart = locStart;
					return text;
				},
			},
		},
	};

	await format(TEST_JSON, {
		parser: 'json',
		plugins: [statefulPlugin, pluginExpandJSON],
	});

	expect(observedState).toBe(true);
});

test('ignores plugins with an `undefined` parser map', async () => {
	const expectedOutput = await format(TEST_JSON, {
		parser: 'json',
		plugins: [pluginExpandJSON],
	});

	const output = await format(TEST_JSON, {
		parser: 'json',
		plugins: [
			/* prettier-ignore */
			{ parsers: undefined },
			pluginExpandJSON,
		],
	});

	expect(output).toBe(expectedOutput);
});

test('preserves parser lifecycle state after plugin list reassignment', async () => {
	let initializationCount = 0;
	let observedLifecycleState = false;

	const locEnd: Parser['locEnd'] = (node) => babelParsers.json.locEnd(node);
	const locStart: Parser['locStart'] = (node) =>
		babelParsers.json.locStart(node);

	const lazyPlugin = {
		parsers: {
			json: async () => {
				initializationCount += 1;
				let preprocessed = false;
				await Promise.resolve();

				return {
					...babelParsers.json,
					parse: (text: string, options: ParserOptions) => {
						observedLifecycleState =
							preprocessed &&
							options.locEnd === locEnd &&
							options.locStart === locStart;
						return babelParsers.json.parse(text, options);
					},
					preprocess: (text: string, options: ParserOptions) => {
						preprocessed = true;
						options.locEnd = locEnd;
						options.locStart = locStart;
						options.plugins = [...options.plugins];
						return text;
					},
				};
			},
		},
	} as unknown as Plugin;

	await format(TEST_JSON, {
		parser: 'json',
		plugins: [lazyPlugin, pluginExpandJSON],
	});

	expect(initializationCount).toBe(1);
	expect(observedLifecycleState).toBe(true);
});

test('omits resolved lazy plugin copies from prior parser options', async () => {
	const parser = getDirectParser(pluginExpandJSON, 'json');

	let initializationCount = 0;
	let observedDuplicate = false;

	const lazyPlugin = {
		parsers: {
			json: async () => {
				initializationCount += 1;
				await Promise.resolve();
				return parser;
			},
		},
	} as unknown as Plugin;

	const observingPlugin: Plugin = {
		parsers: {
			json: {
				...babelParsers.json,
				parse: (text, options) => {
					observedDuplicate = options.plugins.includes(lazyPlugin);
					return babelParsers.json.parse(text, options);
				},
			},
		},
	};

	await format(TEST_JSON, {
		parser: 'json',
		plugins: [observingPlugin, lazyPlugin, pluginExpandJSON],
	});

	expect(initializationCount).toBe(1);
	expect(observedDuplicate).toBe(false);
});

test('doesn’t initialize shadowed lazy parsers', async () => {
	let initializationCount = 0;

	const lazyPlugin = {
		parsers: {
			json: async () => {
				initializationCount += 1;
				await Promise.resolve();
				return babelParsers.json;
			},
		},
	} as unknown as Plugin;

	const priorPlugin: Plugin = {
		parsers: {
			json: { ...babelParsers.json },
		},
	};

	await format(TEST_JSON, {
		parser: 'json',
		plugins: [lazyPlugin, priorPlugin, pluginExpandJSON],
	});

	expect(initializationCount).toBe(0);
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

test('handles wrappers that copy the current parser hooks', async () => {
	const parser = getDirectParser(pluginExpandJSON, 'json');
	const wrapperPlugin = createJSONWrapperPlugin({ ...parser });

	const expectedOutput = await format(TEST_JSON, {
		parser: 'json',
		plugins: [pluginExpandJSON],
	});

	const output = await format(TEST_JSON, {
		parser: 'json',
		plugins: [wrapperPlugin, pluginExpandJSON],
	});

	expect(output).toBe(expectedOutput);
});

test('continues to prior parsers through copied wrappers', async () => {
	const parser = getDirectParser(pluginExpandJSON, 'json');

	const priorPlugin: Plugin = {
		parsers: {
			json: {
				...babelParsers.json,
				preprocess: () => '{"foo":["prior"]}\n',
			},
		},
	};

	const wrapperPlugin = createJSONWrapperPlugin({ ...parser });

	const expectedOutput = await format(TEST_JSON, {
		parser: 'json',
		plugins: [priorPlugin, pluginExpandJSON],
	});

	const output = await format(TEST_JSON, {
		parser: 'json',
		plugins: [priorPlugin, wrapperPlugin, pluginExpandJSON],
	});

	expect(output).toBe(expectedOutput);
});

test('avoids recursion through wrappers that inherit from the current parser', async () => {
	const parser = getDirectParser(pluginExpandJSON, 'json');
	let parseCallCount = 0;

	const wrapperParser = {
		parse: (text: string, options: ParserOptions) => {
			parseCallCount += 1;

			if (parseCallCount > 1) {
				throw new Error();
			}

			return parser.parse(text, options);
		},
	} as unknown as Parser;

	Object.setPrototypeOf(wrapperParser, parser);

	const wrapperPlugin = createJSONWrapperPlugin(wrapperParser);

	const expectedOutput = await format(TEST_JSON, {
		parser: 'json',
		plugins: [wrapperPlugin],
	});

	const output = await format(TEST_JSON, {
		parser: 'json',
		plugins: [wrapperPlugin, pluginExpandJSON],
	});

	expect(output).toBe(expectedOutput);
	expect(parseCallCount).toBe(1);
});

test('handles wrappers that reuse the current `parse` function', async () => {
	const parser = getDirectParser(pluginExpandJSON, 'json');
	const wrapperPlugin = createJSONWrapperPlugin({
		...parser,
		preprocess: () => '{"foo":["copied"]}\n',
	});

	const expectedOutput = await format(TEST_JSON, {
		parser: 'json',
		plugins: [wrapperPlugin],
	});

	const output = await format(TEST_JSON, {
		parser: 'json',
		plugins: [wrapperPlugin, pluginExpandJSON],
	});

	expect(output).toBe(expectedOutput);
});

test('rejects incompatible wrappers before skipping shared hooks', async () => {
	const parser = getDirectParser(pluginExpandJSON, 'json');

	const wrapperPlugin = createJSONWrapperPlugin({
		...parser,
		astFormat: 'incompatible-json',
		preprocess: undefined,
	});

	await expect(
		format(TEST_JSON, {
			parser: 'json',
			plugins: [wrapperPlugin, pluginExpandJSON],
		})
	).rejects.toThrowErrorMatchingInlineSnapshot(
		`[TypeError: [prettier-plugin-expand-json] Unsupported AST format for the \`json\` parser. Expected \`estree\` or \`estree-expand-json\`, received \`incompatible-json\`]`
	);
});

test('avoids recursion through wrappers that copy `preprocess`', async () => {
	const parser = getDirectParser(pluginExpandJSON, 'json');
	const wrapperPlugin = createJSONWrapperPlugin({
		...parser,
		parse: (text, options) => babelParsers.json.parse(text, options),
	});

	const expectedOutput = await format(TEST_JSON, {
		parser: 'json',
		plugins: [wrapperPlugin],
	});

	const output = await format(TEST_JSON, {
		parser: 'json',
		plugins: [wrapperPlugin, pluginExpandJSON],
	});

	expect(output).toBe(expectedOutput);
});
