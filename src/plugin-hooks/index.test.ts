import type { Parser, ParserOptions, Plugin } from 'prettier';
import type { ResolvedPriorParser } from '../types/index.d.ts';
import { format, formatWithCursor } from 'prettier';
import { parsers as babelParsers } from 'prettier/plugins/babel';
import { printers as estreePrinters } from 'prettier/plugins/estree';
import { describe, expect, test, vi } from 'vite-plus/test';
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
		{ lifecycleState: {}, parser: priorParser, plugins },
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

test.each(['parse', 'preprocess'] as const)(
	'retains prior parser locations only after `%s` succeeds',
	async (hook) => {
		const currentParser = getDirectParser(pluginExpandJSON, 'json');

		const locEnd: Parser['locEnd'] = (node) =>
			babelParsers.json.locEnd(node);
		const locStart: Parser['locStart'] = (node) =>
			babelParsers.json.locStart(node);

		const priorParser: Parser = { ...babelParsers.json, locEnd, locStart };

		const lifecycleState: ResolvedPriorParser['lifecycleState'] = {};
		const plugins: ParserOptions['plugins'] = [pluginExpandJSON];

		const options = {
			astFormat: currentParser.astFormat,
			locEnd: currentParser.locEnd,
			locStart: currentParser.locStart,
			plugins,
		} as unknown as ParserOptions;

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
					expect(delegatedOptions.locEnd).toBe(locEnd);
					expect(delegatedOptions.locStart).toBe(locStart);

					return TEST_JSON;
				}
			)
		).resolves.toBe(TEST_JSON);

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

		const locEnd: Parser['locEnd'] = (node) =>
			babelParsers.json.locEnd(node);
		const locStart: Parser['locStart'] = (node) =>
			babelParsers.json.locStart(node);

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
					expect(delegatedOptions.locEnd).toBe(locEnd);
					expect(delegatedOptions.locStart).toBe(locStart);

					throw error;
				}
			)
		).rejects.toBe(error);

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

		const locEnd: Parser['locEnd'] = (node) =>
			babelParsers.json.locEnd(node);
		const locStart: Parser['locStart'] = (node) =>
			babelParsers.json.locStart(node);

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

	const locEnd: Parser['locEnd'] = (node) => babelParsers.json.locEnd(node);
	const locStart: Parser['locStart'] = (node) =>
		babelParsers.json.locStart(node);

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

		const locEnd: Parser['locEnd'] = (node) =>
			babelParsers.json.locEnd(node);
		const locStart: Parser['locStart'] = (node) =>
			babelParsers.json.locStart(node);

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

test.each([
	['with the current plugin omitted', true],
	['without omitted plugins', false],
] as const)(
	'preserves reassigned plugins %s',
	async (_, includeCurrentPlugin) => {
		let initializationCount = 0;
		let observedLifecycleState = false;
		let observedPlugins: ParserOptions['plugins'] | undefined;

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

		const replacementPlugins: ParserOptions['plugins'] =
			includeCurrentPlugin
				? [replacementPlugin, pluginExpandJSON]
				: [replacementPlugin];

		const locEnd: Parser['locEnd'] = (node) =>
			babelParsers.json.locEnd(node);
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
							observedPlugins = options.plugins;
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
				},
			},
		} as unknown as Plugin;

		await format(TEST_JSON, {
			parser: 'json',
			plugins: [lazyPlugin, pluginExpandJSON],
		});

		expect(initializationCount).toBe(1);
		expect(observedLifecycleState).toBe(true);
		expect(observedPlugins).toStrictEqual([replacementPlugin]);
		expect(replacementParse).not.toHaveBeenCalled();
		expect(observedPlugins === replacementPlugins).toBe(
			!includeCurrentPlugin
		);
	}
);

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

test('uses copied wrapper location fields only when selected by Prettier', async () => {
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

	const expectedOutput = await formatWithCursor(TEST_JSON, {
		...options,
		plugins: [pluginExpandJSON],
	});

	for (const placement of ['after', 'alone', 'before'] as const) {
		const plugins = {
			after: [priorPlugin, pluginExpandJSON, wrapperPlugin],
			alone: [priorPlugin, wrapperPlugin],
			before: [priorPlugin, wrapperPlugin, pluginExpandJSON],
		}[placement];

		const isSelectedParser = placement !== 'before';

		locEnd.mockClear();
		locStart.mockClear();
		parse.mockClear();
		priorLocEnd.mockClear();
		priorLocStart.mockClear();

		const output = await formatWithCursor(TEST_JSON, {
			...options,
			plugins,
		});

		expect(output).toStrictEqual(expectedOutput);
		expect(parse).toHaveBeenCalledTimes(1);
		expect(isSelectedParser ? locEnd : priorLocEnd).toHaveBeenCalled();
		expect(isSelectedParser ? locStart : priorLocStart).toHaveBeenCalled();
		expect(isSelectedParser ? priorLocEnd : locEnd).not.toHaveBeenCalled();
		expect(
			isSelectedParser ? priorLocStart : locStart
		).not.toHaveBeenCalled();
	}
});

describe.each(['parser fields', 'preprocess'] as const)(
	'copied locations from %s',
	(source) => {
		test.each(['after this plugin', 'alone'] as const)(
			'preserves overrides when selected %s',
			async (placement) => {
				const parser = getDirectParser(pluginExpandJSON, 'json');

				const locEnd: Parser['locEnd'] = (node) =>
					babelParsers.json.locEnd(node);
				const locStart: Parser['locStart'] = (node) =>
					babelParsers.json.locStart(node);

				let observedLocations = false;
				let parsedOptions: ParserOptions | undefined;
				let parseCallCount = 0;

				const priorPlugin: Plugin = {
					parsers: {
						json: {
							...babelParsers.json,
							parse: (text, options) => {
								parseCallCount += 1;
								parsedOptions = options;
								observedLocations =
									options.locEnd === locEnd &&
									options.locStart === locStart;

								return babelParsers.json.parse(text, options);
							},
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
				const plugins =
					placement === 'alone'
						? [priorPlugin, wrapperPlugin]
						: [priorPlugin, pluginExpandJSON, wrapperPlugin];

				const expectedOutput = await format(TEST_JSON, {
					parser: 'json',
					plugins: [pluginExpandJSON],
				});

				const output = await format(TEST_JSON, {
					parser: 'json',
					plugins,
				});

				expect(observedLocations).toBe(true);
				expect(parseCallCount).toBe(1);
				expect(parsedOptions?.locEnd).toBe(locEnd);
				expect(parsedOptions?.locStart).toBe(locStart);
				expect(output).toBe(expectedOutput);
			}
		);
	}
);

describe.each(['parse', 'preprocess'] as const)('`%s` wrappers', (hook) => {
	describe.each(['locations', 'plugins'] as const)(
		'%s overrides',
		(override) => {
			test.each([
				'after this plugin',
				'alone',
				'before this plugin',
			] as const)(
				'passes overrides to the prior parser %s',
				async (placement) => {
					const parser = getDirectParser(pluginExpandJSON, 'json');

					const locEnd: Parser['locEnd'] = (node) =>
						babelParsers.json.locEnd(node);
					const locStart: Parser['locStart'] = (node) =>
						babelParsers.json.locStart(node);

					let observedOverride = false;
					let observedOptions: ParserOptions | undefined;
					let priorCallCount = 0;
					let wrapperCallCount = 0;

					const priorPlugin: Plugin = {
						parsers: {
							json: {
								...babelParsers.json,
								[hook]: (
									text: string,
									options: ParserOptions
								) => {
									priorCallCount += 1;
									observedOptions = options;
									observedOverride =
										override === 'locations'
											? options.locEnd === locEnd &&
												options.locStart === locStart
											: options.plugins ===
												reassignedPlugins;

									return hook === 'parse'
										? babelParsers.json.parse(text, options)
										: text;
								},
							},
						},
					};

					const reassignedPlugins: ParserOptions['plugins'] = [
						priorPlugin,
					];

					const wrapperPlugin = createJSONWrapperPlugin({
						...parser,
						[hook]: async (
							text: string,
							options: ParserOptions
						) => {
							wrapperCallCount += 1;

							if (wrapperCallCount > 1) {
								throw new Error();
							}

							await Promise.resolve();

							if (override === 'locations') {
								options.locEnd = locEnd;
								options.locStart = locStart;
							} else {
								options.plugins = reassignedPlugins;
							}

							return parser[hook]!(text, options);
						},
					});

					const plugins = {
						'after this plugin': [
							priorPlugin,
							pluginExpandJSON,
							wrapperPlugin,
						],
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

					expect(observedOverride).toBe(true);
					expect(priorCallCount).toBe(1);
					expect(wrapperCallCount).toBe(1);
					expect(output).toBe(expectedOutput);
					expect(
						override === 'locations'
							? observedOptions?.locEnd === locEnd &&
									observedOptions?.locStart === locStart
							: observedOptions?.plugins === reassignedPlugins
					).toBe(true);
				}
			);
		}
	);

	test.each([
		'alone',
		'before an independent plugin instance',
		'before this plugin',
	] as const)('runs once %s with a prior parser', async (placement) => {
		vi.resetModules();

		const firstPlugin = await import('../index.ts');
		const parser = getDirectParser(firstPlugin, 'json');

		if (placement === 'before an independent plugin instance') {
			vi.resetModules();
		}

		const secondPlugin = await import('../index.ts');

		let initializationCount = 0;
		let parseCallCount = 0;
		let preprocessCallCount = 0;
		let wrapperCallCount = 0;

		const priorPlugin = {
			parsers: {
				json: async () => {
					initializationCount += 1;
					await Promise.resolve();
					return {
						...babelParsers.json,
						parse: (text: string, options: ParserOptions) => {
							parseCallCount += 1;
							return babelParsers.json.parse(text, options);
						},
						preprocess: (text: string) => {
							preprocessCallCount += 1;
							return text.replace('[', '[2,');
						},
					};
				},
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

		const plugins =
			placement === 'alone'
				? [priorPlugin, wrapperPlugin]
				: [priorPlugin, wrapperPlugin, secondPlugin];

		const output = await format(TEST_JSON, { parser: 'json', plugins });

		expect(initializationCount).toBe(1);
		expect(parseCallCount).toBe(1);
		expect(preprocessCallCount).toBe(1);
		expect(wrapperCallCount).toBe(1);
		expect(output).toBe(expectedOutput);
	});

	test.each([
		'before an independent plugin instance',
		'before this plugin',
	] as const)(
		'passes wrapper lifecycle changes to the prior parser %s',
		async (placement) => {
			vi.resetModules();

			const firstPlugin = await import('../index.ts');
			const parser = getDirectParser(firstPlugin, 'json');

			if (placement === 'before an independent plugin instance') {
				vi.resetModules();
			}

			const secondPlugin = await import('../index.ts');

			const locEnd: Parser['locEnd'] = (node) =>
				babelParsers.json.locEnd(node);
			const locStart: Parser['locStart'] = (node) =>
				babelParsers.json.locStart(node);

			const reassignedPlugins: ParserOptions['plugins'] = [];
			let observedLifecycleState = false;
			let priorCallCount = 0;
			let wrapperCallCount = 0;

			const priorPlugin: Plugin = {
				parsers: {
					json: {
						...babelParsers.json,
						[hook]: (text: string, options: ParserOptions) => {
							priorCallCount += 1;
							observedLifecycleState =
								options.locEnd === locEnd &&
								options.locStart === locStart &&
								options.plugins === reassignedPlugins;
							return hook === 'parse'
								? babelParsers.json.parse(text, options)
								: text;
						},
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

			expect(observedLifecycleState).toBe(true);
			expect(priorCallCount).toBe(1);
			expect(wrapperCallCount).toBe(1);
			expect(output).toBe(expectedOutput);
		}
	);
});

test.each(['alone', 'before this plugin'] as const)(
	'runs wrapped hooks once %s without a prior parser',
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

		const plugins =
			placement === 'alone'
				? [wrapperPlugin]
				: [wrapperPlugin, pluginExpandJSON];

		const output = await format(TEST_JSON, { parser: 'json', plugins });

		expect(parseCallCount).toBe(1);
		expect(preprocessCallCount).toBe(1);
		expect(output).toBe(expectedOutput);
	}
);

test('restores original locations when a wrapper rejects after parsing', async () => {
	const parser = getDirectParser(pluginExpandJSON, 'json');

	const locEnd: Parser['locEnd'] = (node) => babelParsers.json.locEnd(node);
	const locStart: Parser['locStart'] = (node) =>
		babelParsers.json.locStart(node);

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
	let observedParsedLocations = false;
	let parseCallCount = 0;

	const wrapperPlugin = createJSONWrapperPlugin({
		...parser,
		parse: async (text, options) => {
			parseCallCount += 1;

			if (parseCallCount > 1) {
				throw new Error();
			}

			await parser.parse(text, options);

			observedParsedLocations =
				options.locEnd === locEnd && options.locStart === locStart;

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

	expect(observedParsedLocations).toBe(true);
	expect(parseCallCount).toBe(1);
	expect(options.astFormat).toBe(parser.astFormat);
	expect(options.locEnd).toBe(parser.locEnd);
	expect(options.locStart).toBe(parser.locStart);
	expect(options.plugins).toBe(originalPlugins);
});

test('preserves locations reset by a wrapper before parsing again', async () => {
	const parser = getDirectParser(pluginExpandJSON, 'json');

	const locEnd: Parser['locEnd'] = (node) => babelParsers.json.locEnd(node);
	const locStart: Parser['locStart'] = (node) =>
		babelParsers.json.locStart(node);

	let observedParsedLocations = false;
	let observedResetLocations = false;
	let parseCallCount = 0;
	let wrapperCallCount = 0;

	const priorPlugin: Plugin = {
		parsers: {
			json: {
				...babelParsers.json,
				locEnd,
				locStart,
				parse: (text, options) => {
					parseCallCount += 1;
					observedResetLocations =
						options.locEnd === parser.locEnd &&
						options.locStart === parser.locStart;
					return babelParsers.json.parse(text, options);
				},
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

			observedParsedLocations =
				options.locEnd === locEnd && options.locStart === locStart;

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

	expect(observedParsedLocations).toBe(true);
	expect(observedResetLocations).toBe(true);
	expect(parseCallCount).toBe(2);
	expect(wrapperCallCount).toBe(1);
	expect(output).toBe(expectedOutput);
});

test.each([
	['with a prior continuation', true],
	['without a prior continuation', false],
] as const)(
	'restores parser options after rejection %s',
	async (_, hasOuterContext) => {
		const parser = getDirectParser(pluginExpandJSON, 'json');
		const delegationKey = Symbol.for(
			'prettier-plugin-expand-json.parser-delegation'
		);

		const error = new Error();
		let reject = true;
		let wrapperCalls = 0;

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
				wrapperCalls += 1;

				if (wrapperCalls > 3) {
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

		const originalPlugins = options.plugins;

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

		if (hasOuterContext) {
			Reflect.set(options, delegationKey, outerContext);
		}

		await expect(parser.parse(TEST_JSON, options)).rejects.toBe(error);

		expect(Reflect.get(options, delegationKey)).toBe(
			hasOuterContext ? outerContext : undefined
		);
		expect(Object.hasOwn(options, delegationKey)).toBe(hasOuterContext);

		reject = false;

		await parser.parse(TEST_JSON, options);

		expect(wrapperCalls).toBe(2);
		expect(nativeParse).toHaveBeenCalledTimes(2);
		expect(outerContext.delegation.resolveNext).not.toHaveBeenCalled();
		expect(outerContext.syncOptions).toHaveBeenCalledTimes(
			hasOuterContext ? 2 : 0
		);
		expect(Reflect.get(options, delegationKey)).toBe(
			hasOuterContext ? outerContext : undefined
		);
		expect(Object.hasOwn(options, delegationKey)).toBe(hasOuterContext);
		expect(options.plugins).toBe(originalPlugins);
	}
);

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

	for (const hook of ['parse', 'preprocess'] as const) {
		const resolvedPriorParser = await resolvePriorParser(options, hook);

		expect(resolvedPriorParser?.parser).toBe(priorParser);
	}
});
