import {defineConfig} from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/*.ts'],
		coverage: {
			exclude: [
				'site/**',
				'vitest.config.ts',
				'dist/**',
				'test/**',
			],
		},
	},
});
