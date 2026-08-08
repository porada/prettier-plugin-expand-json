import type {
	ParserHookName,
	ParserInitializer,
	ParserName,
	ParseWithCompatibility,
	PluginWithParsers,
	ResolvedPriorParser,
} from './index.d.ts';
import { expectTypeOf, test } from 'vite-plus/test';

test('exposes valid types', () => {
	expectTypeOf<ParserHookName>().toEqualTypeOf<'parse' | 'preprocess'>();

	expectTypeOf<ParserInitializer>().toBeFunction();

	expectTypeOf<ParserName>().toEqualTypeOf<
		'json' | 'json-stringify' | 'jsonc'
	>();

	expectTypeOf<ParseWithCompatibility>().toBeFunction();

	expectTypeOf<PluginWithParsers>().toBeObject();
	expectTypeOf<PluginWithParsers>().toHaveProperty('parsers');

	expectTypeOf<ResolvedPriorParser>().toBeObject();
	expectTypeOf<ResolvedPriorParser>().toHaveProperty('locationState');
	expectTypeOf<ResolvedPriorParser>().toHaveProperty('parser');
	expectTypeOf<ResolvedPriorParser>().toHaveProperty('plugins');
});
