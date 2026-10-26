/**
 * Copy the root LICENSE into every publishable workspace package.
 * Modeled on https://github.com/jaredwray/keyv/blob/main/scripts/license-sync.ts
 *
 * Private packages are skipped; they are not published to npm.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as yaml from "js-yaml";

export type SyncResult = {
	updated: string[];
	skipped: string[];
};

type ReadDir = (directory: string) => fs.Dirent[];

const readDirectory: ReadDir = (directory) => fs.readdirSync(directory, { withFileTypes: true });

function safePath(rootDir: string, unsafePath: string): string | undefined {
	const resolved = path.resolve(rootDir, unsafePath);
	if (!resolved.startsWith(`${rootDir}${path.sep}`) && resolved !== rootDir) {
		console.warn(`  Skipping path outside project root: ${unsafePath}`);
		return undefined;
	}

	return resolved;
}

function isPublishablePackage(dir: string): boolean {
	const packageJsonPath = path.join(dir, "package.json");
	if (!fs.existsSync(packageJsonPath)) {
		return false;
	}

	const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
		private?: boolean;
	};
	return packageJson.private !== true;
}

function resolvePackageDirs(rootDir: string, globs: string[], readDir: ReadDir): string[] {
	const packageDirs: string[] = [];
	for (const glob of globs) {
		if (glob.endsWith("/*")) {
			const parentDir = safePath(rootDir, glob.slice(0, -2));
			if (parentDir && fs.existsSync(parentDir)) {
				for (const entry of readDir(parentDir)) {
					if (!entry.isDirectory()) {
						continue;
					}

					const dir = path.join(parentDir, entry.name);
					const relative = path.relative(rootDir, dir);
					if (safePath(rootDir, relative)) {
						packageDirs.push(dir);
					}
				}
			}
		} else {
			const dir = safePath(rootDir, glob);
			if (dir && fs.existsSync(dir)) {
				packageDirs.push(dir);
			}
		}
	}

	return packageDirs;
}

export function syncLicenses(rootDir: string, readDir: ReadDir = readDirectory): SyncResult {
	const license = fs.readFileSync(path.join(rootDir, "LICENSE"), "utf8");

	console.log("Syncing LICENSE from root to all packages");

	const workspaceYaml = fs.readFileSync(path.join(rootDir, "pnpm-workspace.yaml"), "utf8");
	const loaded = yaml.load(workspaceYaml);
	const workspaceConfig = (loaded ?? {}) as { packages?: string[] };
	const globs = workspaceConfig.packages ?? [];
	const packageDirs = resolvePackageDirs(rootDir, globs, readDir);

	const updated: string[] = [];
	const skipped: string[] = [];
	for (const dir of packageDirs) {
		if (!isPublishablePackage(dir)) {
			continue;
		}

		const relative = path.relative(rootDir, dir);
		const licensePath = path.join(dir, "LICENSE");
		if (fs.existsSync(licensePath) && fs.readFileSync(licensePath, "utf8") === license) {
			skipped.push(relative);
			continue;
		}

		fs.writeFileSync(licensePath, license);
		console.log(`  ${relative}`);
		updated.push(relative);
	}

	console.log(`\nDone: ${updated.length} updated, ${skipped.length} skipped`);
	return { updated, skipped };
}

export function runIfMain(moduleUrl: string, argv1: string | undefined, rootDir: string): void {
	if (argv1 && pathToFileURL(path.resolve(argv1)).href === moduleUrl) {
		syncLicenses(rootDir);
	}
}

const defaultRootDir = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
runIfMain(import.meta.url, process.argv[1], defaultRootDir);
