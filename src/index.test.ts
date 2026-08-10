import type { Plugin } from 'prettier';
import { format, formatWithCursor } from 'prettier';
import * as pluginSortJSON from 'prettier-plugin-sort-json';
import * as pluginBabel from 'prettier/plugins/babel';
import * as pluginEstree from 'prettier/plugins/estree';
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
	test('is supported', () => {
		expect(pluginExpandJSON.parsers).toHaveProperty(parser);
	});

	test('expands non-empty arrays and objects', async () => {
		const output = await format(input, {
			objectWrap: 'collapse',
			parser,
			plugins: [pluginExpandJSON],
			printWidth: Number.POSITIVE_INFINITY,
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

	if (parser === 'jsonc') {
		test('respects `checkIgnorePragma`', async () => {
			const input = '/** @noformat */\n{"foo":[1]}\n';
			const options = {
				checkIgnorePragma: true,
				parser,
				plugins: [pluginExpandJSON],
			};

			const output = await format(input, options);

			expect(output).toBe(input);

			await expect(format(output, options)).resolves.toBe(output);
		});
	}

	test('respects `cursorOffset`', async () => {
		const input = '{"before":[1],"target":"alpha§omega","after":[2]}\n';
		const cursorOffset = input.indexOf('§');

		const { cursorOffset: formattedCursorOffset, formatted } =
			await formatWithCursor(input, {
				cursorOffset,
				parser,
				plugins: [pluginExpandJSON],
			});

		expect(formatted).not.toBe(input);
		expect(formatted[formattedCursorOffset]).toBe('§');
		expect(formattedCursorOffset).toBe(formatted.indexOf('§'));
	});

	test('respects `embeddedLanguageFormatting`', async () => {
		const embeddedInput = `\`\`\`${markdownLanguage}\n${input}\n\`\`\`\n`;

		const output = await format(embeddedInput, {
			embeddedLanguageFormatting: 'off',
			parser: 'markdown',
			plugins: [pluginExpandJSON],
		});

		expect(output).toBe(embeddedInput);
	});

	test('respects `endOfLine`', async () => {
		const output = await format(input, {
			endOfLine: 'crlf',
			parser,
			plugins: [pluginExpandJSON],
		});

		expect(output).toContain('\r\n');
		expect(output).not.toMatch(/(^|[^\r])\n/);
	});

	if (parser === 'jsonc') {
		test('respects `insertPragma`', async () => {
			const input = '{"foo":[1]}\n';
			const options = {
				insertPragma: true,
				parser,
				plugins: [pluginExpandJSON],
			};

			const output = await format(input, options);

			expect(output).toMatchInlineSnapshot(`
				"/** @format */

				{
				  "foo": [
				    1,
				  ],
				}
				"
			`);

			await expect(format(output, options)).resolves.toBe(output);
		});

		test('respects `prettier-ignore` comments', async () => {
			const input = `{
				// prettier-ignore
				"foo": [ 1 , 2 ],
				"bar":[3]
			}`;
			const options = {
				parser,
				plugins: [pluginExpandJSON],
			};

			const output = await format(input, options);

			expect(output).toMatchInlineSnapshot(`
				"{
				  // prettier-ignore
				  "foo": [ 1 , 2 ],
				  "bar": [
				    3,
				  ],
				}
				"
			`);

			await expect(format(output, options)).resolves.toBe(output);
		});
	}

	if (parser !== 'json-stringify') {
		test('respects `rangeStart` and `rangeEnd`', async () => {
			const selectedInput = '{"alpha":[1,2],"beta":{"gamma":3}}';
			const input = `{
"outsideBefore" : [ 0 ,1 ],
"selected" :
${selectedInput},
"outsideAfter" : { "omega" : [ 4 ,5 ] }
}
`;
			const rangeStart = input.indexOf(selectedInput);
			const rangeEnd = rangeStart + selectedInput.length;
			const unchangedPrefix = input.slice(0, rangeStart);
			const unchangedSuffix = input.slice(rangeEnd);

			const output = await format(input, {
				parser,
				plugins: [pluginExpandJSON],
				rangeEnd,
				rangeStart,
			});

			expect(output).not.toBe(input);
			expect(output.slice(0, unchangedPrefix.length)).toBe(
				unchangedPrefix
			);
			expect(output.slice(-unchangedSuffix.length)).toBe(unchangedSuffix);
			expect(output).toContain('"alpha": [\n');
		});
	}

	if (parser === 'jsonc') {
		test('respects `requirePragma`', async () => {
			const input = '/** @format */\n{"foo":[1]}\n';
			const unformattedInput = '{"foo":[1]}\n';
			const options = {
				parser,
				plugins: [pluginExpandJSON],
				requirePragma: true,
			};

			const output = await format(input, options);

			expect(output).toMatchInlineSnapshot(`
				"/** @format */
				{
				  "foo": [
				    1,
				  ],
				}
				"
			`);

			await expect(format(output, options)).resolves.toBe(output);
			await expect(format(unformattedInput, options)).resolves.toBe(
				unformattedInput
			);
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
				const options = {
					parser,
					plugins: [pluginExpandJSON],
					trailingComma,
				};

				const output = await format(input, options);
				const standaloneOutput = await standaloneFormat(input, options);

				expect(output).toMatchSnapshot();
				expect(standaloneOutput).toBe(output);
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

	if (parser === 'jsonc') {
		test('preserves comment-only files', async () => {
			const input = '// Comment\n';

			const output = await format(input, {
				parser,
				plugins: [pluginExpandJSON],
			});

			expect(output).toBe(input);
		});
	}

	test('formats in standalone mode with bundled parser and printer fallbacks', async () => {
		const output = await standaloneFormat(input, {
			parser,
			plugins: [pluginExpandJSON],
		});

		expect(output).toMatchSnapshot();
	});

	test('formats in standalone mode with native plugins', async () => {
		const output = await standaloneFormat(input, {
			parser,
			plugins: [pluginBabel, pluginEstree, pluginExpandJSON],
		});

		expect(output).toMatchSnapshot();
	});
});
