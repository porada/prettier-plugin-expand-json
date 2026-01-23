import { defineConfig } from '@standard-config/prettier';
import * as pluginExpandJSON from './src/index.ts';

export default defineConfig({
	pluginOverrides: {
		'prettier-plugin-expand-json': pluginExpandJSON,
	},
});
