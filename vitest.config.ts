import { defineConfig } from "vitest/config";

// Root config for monorepo maintenance scripts. Package tests use each
// package's own vitest.config.ts via `pnpm -r test`.
export default defineConfig({
	test: {
		include: ["scripts/**/*.test.ts"],
		coverage: {
			provider: "v8",
			include: ["scripts/license-sync.ts"],
			reporter: ["text", "json", "lcov"],
			thresholds: {
				lines: 100,
				functions: 100,
				branches: 100,
				statements: 100,
			},
		},
	},
});
