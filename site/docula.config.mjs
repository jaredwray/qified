import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export const options = {
	githubPath: 'jaredwray/qified',
	outputPath: './site/dist',
	siteTitle: 'Qified',
	siteDescription: 'Task and Message Queues with Multiple Providers',
	siteUrl: 'https://qified.org',
	sections: [
	],
};

export const onPrepare = async config => {
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
	console.log('writing qified to', readmeSitePath);
	await fs.promises.writeFile(readmeSitePath, frontmatter + updatedReadme);

	// Copy each package README to site/docs folder
	const packages = ['redis', 'rabbitmq', 'nats', 'zeromq'];
	const docsPath = path.join(config.sitePath, 'docs');

	// Create docs directory if it doesn't exist
	await fs.promises.mkdir(docsPath, { recursive: true });

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
			console.log(`writing ${pkg} readme to`, pkgSitePath);
			await fs.promises.writeFile(pkgSitePath, pkgFrontmatter + pkgReadme);
		} catch (error) {
			console.error(`Error copying ${pkg} README:`, error.message);
		}
	}
};
