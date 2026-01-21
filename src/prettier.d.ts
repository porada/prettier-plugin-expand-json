import type { Printer } from 'prettier';

// Pending pull request:
// https://github.com/prettier/prettier/pull/18706
declare module 'prettier/plugins/estree' {
	export const printers: {
		'estree': Printer;
		'estree-json': Printer;
	};
}
