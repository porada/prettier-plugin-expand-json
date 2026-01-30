import type { Plugin } from 'prettier';

type ParserName = 'json' | 'json-stringify' | 'jsonc';

export type PluginWithParsers = Omit<Plugin, 'parsers'> & {
	parsers: NonNullable<Plugin['parsers']>;
};
