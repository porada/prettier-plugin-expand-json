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

	expect(pluginExpandJSON).toHaveProperty('options');
	expect(pluginExpandJSON).toHaveProperty('parsers');
	expect(pluginExpandJSON).toHaveProperty('printers');
	expect(pluginExpandJSON.printers).toHaveProperty('estree-expand-json');
	expect(pluginExpandJSON.printers).toHaveProperty('estree-json');
});

const TEST_JSON = `{
	"foo": [1, 2],
	"bar": [3],
	"baz": { "qux": [4] },
	"quux": [],
	"corge": {}
}`;

const TEST_JSONC = `{
	// Comment 1
	"foo": [1, 2],
	"bar": /* Comment 2 */ [3],
	// Comment 3
	"baz": { "qux": [4] },
	"quux": [], // Comment 4
	"corge": {},
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
		const options = {
			objectWrap: 'collapse' as const,
			parser,
			plugins: [pluginExpandJSON],
			printWidth: Number.POSITIVE_INFINITY,
		};

		const output = await format(input, options);

		expect(output).toMatchSnapshot();
		await expect(format(output, options)).resolves.toBe(output);
	});

	test('expands input embedded in Markdown', async () => {
		const options = {
			parser: 'markdown',
			plugins: [pluginExpandJSON],
		};

		const output = await format(
			`\`\`\`${markdownLanguage}\n${input}\n\`\`\`\n`,
			options
		);

		expect(output).toMatchSnapshot();
		await expect(format(output, options)).resolves.toBe(output);
	});

	if (parser === 'json') {
		test('normalizes numbers', async () => {
			const options = {
				parser,
				plugins: [pluginExpandJSON],
			};

			const output = await format('{"foo":1.230}', options);

			expect(output).toMatchInlineSnapshot(`
				"{
				  "foo": 1.23
				}
				"
			`);
			await expect(format(output, options)).resolves.toBe(output);
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
		});
	}

	test('respects `cursorOffset`', async () => {
		const input = '{"before":[1],"target":"foo|bar","after":[2]}\n';
		const cursorOffset = input.indexOf('|');

		const { cursorOffset: formattedCursorOffset, formatted } =
			await formatWithCursor(input, {
				cursorOffset,
				parser,
				plugins: [pluginExpandJSON],
			});

		expect(formatted).not.toBe(input);
		expect(formatted[formattedCursorOffset]).toBe('|');
		expect(formattedCursorOffset).toBe(formatted.indexOf('|'));
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
		const options = {
			endOfLine: 'crlf' as const,
			parser,
			plugins: [pluginExpandJSON],
		};

		const output = await format(input, options);

		expect(output).toContain('\r\n');
		expect(output).not.toMatch(/(^|[^\r])\n/);
		await expect(format(output, options)).resolves.toBe(output);
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
			const selectedInput = '{"foo":[1,2],"bar":{"baz":3}}';
			const input = `{
"outsideBefore" : [ 0 ,1 ],
"selected" :
${selectedInput},
"outsideAfter" : { "qux" : [ 4 ,5 ] }
}
`;
			const rangeStart = input.indexOf(selectedInput);
			const rangeEnd = rangeStart + selectedInput.length;
			const unchangedPrefix = input.slice(0, rangeStart);
			const unchangedSuffix = input.slice(rangeEnd);
			const options = {
				parser,
				plugins: [pluginExpandJSON],
				rangeEnd,
				rangeStart,
			};

			const selectedOutput = await format(selectedInput, {
				parser,
				plugins: [pluginExpandJSON],
			});
			const output = await format(input, options);

			expect(output).toBe(
				`${unchangedPrefix}${selectedOutput.trimEnd()}${unchangedSuffix}`
			);
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
		const options = {
			parser,
			plugins: [pluginExpandJSON],
			tabWidth: 4,
		};

		const output = await format(input, options);

		expect(output).toMatchSnapshot();
		await expect(format(output, options)).resolves.toBe(output);
	});

	if (parser === 'jsonc') {
		test('respects `trailingComma`', async () => {
			const options = {
				all: {
					parser,
					plugins: [pluginExpandJSON],
					trailingComma: 'all' as const,
				},
				none: {
					parser,
					plugins: [pluginExpandJSON],
					trailingComma: 'none' as const,
				},
			};

			const outputs = {
				all: await format(input, options.all),
				none: await format(input, options.none),
			};

			expect(outputs).toMatchSnapshot();
			await expect(format(outputs.all, options.all)).resolves.toBe(
				outputs.all
			);
			await expect(format(outputs.none, options.none)).resolves.toBe(
				outputs.none
			);

			await expect(standaloneFormat(input, options.all)).resolves.toBe(
				outputs.all
			);
			await expect(standaloneFormat(input, options.none)).resolves.toBe(
				outputs.none
			);
		});
	}

	test('respects `useTabs`', async () => {
		const options = {
			parser,
			plugins: [pluginExpandJSON],
			useTabs: true,
		};

		const output = await format(input, options);

		expect(output).toMatchSnapshot();
		await expect(format(output, options)).resolves.toBe(output);
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

		const options = {
			parser,
			plugins: [
				parser === 'json' ? pluginSortJSON : testPlugin,
				emptyPlugin,
				pluginExpandJSON,
			],
		};

		const output = await format(input, options);

		expect(output).toMatchSnapshot();
	});

	test('handles empty files', async () => {
		const input = '\n';
		const options = {
			parser,
			plugins: [pluginExpandJSON],
		};

		const output = await format(input, options);

		expect(output).toBe('');
		await expect(format(output, options)).resolves.toBe(output);
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
		const options = {
			parser,
			plugins: [pluginExpandJSON],
		};

		const expectedOutput = await format(input, options);
		const output = await standaloneFormat(input, options);

		expect(output).toBe(expectedOutput);
	});

	test('formats in standalone mode with native plugins', async () => {
		const options = {
			parser,
			plugins: [pluginBabel, pluginEstree, pluginExpandJSON],
		};

		const expectedOutput = await format(input, options);
		const output = await standaloneFormat(input, options);

		expect(output).toBe(expectedOutput);
	});
});
