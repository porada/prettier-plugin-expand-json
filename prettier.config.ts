import { defineConfig } from '@standard-config/prettier';
import * as pluginExpandJSON from './src/index.ts';

const config = defineConfig({
	plugins: [pluginExpandJSON],
});

for (const override of config.overrides ?? []) {
	if (override.files?.includes('*.json')) {
		override.options?.plugins?.push(pluginExpandJSON);
	}
}

export default config;
