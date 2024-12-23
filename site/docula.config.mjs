import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export const options = {
	githubPath: 'jaredwray/qified',
	outputPath: './site/dist',
	siteTitle: 'Qified',
	siteDescription: 'Task and Message Queues with Multiple Providers',
	siteUrl: 'https://qified.org',
};

export const onPrepare = async config => {
	const readmePath = path.join(process.cwd(), './README.md');
	const readmeSitePath = path.join(config.sitePath, 'README.md');
	const readme = await fs.promises.readFile(readmePath, 'utf8');
	const updatedReadme = readme.replace('[![site/logo.svg](site/logo.svg)](https://qified.org)', '');
	console.log('writing updated readme to', readmeSitePath);
	await fs.promises.writeFile(readmeSitePath, updatedReadme);
};
