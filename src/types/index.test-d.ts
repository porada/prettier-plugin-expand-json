import type {
	ParserInitializer,
	ParserName,
	ParseWithCompatibility,
	PluginWithParsers,
} from './index.d.ts';
import { expectTypeOf, test } from 'vite-plus/test';

test('exposes valid types', () => {
	expectTypeOf<ParserInitializer>().toBeFunction();

	expectTypeOf<ParserName>().not.toBeAny();
	expectTypeOf<ParserName>().not.toBeNever();

	expectTypeOf<ParseWithCompatibility>().toBeFunction();

	expectTypeOf<PluginWithParsers>().toBeObject();
	expectTypeOf<PluginWithParsers>().toHaveProperty('parsers');
});
