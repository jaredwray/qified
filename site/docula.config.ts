import type {DoculaOptions, DoculaConsole} from 'docula';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export const options: Partial<DoculaOptions> = {
	githubPath: 'jaredwray/qified',
	siteTitle: 'Qified',
	siteDescription: 'Task and Message Queues with Multiple Providers',
	siteUrl: 'https://qified.org',
	themeMode: 'light',
	autoReadme: false,
};

export const onPrepare = async (config: DoculaOptions, console: DoculaConsole) => {
	const docsPath = path.join(config.sitePath, 'docs');
	await fs.promises.mkdir(docsPath, {recursive: true});

	// Copy main qified README to docs/index.md
	const readmePath = path.join(process.cwd(), './packages/qified/README.md');
	const readmeSitePath = path.join(config.sitePath, 'docs/index.md');
	const readme = await fs.promises.readFile(readmePath, 'utf8');
	const updatedReadme = readme.replace('[![logo.svg](https://qified.org/logo.svg)](https://qified.org)', '');

	// Add frontmatter to main README
	const frontmatter = `---
title: 'qified'
sidebarTitle: 'qified'
order: 1
---
`;
	console.info('writing qified to docs/index.md');
	await fs.promises.writeFile(readmeSitePath, frontmatter + updatedReadme);

	// Copy each package README to site/docs folder
	const packagesDir = path.join(process.cwd(), './packages');
	const allPackages = await fs.promises.readdir(packagesDir, {withFileTypes: true});
	const packages = allPackages
		.filter(dirent => dirent.isDirectory() && dirent.name !== 'qified')
		.map(dirent => dirent.name);

	for (const pkg of packages) {
		const pkgReadmePath = path.join(process.cwd(), `./packages/${pkg}/README.md`);
		const pkgSitePath = path.join(docsPath, `${pkg}.md`);

		try {
			const pkgReadme = await fs.promises.readFile(pkgReadmePath, 'utf8');

			// Add frontmatter to package README
			const pkgFrontmatter = `---
title: '@qified/${pkg}'
sidebarTitle: '@qified/${pkg}'
---

`;
			console.info(`writing ${pkg} readme to docs/${pkg}.md`);
			await fs.promises.writeFile(pkgSitePath, pkgFrontmatter + pkgReadme);
		} catch (error) {
			console.error(`Error copying ${pkg} README: ${(error as Error).message}`);
		}
	}
};
