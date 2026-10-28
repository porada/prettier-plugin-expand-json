import type { Parser, ParserOptions, Plugin } from 'prettier';
import type { ResolvedPriorParser } from '../types/index.d.ts';
import { format, formatWithCursor } from 'prettier';
import { parsers as babelParsers } from 'prettier/plugins/babel';
import { printers as estreePrinters } from 'prettier/plugins/estree';
import { expect, test, vi } from 'vite-plus/test';
import * as pluginExpandJSON from '../index.ts';
import { createPriorParserResolver, withPriorParserOptions } from './index.ts';

const TEST_JSON = '{"foo":[1]}';

function getDirectParser(
	plugin: typeof pluginExpandJSON,
	parserName: 'json' | 'json-stringify' | 'jsonc'
): Parser {
	const parser = plugin.parsers?.[parserName];

	if (!parser || typeof parser === 'function') {
		throw new TypeError(`Expected a direct \`${parserName}\` parser`);
	}

	return parser;
}

function createJSONWrapperPlugin(parser: Parser): Plugin {
	return {
		parsers: { json: parser },
		printers: pluginExpandJSON.printers,
	};
}

function createLocationFunctions(): Pick<Parser, 'locEnd' | 'locStart'> {
	return {
		locEnd: (node) => babelParsers.json.locEnd(node),
		locStart: (node) => babelParsers.json.locStart(node),
	};
}

function createRejectionFixture() {
	const parser = getDirectParser(pluginExpandJSON, 'json');
	const delegationKey = Symbol.for(
		'prettier-plugin-expand-json.parser-delegation'
	);

	const error = new Error();
	let reject = true;
	let wrapperCallCount = 0;

	const nativeParse = vi.fn((text: string, options: ParserOptions) =>
		babelParsers.json.parse(text, options)
	);

	const priorPlugin: Plugin = {
		parsers: {
			json: {
				...babelParsers.json,
				parse: nativeParse,
			},
		},
	};

	const wrapperPlugin = createJSONWrapperPlugin({
		...parser,
		parse: async (text, options) => {
			wrapperCallCount += 1;

			if (wrapperCallCount > 3) {
				throw new Error();
			}

			const context: unknown = Reflect.get(options, delegationKey);

			expect(context).toBeDefined();
			expect(context).not.toBe(outerContext);

			await Promise.resolve();
			expect(Reflect.get(options, delegationKey)).toBe(context);

			const ast: unknown = await parser.parse(text, options);

			expect(Reflect.get(options, delegationKey)).toBe(context);

			if (reject) {
				throw error;
			}

			return ast;
		},
	});

	const options = {
		astFormat: parser.astFormat,
		locEnd: parser.locEnd,
		locStart: parser.locStart,
		parser: 'json',
		plugins: [priorPlugin, wrapperPlugin, pluginExpandJSON],
	} as unknown as ParserOptions;

	const outerContext = {
		delegation: {
			hook: 'preprocess',
			parserName: 'json',
			resolveNext: vi.fn(async () => {
				await Promise.resolve();
				return undefined;
			}),
		},
		snapshot: {
			locEnd: options.locEnd,
			locStart: options.locStart,
			plugins: options.plugins,
		},
		syncOptions: vi.fn(),
	};

	return {
		allowParsing: (): void => {
			reject = false;
		},
		delegationKey,
		error,
		getWrapperCallCount: (): number => wrapperCallCount,
		nativeParse,
		options,
		originalPlugins: options.plugins,
		outerContext,
		parser,
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

	let result = await resolvePriorParser(options, 'preprocess');

	expect(result?.parser).toBe(priorParser);

	options.parser = 'jsonc';

	result = await resolvePriorParser(options, 'parse');

	expect(result?.parser).toBe(priorParser);
});

test('sets and restores prior parser location functions', async () => {
	const currentParser = getDirectParser(pluginExpandJSON, 'json');
	const { locEnd, locStart } = createLocationFunctions();

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

	const callback = vi.fn(async (delegatedOptions: ParserOptions) => {
		await Promise.resolve();
		expect(delegatedOptions.locEnd).toBe(locEnd);
		expect(delegatedOptions.locStart).toBe(locStart);
	});

	await withPriorParserOptions(
		options,
		{ lifecycleState: {}, parser: priorParser, plugins },
		callback
	);

	expect(callback).toHaveBeenCalledTimes(1);
	expect(options.locEnd).toBe(currentParser.locEnd);
	expect(options.locStart).toBe(currentParser.locStart);
	expect(options.plugins).toBe(originalPlugins);
});

test.each(['parse', 'preprocess'] as const)(
	'retains prior parser locations only after `%s` succeeds',
	async (hook) => {
		const currentParser = getDirectParser(pluginExpandJSON, 'json');
		const { locEnd, locStart } = createLocationFunctions();

		const priorParser: Parser = { ...babelParsers.json, locEnd, locStart };

		const lifecycleState: ResolvedPriorParser['lifecycleState'] = {};
		const plugins: ParserOptions['plugins'] = [pluginExpandJSON];

		const options = {
			astFormat: currentParser.astFormat,
			locEnd: currentParser.locEnd,
			locStart: currentParser.locStart,
			plugins,
		} as unknown as ParserOptions;

		const callback = vi.fn(async (delegatedOptions: ParserOptions) => {
			await Promise.resolve();
			expect(delegatedOptions.locEnd).toBe(locEnd);
			expect(delegatedOptions.locStart).toBe(locStart);

			return TEST_JSON;
		});

		await expect(
			withPriorParserOptions(
				options,
				{
					delegation: {
						hook,
						parserName: 'json',
						resolveNext: vi.fn().mockResolvedValue(undefined),
					},
					lifecycleState,
					parser: priorParser,
					plugins: [],
				},
				callback
			)
		).resolves.toBe(TEST_JSON);

		expect(callback).toHaveBeenCalledTimes(1);
		expect(options.astFormat).toBe(currentParser.astFormat);
		expect(options.locEnd).toBe(
			hook === 'parse' ? locEnd : currentParser.locEnd
		);
		expect(options.locStart).toBe(
			hook === 'parse' ? locStart : currentParser.locStart
		);
		expect(options.plugins).toBe(plugins);
		expect(lifecycleState).toStrictEqual({});
	}
);

test.each(['parse', 'preprocess'] as const)(
	'restores prior parser options when `%s` rejects',
	async (hook) => {
		const currentParser = getDirectParser(pluginExpandJSON, 'json');
		const { locEnd, locStart } = createLocationFunctions();

		const priorParser: Parser = { ...babelParsers.json, locEnd, locStart };

		const lifecycleState: ResolvedPriorParser['lifecycleState'] = {};
		const plugins: ParserOptions['plugins'] = [pluginExpandJSON];

		const options = {
			astFormat: currentParser.astFormat,
			locEnd: currentParser.locEnd,
			locStart: currentParser.locStart,
			plugins,
		} as unknown as ParserOptions;

		const error = new Error();

		const callback = vi.fn(async (delegatedOptions: ParserOptions) => {
			await Promise.resolve();
			expect(delegatedOptions.locEnd).toBe(locEnd);
			expect(delegatedOptions.locStart).toBe(locStart);

			throw error;
		});

		await expect(
			withPriorParserOptions(
				options,
				{
					delegation: {
						hook,
						parserName: 'json',
						resolveNext: vi.fn().mockResolvedValue(undefined),
					},
					lifecycleState,
					parser: priorParser,
					plugins: [],
				},
				callback
			)
		).rejects.toBe(error);

		expect(callback).toHaveBeenCalledTimes(1);
		expect(options.astFormat).toBe(currentParser.astFormat);
		expect(options.locEnd).toBe(currentParser.locEnd);
		expect(options.locStart).toBe(currentParser.locStart);
		expect(options.plugins).toBe(plugins);
		expect(lifecycleState).toStrictEqual({});
	}
);

test.each(['parse', 'preprocess'] as const)(
	'preserves hook-written lifecycle changes when `%s` rejects',
	async (hook) => {
		const currentParser = getDirectParser(pluginExpandJSON, 'json');
		const { locEnd, locStart } = createLocationFunctions();

		const replacementPlugins: ParserOptions['plugins'] = [];
		const priorParser: Parser = { ...babelParsers.json, locEnd };
		const lifecycleState: ResolvedPriorParser['lifecycleState'] = {};

		const options = {
			astFormat: currentParser.astFormat,
			locEnd: currentParser.locEnd,
			locStart: currentParser.locStart,
			plugins: [pluginExpandJSON],
		} as unknown as ParserOptions;

		const error = new Error();

		await expect(
			withPriorParserOptions(
				options,
				{
					delegation: {
						hook,
						parserName: 'json',
						resolveNext: vi.fn().mockResolvedValue(undefined),
					},
					lifecycleState,
					parser: priorParser,
					plugins: [],
				},
				async (delegatedOptions) => {
					await Promise.resolve();
					delegatedOptions.locStart = locStart;
					delegatedOptions.plugins = replacementPlugins;

					throw error;
				}
			)
		).rejects.toBe(error);

		expect(options.astFormat).toBe(currentParser.astFormat);
		expect(options.locEnd).toBe(currentParser.locEnd);
		expect(options.locStart).toBe(locStart);
		expect(options.plugins).toBe(replacementPlugins);
		expect(lifecycleState).toStrictEqual({
			locStart,
			plugins: replacementPlugins,
		});
	}
);

test('distinguishes adopted entry locations from explicit resets', async () => {
	const currentParser = getDirectParser(pluginExpandJSON, 'json');
	const { locEnd, locStart } = createLocationFunctions();

	const priorPlugin: Plugin = {
		parsers: {
			json: {
				...babelParsers.json,
				locEnd,
				locStart,
			},
		},
	};

	const resolvePriorParser = createPriorParserResolver(
		'json',
		babelParsers.json.astFormat,
		currentParser
	);

	const options = {
		astFormat: currentParser.astFormat,
		locEnd: currentParser.locEnd,
		locStart: currentParser.locStart,
		parser: 'json',
		plugins: [priorPlugin, pluginExpandJSON],
	} as unknown as ParserOptions;

	const resolvedPriorParser = await resolvePriorParser(options, 'parse');

	expect(resolvedPriorParser).toBeDefined();

	await withPriorParserOptions(
		options,
		resolvedPriorParser!,
		() => TEST_JSON
	);

	expect(options.locEnd).toBe(locEnd);
	expect(options.locStart).toBe(locStart);

	const repeatedPriorParser = await resolvePriorParser(options, 'parse');

	expect(repeatedPriorParser).toBe(resolvedPriorParser);
	expect(repeatedPriorParser?.lifecycleState).toStrictEqual({});

	options.locEnd = currentParser.locEnd;
	options.locStart = currentParser.locStart;

	const resetPriorParser = await resolvePriorParser(options, 'parse');

	expect(resetPriorParser).toBe(resolvedPriorParser);
	expect(resetPriorParser?.lifecycleState).toStrictEqual({
		locEnd: currentParser.locEnd,
		locStart: currentParser.locStart,
	});

	await withPriorParserOptions(options, resetPriorParser!, () => TEST_JSON);

	expect(options.locEnd).toBe(currentParser.locEnd);
	expect(options.locStart).toBe(currentParser.locStart);
});

test.each(['parse', 'preprocess'] as const)(
	'tracks entry option resets after `%s` rejects',
	async (hook) => {
		const currentParser = getDirectParser(pluginExpandJSON, 'json');
		const { locEnd, locStart } = createLocationFunctions();

		const priorPlugin: Plugin = {
			parsers: {
				json: {
					...babelParsers.json,
					preprocess: (text) => text,
				},
			},
		};

		const resolvePriorParser = createPriorParserResolver(
			'json',
			babelParsers.json.astFormat,
			currentParser
		);

		const options = {
			astFormat: currentParser.astFormat,
			locEnd: currentParser.locEnd,
			locStart: currentParser.locStart,
			parser: 'json',
			plugins: [priorPlugin, pluginExpandJSON],
		} as unknown as ParserOptions;

		const originalPlugins = options.plugins;
		const reassignedPlugins: ParserOptions['plugins'] = [];
		const resolvedPriorParser = await resolvePriorParser(options, hook);

		expect(resolvedPriorParser).toBeDefined();

		const error = new Error();

		await expect(
			withPriorParserOptions(options, resolvedPriorParser!, async () => {
				await Promise.resolve();

				options.locEnd = locEnd;
				options.locStart = locStart;
				options.plugins = reassignedPlugins;
				throw error;
			})
		).rejects.toBe(error);

		expect(resolvedPriorParser?.entryOptions).toStrictEqual({
			locEnd,
			locStart,
			plugins: reassignedPlugins,
		});

		options.locEnd = currentParser.locEnd;
		options.locStart = currentParser.locStart;
		options.plugins = originalPlugins;

		const resetPriorParser = await resolvePriorParser(options, hook);

		expect(resetPriorParser).toBe(resolvedPriorParser);
		expect(resetPriorParser?.lifecycleState).toStrictEqual({
			locEnd: currentParser.locEnd,
			locStart: currentParser.locStart,
			plugins: originalPlugins,
		});

		await withPriorParserOptions(
			options,
			resetPriorParser!,
			() => TEST_JSON
		);

		expect(options.locEnd).toBe(currentParser.locEnd);
		expect(options.locStart).toBe(currentParser.locStart);
		expect(options.plugins).toBe(originalPlugins);
	}
);

test('respects `cursorOffset` with prior parser locations', async () => {
	const cursorOffset = TEST_JSON.indexOf('1');
	const locations = new WeakMap<object, { end: number; start: number }>();

	function relocateNodes(value: unknown): void {
		if (!value || typeof value !== 'object') {
			return;
		}

		const node = value as Record<string, unknown>;

		if (typeof node.type === 'string') {
			locations.set(node, {
				end: babelParsers.json.locEnd(node),
				start: babelParsers.json.locStart(node),
			});

			node.end = 0;
			node.start = 0;
			node.range = [0, 0];
		}

		for (const child of Object.values(node)) {
			relocateNodes(child);
		}
	}

	const priorPlugin: Plugin = {
		parsers: {
			json: {
				...babelParsers.json,
				locEnd: (node) =>
					locations.get(node)?.end ?? babelParsers.json.locEnd(node),
				locStart: (node) =>
					locations.get(node)?.start ??
					babelParsers.json.locStart(node),
				parse: async (text, options) => {
					const ast: unknown = await babelParsers.json.parse(
						text,
						options
					);

					relocateNodes(ast);
					return ast;
				},
			},
		},
	};

	const { cursorOffset: formattedCursorOffset, formatted } =
		await formatWithCursor(TEST_JSON, {
			cursorOffset,
			parser: 'json',
			plugins: [priorPlugin, pluginExpandJSON],
		});

	expect(formatted).not.toBe(TEST_JSON);
	expect(formatted[formattedCursorOffset]).toBe('1');
	expect(formattedCursorOffset).toBe(formatted.indexOf('1'));
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
			lifecycleState: {},
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
	'matches a single copy’s output alongside an independently loaded copy with the `%s` parser',
	async (parserName) => {
		vi.resetModules();

		const firstPlugin = await import('../index.ts');

		vi.resetModules();

		const secondPlugin = await import('../index.ts');
		const firstParser = getDirectParser(firstPlugin, parserName);
		const secondParser = getDirectParser(secondPlugin, parserName);

		expect(firstParser.parse).not.toBe(secondParser.parse);

		const expectedOutput = await format(TEST_JSON, {
			parser: parserName,
			plugins: [secondPlugin],
		});
		const output = await format(TEST_JSON, {
			parser: parserName,
			plugins: [firstPlugin, secondPlugin],
		});

		expect(output).toBe(expectedOutput);
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
	let observedAstFormat: unknown;
	let observedPlugins: ParserOptions['plugins'] | undefined;
	let observedPrintWidth: number | undefined;

	const observingPlugin: Plugin = {
		parsers: {
			jsonc: {
				...babelParsers.jsonc,
				parse: (text, options) => {
					observedAstFormat = options.astFormat;
					observedPlugins = options.plugins;
					observedPrintWidth = options.printWidth;
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

	expect(observedAstFormat).toBe('estree');
	expect(observedPlugins).toContain(observingPlugin);
	expect(observedPrintWidth).toBe(80);
});

test('shares options between prior `preprocess` and `parse` hooks', async () => {
	const { locEnd, locStart } = createLocationFunctions();

	let observedExpandJSONState: unknown;
	let observedLocEnd: Parser['locEnd'] | undefined;
	let observedLocStart: Parser['locStart'] | undefined;

	const statefulPlugin: Plugin = {
		parsers: {
			json: {
				...babelParsers.json,
				parse: (text, options) => {
					observedExpandJSONState = options.expandJSONState;
					observedLocEnd = options.locEnd;
					observedLocStart = options.locStart;
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

	expect(observedExpandJSONState).toBe(true);
	expect(observedLocEnd).toBe(locEnd);
	expect(observedLocStart).toBe(locStart);
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

test.each([
	['after this plugin', 'json'],
	['after this plugin', 'json-stringify'],
	['after this plugin', 'jsonc'],
	['alone', 'json'],
	['alone', 'json-stringify'],
	['alone', 'jsonc'],
	['before this plugin', 'json'],
	['before this plugin', 'json-stringify'],
	['before this plugin', 'jsonc'],
] as const)(
	'runs lazy copied hooks once when placed %s with the `%s` parser',
	async (placement, parserName) => {
		const parser = getDirectParser(pluginExpandJSON, parserName);
		const parse = vi.fn(function (
			this: Parser,
			text: string,
			options: ParserOptions
		) {
			return parser.parse.call(this, text, options);
		});
		const preprocess = vi.fn(function (
			this: Parser,
			text: string,
			options: ParserOptions
		): Promise<string> | string {
			return parser.preprocess!.call(
				this,
				text.replace('[', '[2,'),
				options
			);
		});

		const wrapperPlugin = {
			parsers: {
				[parserName]: async () => {
					await Promise.resolve();
					return { ...parser, parse, preprocess };
				},
			},
			printers: pluginExpandJSON.printers,
		} as unknown as Plugin;

		const expectedOutput = await format('{"foo":[2,1]}', {
			parser: parserName,
			plugins: [pluginExpandJSON],
		});

		const plugins = {
			'after this plugin': [pluginExpandJSON, wrapperPlugin],
			'alone': [wrapperPlugin],
			'before this plugin': [wrapperPlugin, pluginExpandJSON],
		}[placement];

		const output = await format(TEST_JSON, {
			parser: parserName,
			plugins,
		});

		expect(parse).toHaveBeenCalledTimes(1);
		expect(preprocess).toHaveBeenCalledTimes(1);
		expect(output).toBe(expectedOutput);
	}
);

test.each([
	['a copied `parse` hook', 'json', 'parse', true],
	['a copied `parse` hook', 'json-stringify', 'parse', true],
	['a copied `parse` hook', 'jsonc', 'parse', true],
	[
		'a copied `preprocess` hook through a wrapper that calls this plugin’s parser',
		'json',
		'preprocess',
		false,
	],
	[
		'a copied `preprocess` hook through a wrapper that calls this plugin’s parser',
		'json-stringify',
		'preprocess',
		false,
	],
	[
		'a copied `preprocess` hook through a wrapper that calls this plugin’s parser',
		'jsonc',
		'preprocess',
		false,
	],
	[
		'a copied `preprocess` hook through a wrapper that forwards its receiver',
		'json',
		'preprocess',
		true,
	],
	[
		'a copied `preprocess` hook through a wrapper that forwards its receiver',
		'json-stringify',
		'preprocess',
		true,
	],
	[
		'a copied `preprocess` hook through a wrapper that forwards its receiver',
		'jsonc',
		'preprocess',
		true,
	],
] as const)(
	'runs %s after plugin list replacement with the `%s` parser',
	async (_, parserName, hook, preserveReceiver) => {
		const parser = getDirectParser(pluginExpandJSON, parserName);
		const priorHook = vi.fn((text: string, options: ParserOptions) =>
			parser[hook]!(text.replace('[', '[2,'), options)
		);

		const innerPlugin: Plugin = {
			parsers: {
				[parserName]: {
					...parser,
					[hook]: priorHook,
				},
			},
			printers: pluginExpandJSON.printers,
		};

		const outerPlugin: Plugin = {
			parsers: {
				[parserName]: {
					...parser,
					preprocess(text, options): Promise<string> | string {
						options.plugins = [innerPlugin];

						if (hook === 'parse') {
							return text;
						}

						return preserveReceiver
							? parser.preprocess!.call(this, text, options)
							: parser.preprocess!(text, options);
					},
				},
			},
			printers: pluginExpandJSON.printers,
		};

		const expectedOutput = await format('{"foo":[2,1]}', {
			parser: parserName,
			plugins: [pluginExpandJSON],
		});

		const output = await format(TEST_JSON, {
			parser: parserName,
			plugins: [innerPlugin, outerPlugin, pluginExpandJSON],
		});

		expect(priorHook).toHaveBeenCalledTimes(1);
		expect(output).toBe(expectedOutput);
	}
);

test('preserves parser lifecycle state after plugin list reassignment', async () => {
	const { locEnd, locStart } = createLocationFunctions();

	let observedLocEnd: Parser['locEnd'] | undefined;
	let observedLocStart: Parser['locStart'] | undefined;
	let observedPreprocessed: boolean | undefined;

	const initializeParser = vi.fn(async () => {
		let preprocessed = false;
		await Promise.resolve();

		return {
			...babelParsers.json,
			parse: (text: string, options: ParserOptions) => {
				observedLocEnd = options.locEnd;
				observedLocStart = options.locStart;
				observedPreprocessed = preprocessed;
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
	});

	const lazyPlugin = {
		parsers: {
			json: initializeParser,
		},
	} as unknown as Plugin;

	await format(TEST_JSON, {
		parser: 'json',
		plugins: [lazyPlugin, pluginExpandJSON],
	});

	expect(initializeParser).toHaveBeenCalledTimes(1);
	expect(observedLocEnd).toBe(locEnd);
	expect(observedLocStart).toBe(locStart);
	expect(observedPreprocessed).toBe(true);
});

test('preserves reassigned plugins with the current plugin omitted', async () => {
	let observedLocEnd: Parser['locEnd'] | undefined;
	let observedLocStart: Parser['locStart'] | undefined;
	let observedPlugins: ParserOptions['plugins'] | undefined;
	let observedPreprocessed: boolean | undefined;

	const replacementParse = vi.fn(() => {
		throw new Error();
	});

	const replacementPlugin: Plugin = {
		parsers: {
			json: {
				...babelParsers.json,
				parse: replacementParse,
			},
		},
	};

	const replacementPlugins: ParserOptions['plugins'] = [
		replacementPlugin,
		pluginExpandJSON,
	];

	const { locEnd, locStart } = createLocationFunctions();

	const initializeParser = vi.fn(async () => {
		let preprocessed = false;
		await Promise.resolve();

		return {
			...babelParsers.json,
			parse: (text: string, options: ParserOptions) => {
				observedLocEnd = options.locEnd;
				observedLocStart = options.locStart;
				observedPlugins = options.plugins;
				observedPreprocessed = preprocessed;
				return babelParsers.json.parse(text, options);
			},
			preprocess: (text: string, options: ParserOptions) => {
				preprocessed = true;
				options.locEnd = locEnd;
				options.locStart = locStart;
				options.plugins = replacementPlugins;
				return text;
			},
		};
	});

	const lazyPlugin = {
		parsers: {
			json: initializeParser,
		},
	} as unknown as Plugin;

	await format(TEST_JSON, {
		parser: 'json',
		plugins: [lazyPlugin, pluginExpandJSON],
	});

	expect(initializeParser).toHaveBeenCalledTimes(1);
	expect(observedLocEnd).toBe(locEnd);
	expect(observedLocStart).toBe(locStart);
	expect(observedPreprocessed).toBe(true);
	expect(observedPlugins).toStrictEqual([replacementPlugin]);
	expect(replacementParse).not.toHaveBeenCalled();
	expect(observedPlugins).not.toBe(replacementPlugins);
});

test('preserves reassigned plugins without omitted plugins', async () => {
	let observedLocEnd: Parser['locEnd'] | undefined;
	let observedLocStart: Parser['locStart'] | undefined;
	let observedPlugins: ParserOptions['plugins'] | undefined;
	let observedPreprocessed: boolean | undefined;

	const replacementParse = vi.fn(() => {
		throw new Error();
	});

	const replacementPlugin: Plugin = {
		parsers: {
			json: {
				...babelParsers.json,
				parse: replacementParse,
			},
		},
	};

	const replacementPlugins: ParserOptions['plugins'] = [replacementPlugin];

	const { locEnd, locStart } = createLocationFunctions();

	const initializeParser = vi.fn(async () => {
		let preprocessed = false;
		await Promise.resolve();

		return {
			...babelParsers.json,
			parse: (text: string, options: ParserOptions) => {
				observedLocEnd = options.locEnd;
				observedLocStart = options.locStart;
				observedPlugins = options.plugins;
				observedPreprocessed = preprocessed;
				return babelParsers.json.parse(text, options);
			},
			preprocess: (text: string, options: ParserOptions) => {
				preprocessed = true;
				options.locEnd = locEnd;
				options.locStart = locStart;
				options.plugins = replacementPlugins;
				return text;
			},
		};
	});

	const lazyPlugin = {
		parsers: {
			json: initializeParser,
		},
	} as unknown as Plugin;

	await format(TEST_JSON, {
		parser: 'json',
		plugins: [lazyPlugin, pluginExpandJSON],
	});

	expect(initializeParser).toHaveBeenCalledTimes(1);
	expect(observedLocEnd).toBe(locEnd);
	expect(observedLocStart).toBe(locStart);
	expect(observedPreprocessed).toBe(true);
	expect(observedPlugins).toStrictEqual([replacementPlugin]);
	expect(replacementParse).not.toHaveBeenCalled();
	expect(observedPlugins).toBe(replacementPlugins);
});

test('omits resolved lazy plugin copies from prior parser options', async () => {
	const parser = getDirectParser(pluginExpandJSON, 'json');

	let observedPlugins: ParserOptions['plugins'] | undefined;

	const initializeParser = vi.fn(async () => {
		await Promise.resolve();
		return parser;
	});

	const lazyPlugin = {
		parsers: {
			json: initializeParser,
		},
	} as unknown as Plugin;

	const observingPlugin: Plugin = {
		parsers: {
			json: {
				...babelParsers.json,
				parse: (text, options) => {
					observedPlugins = options.plugins;
					return babelParsers.json.parse(text, options);
				},
			},
		},
	};

	await format(TEST_JSON, {
		parser: 'json',
		plugins: [observingPlugin, lazyPlugin, pluginExpandJSON],
	});

	expect(initializeParser).toHaveBeenCalledTimes(1);
	expect(observedPlugins).not.toContain(lazyPlugin);
});

test('doesn’t initialize shadowed lazy parsers', async () => {
	const initializeParser = vi.fn(async () => {
		await Promise.resolve();
		return babelParsers.json;
	});

	const lazyPlugin = {
		parsers: {
			json: initializeParser,
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

	expect(initializeParser).not.toHaveBeenCalled();
});

test('passes the compatibility options argument to prior parsers', async () => {
	const parse = vi.fn(
		(
			text: string,
			options: ParserOptions,
			compatibilityOptions?: ParserOptions
		) => babelParsers.json.parse(text, compatibilityOptions ?? options)
	);

	const legacyPlugin: Plugin = {
		parsers: {
			json: {
				...babelParsers.json,
				parse,
			},
		},
	};

	await format(TEST_JSON, {
		parser: 'json',
		plugins: [legacyPlugin, pluginExpandJSON],
	});

	const [, options, compatibilityOptions] = parse.mock.lastCall!;

	expect(compatibilityOptions).toBe(options);
});

test('matches its own output after wrappers that copy the current parser hooks', async () => {
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
				preprocess: () => '{"foo":["bar"]}\n',
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

test('matches the wrapper’s output when it reuses the current `parse` function', async () => {
	const parser = getDirectParser(pluginExpandJSON, 'json');
	const wrapperPlugin = createJSONWrapperPlugin({
		...parser,
		preprocess: () => '{"foo":["bar"]}\n',
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

test.each(['after this plugin', 'alone', 'before this plugin'] as const)(
	'uses location fields from a copied wrapper placed %s only when Prettier selects it',
	async (placement) => {
		const parser = getDirectParser(pluginExpandJSON, 'json');

		const locEnd = vi.fn(babelParsers.json.locEnd);
		const locStart = vi.fn(babelParsers.json.locStart);
		const parse = vi.fn(parser.parse);
		const priorLocEnd = vi.fn(babelParsers.json.locEnd);
		const priorLocStart = vi.fn(babelParsers.json.locStart);

		const priorPlugin: Plugin = {
			parsers: {
				json: {
					...babelParsers.json,
					locEnd: priorLocEnd,
					locStart: priorLocStart,
				},
			},
		};

		const wrapperPlugin = createJSONWrapperPlugin({
			...parser,
			locEnd,
			locStart,
			parse,
		});

		const options = {
			cursorOffset: TEST_JSON.indexOf('1'),
			parser: 'json',
		};

		const expectedResult = await formatWithCursor(TEST_JSON, {
			...options,
			plugins: [pluginExpandJSON],
		});

		const plugins = {
			'after this plugin': [priorPlugin, pluginExpandJSON, wrapperPlugin],
			'alone': [priorPlugin, wrapperPlugin],
			'before this plugin': [
				priorPlugin,
				wrapperPlugin,
				pluginExpandJSON,
			],
		}[placement];

		const isSelectedParser = placement !== 'before this plugin';

		const result = await formatWithCursor(TEST_JSON, {
			...options,
			plugins,
		});

		expect(result).toStrictEqual(expectedResult);
		expect(parse).toHaveBeenCalledTimes(1);
		expect(isSelectedParser ? locEnd : priorLocEnd).toHaveBeenCalled();
		expect(isSelectedParser ? locStart : priorLocStart).toHaveBeenCalled();
		expect(isSelectedParser ? priorLocEnd : locEnd).not.toHaveBeenCalled();
		expect(
			isSelectedParser ? priorLocStart : locStart
		).not.toHaveBeenCalled();
	}
);

test.each([
	['parser fields', 'after this plugin'],
	['parser fields', 'alone'],
	['the `preprocess` hook', 'after this plugin'],
	['the `preprocess` hook', 'alone'],
] as const)(
	'preserves wrapper location overrides from %s when placed %s',
	async (source, placement) => {
		const parser = getDirectParser(pluginExpandJSON, 'json');
		const { locEnd, locStart } = createLocationFunctions();

		let observedLocEnd: Parser['locEnd'] | undefined;
		let observedLocStart: Parser['locStart'] | undefined;
		let parsedOptions: ParserOptions | undefined;

		const priorParse = vi.fn((text: string, options: ParserOptions) => {
			observedLocEnd = options.locEnd;
			observedLocStart = options.locStart;
			parsedOptions = options;

			return babelParsers.json.parse(text, options);
		});

		const priorPlugin: Plugin = {
			parsers: {
				json: {
					...babelParsers.json,
					parse: priorParse,
				},
			},
		};

		const wrapperParser: Parser = { ...parser };

		if (source === 'parser fields') {
			wrapperParser.locEnd = locEnd;
			wrapperParser.locStart = locStart;
		} else {
			wrapperParser.preprocess = (text, options) => {
				options.locEnd = locEnd;
				options.locStart = locStart;

				return text;
			};
		}

		const wrapperPlugin = createJSONWrapperPlugin(wrapperParser);
		const plugins = {
			'after this plugin': [priorPlugin, pluginExpandJSON, wrapperPlugin],
			'alone': [priorPlugin, wrapperPlugin],
		}[placement];

		const expectedOutput = await format(TEST_JSON, {
			parser: 'json',
			plugins: [pluginExpandJSON],
		});

		const output = await format(TEST_JSON, {
			parser: 'json',
			plugins,
		});

		expect(observedLocEnd).toBe(locEnd);
		expect(observedLocStart).toBe(locStart);
		expect(priorParse).toHaveBeenCalledTimes(1);
		expect(parsedOptions?.locEnd).toBe(locEnd);
		expect(parsedOptions?.locStart).toBe(locStart);
		expect(output).toBe(expectedOutput);
	}
);

test.each([
	['parse', 'after this plugin'],
	['parse', 'alone'],
	['parse', 'before this plugin'],
	['preprocess', 'after this plugin'],
	['preprocess', 'alone'],
	['preprocess', 'before this plugin'],
] as const)(
	'passes location overrides from `%s` wrappers to the prior parser when placed %s',
	async (hook, placement) => {
		const parser = getDirectParser(pluginExpandJSON, 'json');
		const { locEnd, locStart } = createLocationFunctions();

		let observedLocEnd: Parser['locEnd'] | undefined;
		let observedLocStart: Parser['locStart'] | undefined;
		let observedOptions: ParserOptions | undefined;
		let wrapperCallCount = 0;

		const priorHook = vi.fn((text: string, options: ParserOptions) => {
			observedLocEnd = options.locEnd;
			observedLocStart = options.locStart;
			observedOptions = options;

			return hook === 'parse'
				? babelParsers.json.parse(text, options)
				: text;
		});

		const priorPlugin: Plugin = {
			parsers: {
				json: {
					...babelParsers.json,
					[hook]: priorHook,
				},
			},
		};

		const wrapperPlugin = createJSONWrapperPlugin({
			...parser,
			[hook]: async (text: string, options: ParserOptions) => {
				wrapperCallCount += 1;

				if (wrapperCallCount > 1) {
					throw new Error();
				}

				await Promise.resolve();
				options.locEnd = locEnd;
				options.locStart = locStart;

				return parser[hook]!(text, options);
			},
		});

		const plugins = {
			'after this plugin': [priorPlugin, pluginExpandJSON, wrapperPlugin],
			'alone': [priorPlugin, wrapperPlugin],
			'before this plugin': [
				priorPlugin,
				wrapperPlugin,
				pluginExpandJSON,
			],
		}[placement];

		const expectedOutput = await format(TEST_JSON, {
			parser: 'json',
			plugins: [pluginExpandJSON],
		});

		const output = await format(TEST_JSON, {
			parser: 'json',
			plugins,
		});

		expect(observedLocEnd).toBe(locEnd);
		expect(observedLocStart).toBe(locStart);
		expect(priorHook).toHaveBeenCalledTimes(1);
		expect(wrapperCallCount).toBe(1);
		expect(output).toBe(expectedOutput);
		expect(observedOptions?.locEnd).toBe(locEnd);
		expect(observedOptions?.locStart).toBe(locStart);
	}
);

test.each([
	['parse', 'after this plugin'],
	['parse', 'alone'],
	['parse', 'before this plugin'],
	['preprocess', 'after this plugin'],
	['preprocess', 'alone'],
	['preprocess', 'before this plugin'],
] as const)(
	'passes plugin list overrides from `%s` wrappers to the prior parser when placed %s',
	async (hook, placement) => {
		const parser = getDirectParser(pluginExpandJSON, 'json');

		let observedOptions: ParserOptions | undefined;
		let observedPlugins: ParserOptions['plugins'] | undefined;
		let wrapperCallCount = 0;

		const priorHook = vi.fn((text: string, options: ParserOptions) => {
			observedOptions = options;
			observedPlugins = options.plugins;

			return hook === 'parse'
				? babelParsers.json.parse(text, options)
				: text;
		});

		const priorPlugin: Plugin = {
			parsers: {
				json: {
					...babelParsers.json,
					[hook]: priorHook,
				},
			},
		};

		const reassignedPlugins: ParserOptions['plugins'] = [priorPlugin];

		const wrapperPlugin = createJSONWrapperPlugin({
			...parser,
			[hook]: async (text: string, options: ParserOptions) => {
				wrapperCallCount += 1;

				if (wrapperCallCount > 1) {
					throw new Error();
				}

				await Promise.resolve();
				options.plugins = reassignedPlugins;

				return parser[hook]!(text, options);
			},
		});

		const plugins = {
			'after this plugin': [priorPlugin, pluginExpandJSON, wrapperPlugin],
			'alone': [priorPlugin, wrapperPlugin],
			'before this plugin': [
				priorPlugin,
				wrapperPlugin,
				pluginExpandJSON,
			],
		}[placement];

		const expectedOutput = await format(TEST_JSON, {
			parser: 'json',
			plugins: [pluginExpandJSON],
		});

		const output = await format(TEST_JSON, {
			parser: 'json',
			plugins,
		});

		expect(observedPlugins).toBe(reassignedPlugins);
		expect(priorHook).toHaveBeenCalledTimes(1);
		expect(wrapperCallCount).toBe(1);
		expect(output).toBe(expectedOutput);
		expect(observedOptions?.plugins).toBe(reassignedPlugins);
	}
);

test.each([
	['parse', 'alone'],
	['parse', 'before an independent plugin instance'],
	['parse', 'before this plugin'],
	['preprocess', 'alone'],
	['preprocess', 'before an independent plugin instance'],
	['preprocess', 'before this plugin'],
] as const)(
	'runs a delegating `%s` wrapper once when placed %s with a prior parser',
	async (hook, placement) => {
		vi.resetModules();

		const firstPlugin = await import('../index.ts');
		const parser = getDirectParser(firstPlugin, 'json');

		if (placement === 'before an independent plugin instance') {
			vi.resetModules();
		}

		const secondPlugin = await import('../index.ts');

		let wrapperCallCount = 0;

		const parse = vi.fn((text: string, options: ParserOptions) =>
			babelParsers.json.parse(text, options)
		);
		const preprocess = vi.fn((text: string) => text.replace('[', '[2,'));
		const initializeParser = vi.fn(async () => {
			await Promise.resolve();
			return { ...babelParsers.json, parse, preprocess };
		});

		const priorPlugin = {
			parsers: {
				json: initializeParser,
			},
		} as unknown as Plugin;

		const wrapperPlugin = createJSONWrapperPlugin({
			...parser,
			[hook]: async (text: string, options: ParserOptions) => {
				wrapperCallCount += 1;

				if (wrapperCallCount > 1) {
					throw new Error();
				}

				await Promise.resolve();
				return parser[hook]!(text.replace('[', '[3,'), options);
			},
		});

		const expectedOutput = await format(
			hook === 'parse' ? '{"foo":[3,2,1]}' : '{"foo":[2,3,1]}',
			{ parser: 'json', plugins: [secondPlugin] }
		);

		const plugins = {
			'alone': [priorPlugin, wrapperPlugin],
			'before an independent plugin instance': [
				priorPlugin,
				wrapperPlugin,
				secondPlugin,
			],
			'before this plugin': [priorPlugin, wrapperPlugin, secondPlugin],
		}[placement];

		const output = await format(TEST_JSON, { parser: 'json', plugins });

		expect(initializeParser).toHaveBeenCalledTimes(1);
		expect(parse).toHaveBeenCalledTimes(1);
		expect(preprocess).toHaveBeenCalledTimes(1);
		expect(wrapperCallCount).toBe(1);
		expect(output).toBe(expectedOutput);
	}
);

test.each([
	['parse', 'before an independent plugin instance'],
	['parse', 'before this plugin'],
	['preprocess', 'before an independent plugin instance'],
	['preprocess', 'before this plugin'],
] as const)(
	'passes lifecycle changes from `%s` wrappers to the prior parser when placed %s',
	async (hook, placement) => {
		vi.resetModules();

		const firstPlugin = await import('../index.ts');
		const parser = getDirectParser(firstPlugin, 'json');

		if (placement === 'before an independent plugin instance') {
			vi.resetModules();
		}

		const secondPlugin = await import('../index.ts');

		const { locEnd, locStart } = createLocationFunctions();

		const reassignedPlugins: ParserOptions['plugins'] = [];
		let observedLocEnd: Parser['locEnd'] | undefined;
		let observedLocStart: Parser['locStart'] | undefined;
		let observedPlugins: ParserOptions['plugins'] | undefined;
		let wrapperCallCount = 0;

		const priorHook = vi.fn((text: string, options: ParserOptions) => {
			observedLocEnd = options.locEnd;
			observedLocStart = options.locStart;
			observedPlugins = options.plugins;
			return hook === 'parse'
				? babelParsers.json.parse(text, options)
				: text;
		});

		const priorPlugin: Plugin = {
			parsers: {
				json: {
					...babelParsers.json,
					[hook]: priorHook,
				},
			},
		};

		const wrapperPlugin = createJSONWrapperPlugin({
			...parser,
			[hook]: async (text: string, options: ParserOptions) => {
				wrapperCallCount += 1;

				if (wrapperCallCount > 1) {
					throw new Error();
				}

				await Promise.resolve();
				options.locEnd = locEnd;
				options.locStart = locStart;
				options.plugins = reassignedPlugins;
				return parser[hook]!(text.replace('[', '[2,'), options);
			},
		});

		const expectedOutput = await format('{"foo":[2,1]}', {
			parser: 'json',
			plugins: [secondPlugin],
		});

		const output = await format(TEST_JSON, {
			parser: 'json',
			plugins: [priorPlugin, wrapperPlugin, secondPlugin],
		});

		expect(observedLocEnd).toBe(locEnd);
		expect(observedLocStart).toBe(locStart);
		expect(observedPlugins).toBe(reassignedPlugins);
		expect(priorHook).toHaveBeenCalledTimes(1);
		expect(wrapperCallCount).toBe(1);
		expect(output).toBe(expectedOutput);
	}
);

test.each(['alone', 'before this plugin'] as const)(
	'runs wrapped hooks once when placed %s without a prior parser',
	async (placement) => {
		const parser = getDirectParser(pluginExpandJSON, 'json');
		let parseCallCount = 0;
		let preprocessCallCount = 0;

		const wrapperPlugin = createJSONWrapperPlugin({
			...parser,
			parse: (text, options) => {
				parseCallCount += 1;

				if (parseCallCount > 1) {
					throw new Error();
				}

				return parser.parse(text.replace('[', '[3,'), options);
			},
			preprocess: async (text, options) => {
				preprocessCallCount += 1;

				if (preprocessCallCount > 1) {
					throw new Error();
				}

				await Promise.resolve();
				return parser.preprocess!(text.replace('[', '[2,'), options);
			},
		});

		const expectedOutput = await format('{"foo":[3,2,1]}', {
			parser: 'json',
			plugins: [pluginExpandJSON],
		});

		const plugins = {
			'alone': [wrapperPlugin],
			'before this plugin': [wrapperPlugin, pluginExpandJSON],
		}[placement];

		const output = await format(TEST_JSON, { parser: 'json', plugins });

		expect(parseCallCount).toBe(1);
		expect(preprocessCallCount).toBe(1);
		expect(output).toBe(expectedOutput);
	}
);

test('restores parser locations when a wrapper rejects after delegated parsing', async () => {
	const parser = getDirectParser(pluginExpandJSON, 'json');
	const { locEnd, locStart } = createLocationFunctions();

	const priorPlugin: Plugin = {
		parsers: {
			json: {
				...babelParsers.json,
				locEnd,
				locStart,
			},
		},
	};

	const error = new Error();
	let observedLocEnd: Parser['locEnd'] | undefined;
	let observedLocStart: Parser['locStart'] | undefined;
	let parseCallCount = 0;

	const wrapperPlugin = createJSONWrapperPlugin({
		...parser,
		parse: async (text, options) => {
			parseCallCount += 1;

			if (parseCallCount > 1) {
				throw new Error();
			}

			await parser.parse(text, options);

			observedLocEnd = options.locEnd;
			observedLocStart = options.locStart;

			throw error;
		},
	});

	const options = {
		astFormat: parser.astFormat,
		locEnd: parser.locEnd,
		locStart: parser.locStart,
		parser: 'json',
		plugins: [priorPlugin, wrapperPlugin, pluginExpandJSON],
	} as unknown as ParserOptions;

	const originalPlugins = options.plugins;

	await expect(parser.parse(TEST_JSON, options)).rejects.toBe(error);

	expect(observedLocEnd).toBe(locEnd);
	expect(observedLocStart).toBe(locStart);
	expect(parseCallCount).toBe(1);
	expect(options.astFormat).toBe(parser.astFormat);
	expect(options.locEnd).toBe(parser.locEnd);
	expect(options.locStart).toBe(parser.locStart);
	expect(options.plugins).toBe(originalPlugins);
});

test('preserves locations reset by a wrapper before parsing again', async () => {
	const parser = getDirectParser(pluginExpandJSON, 'json');
	const { locEnd, locStart } = createLocationFunctions();

	let observedParsedLocEnd: Parser['locEnd'] | undefined;
	let observedParsedLocStart: Parser['locStart'] | undefined;
	let observedResetLocEnd: Parser['locEnd'] | undefined;
	let observedResetLocStart: Parser['locStart'] | undefined;
	let wrapperCallCount = 0;

	const priorParse = vi.fn((text: string, options: ParserOptions) => {
		observedResetLocEnd = options.locEnd;
		observedResetLocStart = options.locStart;
		return babelParsers.json.parse(text, options);
	});

	const priorPlugin: Plugin = {
		parsers: {
			json: {
				...babelParsers.json,
				locEnd,
				locStart,
				parse: priorParse,
			},
		},
	};

	const wrapperPlugin = createJSONWrapperPlugin({
		...parser,
		parse: async (text, options) => {
			wrapperCallCount += 1;

			if (wrapperCallCount > 1) {
				throw new Error();
			}

			const originalLocEnd = options.locEnd;
			const originalLocStart = options.locStart;

			await parser.parse(text, options);

			observedParsedLocEnd = options.locEnd;
			observedParsedLocStart = options.locStart;

			options.locEnd = originalLocEnd;
			options.locStart = originalLocStart;
			return parser.parse(text, options);
		},
	});

	const expectedOutput = await format(TEST_JSON, {
		parser: 'json',
		plugins: [pluginExpandJSON],
	});

	const output = await format(TEST_JSON, {
		parser: 'json',
		plugins: [priorPlugin, wrapperPlugin, pluginExpandJSON],
	});

	expect(observedParsedLocEnd).toBe(locEnd);
	expect(observedParsedLocStart).toBe(locStart);
	expect(observedResetLocEnd).toBe(parser.locEnd);
	expect(observedResetLocStart).toBe(parser.locStart);
	expect(priorParse).toHaveBeenCalledTimes(2);
	expect(wrapperCallCount).toBe(1);
	expect(output).toBe(expectedOutput);
});

test('restores parser options after rejection with a prior continuation', async () => {
	const {
		allowParsing,
		delegationKey,
		error,
		getWrapperCallCount,
		nativeParse,
		options,
		originalPlugins,
		outerContext,
		parser,
	} = createRejectionFixture();

	Reflect.set(options, delegationKey, outerContext);

	await expect(parser.parse(TEST_JSON, options)).rejects.toBe(error);

	expect(Reflect.get(options, delegationKey)).toBe(outerContext);

	allowParsing();
	await parser.parse(TEST_JSON, options);

	expect(getWrapperCallCount()).toBe(2);
	expect(nativeParse).toHaveBeenCalledTimes(2);
	expect(outerContext.delegation.resolveNext).not.toHaveBeenCalled();
	expect(outerContext.syncOptions).toHaveBeenCalledTimes(2);
	expect(Reflect.get(options, delegationKey)).toBe(outerContext);
	expect(options.plugins).toBe(originalPlugins);
});

test('restores parser options after rejection without a prior continuation', async () => {
	const {
		allowParsing,
		delegationKey,
		error,
		getWrapperCallCount,
		nativeParse,
		options,
		originalPlugins,
		outerContext,
		parser,
	} = createRejectionFixture();

	await expect(parser.parse(TEST_JSON, options)).rejects.toBe(error);

	expect(Reflect.ownKeys(options)).not.toContain(delegationKey);

	allowParsing();
	await parser.parse(TEST_JSON, options);

	expect(getWrapperCallCount()).toBe(2);
	expect(nativeParse).toHaveBeenCalledTimes(2);
	expect(outerContext.delegation.resolveNext).not.toHaveBeenCalled();
	expect(outerContext.syncOptions).not.toHaveBeenCalled();
	expect(Reflect.ownKeys(options)).not.toContain(delegationKey);
	expect(options.plugins).toBe(originalPlugins);
});

test('skips unchanged copied hooks from an independent instance', async () => {
	vi.resetModules();

	const firstPlugin = await import('../index.ts');

	vi.resetModules();

	const secondPlugin = await import('../index.ts');
	const parser = getDirectParser(secondPlugin, 'json');

	const priorParser: Parser = {
		...babelParsers.json,
		preprocess: (text) => text,
	};

	const wrapperPlugin = createJSONWrapperPlugin({
		...getDirectParser(firstPlugin, 'json'),
	});

	const resolvePriorParser = createPriorParserResolver(
		'json',
		babelParsers.json.astFormat,
		parser
	);

	const options = {
		parser: 'json',
		plugins: [
			{
				parsers: {
					json: priorParser,
				},
			},
			wrapperPlugin,
			secondPlugin,
		],
	} as unknown as ParserOptions;

	const parseResult = await resolvePriorParser(options, 'parse');
	const preprocessResult = await resolvePriorParser(options, 'preprocess');

	expect(parseResult?.parser).toBe(priorParser);
	expect(preprocessResult?.parser).toBe(priorParser);
});
