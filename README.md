[![site/logo.svg](site/logo.svg)](https://qified.org)

[![tests](https://github.com/jaredwray/qified/actions/workflows/tests.yaml/badge.svg)](https://github.com/jaredwray/qified/actions/workflows/tests.yaml)
[![GitHub license](https://img.shields.io/github/license/jaredwray/qified)](https://github.com/jaredwray/qified/blob/main/LICENSE)
[![codecov](https://codecov.io/gh/jaredwray/qified/graph/badge.svg?token=jcRdy8SkOG)](https://codecov.io/gh/jaredwray/qified)
[![npm](https://img.shields.io/npm/dm/qified)](https://npmjs.com/package/qified)
[![npm](https://img.shields.io/npm/v/qified)](https://npmjs.com/package/qified)

# qified
Task and Message Queues with Multiple Providers

> NOTE: This is a work in progress and not ready for production use. Please wait till v1.0.0 is released.

This is a mono repo that contains the following packages:
* [qified](packages/qified/README.md) - The main package that contains the core functionality and a built in in-memory provider.

Additional packages:
* [@qified/redis](packages/redis/README.md) - Redis Provider
* [@qified/rabbitmq](packages/rabbitmq/README.md) - RabbitMQ Provider
* [@qified/nats](packages/nats/README.md) - NATS Provider
* [@qified/zeromq](packages/zeromq/README.md) - ZeroMQ Provider

# Development and Testing

Qified is written in TypeScript and tests are written in `vitest`. To run the tests, use the following command:

1. `nvm use` - This will use the correct node version
2. `pnpm install` - This will install all the dependencies
3. `pnpm test:services:start` - This will start the services needed for testing (Redis, RabbitMQ, etc)
4. `pnpm test` - This will run the tests

To contribute follow the [Contributing Guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md).

# Publishing

This is a mono repo and uses [pnpm](https://pnpm.io/) for package management. In addition all packages are versioned using [semantic versioning](https://semver.org/) and are published using github actions. To do a version bump and publish, follow these steps:

1. Make sure you have the latest changes from the main branch.
2. Update the `package.json` in the root directory with the new version number.
   - If you are making a breaking change, use the `major` version bump. `X.0.0`
   - If you are adding new features, use the `minor` version bump. `0.X.0`
   - If you are making a bug fix, use the `patch` version bump. `0.0.X`
3. Sync the version changes to all packages by running `pnpm version:sync`.
4. Check the changes and commit them to the main branch.
5. Do a release on GitHub. This will trigger the GitHub Actions workflow to publish the packages.

# License
[MIT & © Jared Wray](LICENSE)