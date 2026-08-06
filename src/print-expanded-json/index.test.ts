import type { Plugin } from 'prettier';
import { format } from 'prettier';
import { parsers as babelParsers } from 'prettier/plugins/babel';
import { printers as estreePrinters } from 'prettier/plugins/estree';
import { expect, test } from 'vite-plus/test';
import printExpandedJSON from './index.ts';

const AST_FORMAT = 'estree-expanded-json-test';

const plugin: Plugin = {
	parsers: {
		json: {
			...babelParsers.json,
			astFormat: AST_FORMAT,
		},
		jsonc: {
			...babelParsers.jsonc,
			astFormat: AST_FORMAT,
		},
	},
	printers: {
		[AST_FORMAT]: {
			...estreePrinters.estree,
			print: printExpandedJSON,
		},
	},
};

test('expands non-empty arrays and objects', async () => {
	const output = await format(
		'{"foo":[1,2],"bar":/* Comment */{"baz":[3]},"qux":[],"quux":{}}',
		{
			parser: 'json',
			plugins: [plugin],
		}
	);

	expect(output).toMatchInlineSnapshot(`
		"{
		  "foo": [
		    1,
		    2
		  ],
		  "bar": /* Comment */ {
		    "baz": [
		      3
		    ]
		  },
		  "qux": [],
		  "quux": {}
		}
		"
	`);
});

test('expands an array containing only a dangling comment', async () => {
	const output = await format('{"foo":[/* Comment 1️⃣ */]}', {
		parser: 'jsonc',
		plugins: [plugin],
	});

	expect(output).toMatchInlineSnapshot(`
		"{
		  "foo": [
		    /* Comment 1️⃣ */
		  ],
		}
		"
	`);
});

test('expands an object containing only a dangling comment', async () => {
	const output = await format('{"bar":{/* Comment 2️⃣ */}}', {
		parser: 'jsonc',
		plugins: [plugin],
	});

	expect(output).toMatchInlineSnapshot(`
		"{
		  "bar": {
		    /* Comment 2️⃣ */
		  },
		}
		"
	`);
});

test('expands a nested container containing only a dangling comment', async () => {
	const output = await format('{"baz":[{/* Comment 3️⃣ */}]}', {
		parser: 'jsonc',
		plugins: [plugin],
	});

	expect(output).toMatchInlineSnapshot(`
		"{
		  "baz": [
		    {
		      /* Comment 3️⃣ */
		    },
		  ],
		}
		"
	`);
});

test('keeps truly empty arrays and objects compact', async () => {
	const output = await format('{"qux":[],"quux":{}}', {
		parser: 'jsonc',
		plugins: [plugin],
	});

	expect(output).toMatchInlineSnapshot(`
		"{
		  "qux": [],
		  "quux": {},
		}
		"
	`);
});
