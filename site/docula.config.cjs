const fs = require('node:fs');
const path = require('node:path');
const process = require('node:process');

module.exports.options = {
	githubPath: 'jaredwray/qified',
	outputPath: './site/dist',
	siteTitle: 'Qified',
	siteDescription: 'Task and Message Queues with Multiple Providers',
	siteUrl: 'https://qified.org',
};

module.exports.onPrepare = async config => {
	const readmePath = path.join(process.cwd(), './README.md');
	const readmeSitePath = path.join(config.sitePath, 'README.md');
	const readme = await fs.promises.readFile(readmePath, 'utf8');
	const updatedReadme = readme.replace('<img src="site/logo.svg" alt="Hookified" height="400" align="center">\n\n', '');
	console.log('writing updated readme to', readmeSitePath);
	await fs.promises.writeFile(readmeSitePath, updatedReadme);
};
