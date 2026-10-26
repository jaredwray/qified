import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runIfMain, syncLicenses } from "./license-sync.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "license-sync-"));
	tempDirs.push(dir);
	return dir;
}

function writeFile(filePath: string, contents: string): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, contents);
}

function writePackage(dir: string, name: string, isPrivate = false): void {
	const manifest = isPrivate ? { name, private: true } : { name };
	writeFile(path.join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function workspace(root: string, packages: string[]): void {
	const lines = ["packages:", ...packages.map((entry) => `  - ${entry}`), ""];
	writeFile(path.join(root, "pnpm-workspace.yaml"), lines.join("\n"));
}

afterEach(() => {
	vi.restoreAllMocks();
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("syncLicenses", () => {
	it("copies the root LICENSE into publishable packages only", () => {
		const root = makeTempDir();
		const license = "MIT License\n";
		writeFile(path.join(root, "LICENSE"), license);
		workspace(root, ["packages/*"]);
		writePackage(path.join(root, "packages/fresh"), "fresh");
		writePackage(path.join(root, "packages/same"), "same");
		writeFile(path.join(root, "packages/same/LICENSE"), license);
		writePackage(path.join(root, "packages/stale"), "stale");
		writeFile(path.join(root, "packages/stale/LICENSE"), "old license\n");
		writePackage(path.join(root, "packages/hidden"), "hidden", true);
		writeFile(path.join(root, "packages/not-a-package/README.md"), "notes\n");
		writeFile(path.join(root, "packages/notes.txt"), "ignore\n");

		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const result = syncLicenses(root);

		expect(result.updated.toSorted()).toEqual(["packages/fresh", "packages/stale"]);
		expect(result.skipped).toEqual(["packages/same"]);
		expect(fs.readFileSync(path.join(root, "packages/fresh/LICENSE"), "utf8")).toBe(license);
		expect(fs.readFileSync(path.join(root, "packages/stale/LICENSE"), "utf8")).toBe(license);
		expect(fs.existsSync(path.join(root, "packages/hidden/LICENSE"))).toBe(false);
		expect(fs.existsSync(path.join(root, "packages/not-a-package/LICENSE"))).toBe(false);
		expect(log).toHaveBeenCalledWith("  packages/fresh");
		expect(log).toHaveBeenCalledWith("\nDone: 2 updated, 1 skipped");
	});

	it("resolves an exact workspace path", () => {
		const root = makeTempDir();
		writeFile(path.join(root, "LICENSE"), "MIT\n");
		workspace(root, ["packages/exact"]);
		writePackage(path.join(root, "packages/exact"), "exact");

		const result = syncLicenses(root);

		expect(result.updated).toEqual(["packages/exact"]);
		expect(fs.readFileSync(path.join(root, "packages/exact/LICENSE"), "utf8")).toBe("MIT\n");
	});

	it("skips missing paths and paths outside the repo root", () => {
		const root = makeTempDir();
		writeFile(path.join(root, "LICENSE"), "MIT\n");
		writeFile(path.join(root, "package.json"), JSON.stringify({ private: true }));
		workspace(root, [".", "missing/*", "missing-exact", "../outside", "../outside/*"]);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		const result = syncLicenses(root);

		expect(result).toEqual({ updated: [], skipped: [] });
		expect(warn).toHaveBeenCalledTimes(2);
		expect(warn).toHaveBeenNthCalledWith(1, "  Skipping path outside project root: ../outside");
		expect(warn).toHaveBeenNthCalledWith(2, "  Skipping path outside project root: ../outside");
	});

	it("does nothing when the workspace document has no package list", () => {
		const root = makeTempDir();
		writeFile(path.join(root, "LICENSE"), "MIT\n");
		writeFile(path.join(root, "pnpm-workspace.yaml"), "null\n");

		expect(syncLicenses(root)).toEqual({ updated: [], skipped: [] });
	});

	it("skips directory names that resolve outside the repo root", () => {
		const root = makeTempDir();
		writeFile(path.join(root, "LICENSE"), "MIT\n");
		workspace(root, ["packages/*"]);
		fs.mkdirSync(path.join(root, "packages"));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		const result = syncLicenses(root, () => [
			{ name: "notes.txt", isDirectory: () => false },
			{ name: "../../outside", isDirectory: () => true },
			{ name: "ok", isDirectory: () => true },
		] as fs.Dirent[]);

		expect(result).toEqual({ updated: [], skipped: [] });
		expect(warn).toHaveBeenCalledWith("  Skipping path outside project root: ../outside");
		expect(fs.existsSync(path.join(root, "packages/ok/LICENSE"))).toBe(false);
	});
});

describe("runIfMain", () => {
	it("does not sync when argv is missing or is another module", () => {
		const root = makeTempDir();

		expect(() => {
			runIfMain("file:///scripts/license-sync.ts", undefined, root);
		}).not.toThrow();
		expect(() => {
			runIfMain("file:///scripts/license-sync.ts", "/tmp/other.ts", root);
		}).not.toThrow();
		expect(fs.existsSync(path.join(root, "pnpm-workspace.yaml"))).toBe(false);
	});

	it("syncs when argv is this module", () => {
		const root = makeTempDir();
		writeFile(path.join(root, "LICENSE"), "MIT\n");
		workspace(root, ["packages/cli"]);
		writePackage(path.join(root, "packages/cli"), "cli");
		const scriptPath = "/tmp/license-sync.ts";

		runIfMain(pathToFileURL(scriptPath).href, scriptPath, root);

		expect(fs.readFileSync(path.join(root, "packages/cli/LICENSE"), "utf8")).toBe("MIT\n");
	});
});

describe("repository LICENSE files", () => {
	it("matches the root LICENSE in every publishable package", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const result = syncLicenses(repoRoot);

		expect(result.updated).toEqual([]);
		expect(result.skipped).toEqual(
			expect.arrayContaining([
				"packages/nats",
				"packages/qified",
				"packages/rabbitmq",
				"packages/redis",
				"packages/valkey",
				"packages/zeromq",
			]),
		);
		const rootLicense = fs.readFileSync(path.join(repoRoot, "LICENSE"), "utf8");
		for (const relative of result.skipped) {
			expect(fs.readFileSync(path.join(repoRoot, relative, "LICENSE"), "utf8")).toBe(rootLicense);
		}
		expect(log).toHaveBeenCalledWith(`\nDone: 0 updated, ${result.skipped.length} skipped`);
	});

	it("prints a no-op summary when the CLI runs", () => {
		const output = execFileSync("pnpm", ["exec", "tsx", "scripts/license-sync.ts"], {
			cwd: repoRoot,
			encoding: "utf8",
		});

		expect(output).toMatch(/Done: 0 updated, [1-9]\d* skipped/);
	}, 30_000);

	it("packs LICENSE into every publishable package tarball", () => {
		const destination = makeTempDir();
		execFileSync("pnpm", ["--filter", "./packages/**", "-r", "pack", "--pack-destination", destination], {
			cwd: repoRoot,
			encoding: "utf8",
			stdio: "pipe",
		});

		const tarballs = fs.readdirSync(destination).filter((name) => name.endsWith(".tgz"));
		expect(tarballs.length).toBeGreaterThanOrEqual(6);
		for (const tarball of tarballs) {
			const listing = execFileSync("tar", ["-tzf", path.join(destination, tarball)], {
				encoding: "utf8",
			});
			expect(listing.split("\n")).toContain("package/LICENSE");
		}
	}, 60_000);
});
