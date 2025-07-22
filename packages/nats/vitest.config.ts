import {defineConfig} from 'vitest/config';

export default defineConfig({
	test: {
		include: ['test/*.ts'],
		coverage: {
			reporter: ['text', 'json', 'lcov'],
			exclude: [
				'vitest.config.ts',
				'dist/**',
				'test/**',
				'src/types.ts',
			],
		},
	},
});
