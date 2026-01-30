import type { ParserName, PluginWithParsers } from './index.d.ts';
import { expectTypeOf, test } from 'vitest';

test('exposes valid types', () => {
	expectTypeOf<ParserName>().not.toBeAny();
	expectTypeOf<ParserName>().not.toBeNever();

	expectTypeOf<PluginWithParsers>().toBeObject();
	expectTypeOf<PluginWithParsers>().toHaveProperty('parsers');
});
