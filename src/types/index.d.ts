import type { Parser, ParserOptions, Plugin } from 'prettier';

export type ParserInitializer = () => Parser | Promise<Parser>;

export type ParserName = 'json' | 'json-stringify' | 'jsonc';

export type ParseWithCompatibility = (
	this: Parser,
	text: string,
	options: ParserOptions,
	optionsForCompatibility: ParserOptions
) => unknown;

export type PluginWithParsers = Omit<Plugin, 'parsers'> & {
	parsers: Record<string, Parser | ParserInitializer>;
};
