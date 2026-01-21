import type { Plugin } from 'prettier';
import { format } from 'prettier';
import * as pluginSortJSON from 'prettier-plugin-sort-json';
import { parsers as babelParsers } from 'prettier/plugins/babel';
import { describe, expect, expectTypeOf, test } from 'vitest';
import * as pluginExpandJSON from './index.ts';

test('exposes correct public API', () => {
	expectTypeOf(pluginExpandJSON).toExtend<Plugin>();

	expect(pluginExpandJSON).toHaveProperty('parsers');
	expect(pluginExpandJSON).toHaveProperty('printers');
});

const TEST_JSON = `{
		"foo": [1, 2],
		"bar": [3],
		"baz": { "values": [4] },
		"qux": [],
		"quux": {}
	}`;

const TEST_JSONC = `{
		// Comment 1️⃣
		"foo": [1, 2],
		"bar": [3],
		// Comment 2️⃣
		"baz": { "values": [4] },
		"qux": [], // Comment 3️⃣
		"quux": {},
	}`;

const TESTS = [
	['JSON', 'json', TEST_JSON],
	['JSON.stringify', 'json-stringify', TEST_JSON],
	['JSONC', 'jsonc', TEST_JSONC],
] as const;

describe.each(TESTS)('%s', (_, parser, input) => {
	test('is a supported', () => {
		expect(pluginExpandJSON.parsers).toHaveProperty(parser);
	});

	test('expands non-empty arrays and objects', async () => {
		const output = await format(input, {
			parser,
			plugins: [pluginExpandJSON],
		});

		expect(output).toMatchSnapshot();
	});

	test('respects custom formatting options', async () => {
		let output = await format(input, {
			parser,
			plugins: [pluginExpandJSON],
			useTabs: true,
		});

		expect(output).toMatchSnapshot();

		output = await format(input, {
			parser,
			plugins: [pluginExpandJSON],
			tabWidth: 4,
			useTabs: false,
		});

		expect(output).toMatchSnapshot();
	});

	test('works with other plugins', async () => {
		const testPlugin: Plugin = {
			parsers: {
				[parser]: {
					...babelParsers[parser],
					preprocess: async () => {
						/* oxlint-disable-next-line eslint/no-promise-executor-return */
						await new Promise((resolve) => setTimeout(resolve));
						return JSON.stringify({ foo: {}, bar: ['baz'] });
					},
				},
			},
		};

		const emptyPlugin: Plugin = {};

		const output = await format(input, {
			parser,
			plugins: [
				parser === 'json' ? pluginSortJSON : testPlugin,
				emptyPlugin,
				pluginExpandJSON,
			],
		});

		expect(output).toMatchSnapshot();
	});

	test('handles empty files', async () => {
		const input = '\n';

		const output = await format(input, {
			parser,
			plugins: [pluginExpandJSON],
		});

		expect(output).toBe('');
	});
});
