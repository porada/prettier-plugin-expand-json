import type { Parser, ParserOptions, Plugin } from 'prettier';

export type ParserHookName = 'parse' | 'preprocess';

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

export type ResolvedPriorParser = {
	locationState: Partial<Pick<ParserOptions, 'locEnd' | 'locStart'>>;
	parser: Parser;
	plugins: ParserOptions['plugins'];
};
