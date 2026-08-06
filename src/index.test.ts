import type { Plugin } from 'prettier';
import { format } from 'prettier';
import * as pluginSortJSON from 'prettier-plugin-sort-json';
import * as pluginBabel from 'prettier/plugins/babel';
import { format as standaloneFormat } from 'prettier/standalone';
import { describe, expect, expectTypeOf, test } from 'vite-plus/test';
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
	"bar": /* Comment 2️⃣ */ [3],
	// Comment 3️⃣
	"baz": { "values": [4] },
	"qux": [], // Comment 4️⃣
	"quux": {},
}`;

const TESTS = [
	['JSON', 'json', TEST_JSONC, 'json'],
	['JSON.stringify', 'json-stringify', TEST_JSON, 'json'],
	['JSONC', 'jsonc', TEST_JSONC, 'jsonc'],
] as const;

describe.each(TESTS)('%s', (_, parser, input, markdownLanguage) => {
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

	test('expands input embedded in Markdown', async () => {
		const output = await format(
			`\`\`\`${markdownLanguage}\n${input}\n\`\`\`\n`,
			{
				parser: 'markdown',
				plugins: [pluginExpandJSON],
			}
		);

		expect(output).toMatchSnapshot();
	});

	if (parser === 'json') {
		test('normalizes numbers', async () => {
			const output = await format('{"foo":1.230}', {
				parser,
				plugins: [pluginExpandJSON],
			});

			expect(output).toMatchInlineSnapshot(`
				"{
				  "foo": 1.23
				}
				"
			`);
		});
	}

	test('respects `tabWidth`', async () => {
		const output = await format(input, {
			parser,
			plugins: [pluginExpandJSON],
			tabWidth: 4,
		});

		expect(output).toMatchSnapshot();
	});

	if (parser === 'jsonc') {
		test('respects `trailingComma`', async () => {
			for (const trailingComma of ['all', 'none'] as const) {
				const output = await format(input, {
					parser,
					plugins: [pluginExpandJSON],
					trailingComma,
				});

				expect(output).toMatchSnapshot();
			}
		});
	}

	test('respects `useTabs`', async () => {
		const output = await format(input, {
			parser,
			plugins: [pluginExpandJSON],
			useTabs: true,
		});

		expect(output).toMatchSnapshot();
	});

	test('works with other plugins', async () => {
		const testPlugin: Plugin = {
			parsers: {
				[parser]: {
					...pluginBabel.parsers[parser],
					preprocess: async () => {
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

	test('formats in standalone mode', async () => {
		const output = await standaloneFormat(input, {
			parser,
			plugins: [pluginExpandJSON],
		});

		expect(output).toMatchSnapshot();
	});
});
