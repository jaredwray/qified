[![site/logo.svg](site/logo.svg)](https://qified.org)

[![tests](https://github.com/jaredwray/qified/actions/workflows/tests.yaml/badge.svg)](https://github.com/jaredwray/qified/actions/workflows/tests.yaml)
[![GitHub license](https://img.shields.io/github/license/jaredwray/qified)](https://github.com/jaredwray/qified/blob/master/LICENSE)
[![codecov](https://codecov.io/gh/jaredwray/qified/graph/badge.svg?token=jcRdy8SkOG)](https://codecov.io/gh/jaredwray/qified)
[![npm](https://img.shields.io/npm/dm/qified)](https://npmjs.com/package/qified)
[![npm](https://img.shields.io/npm/v/qified)](https://npmjs.com/package/qified)

# qified
Task and Message Queues with Multiple Providers

## NOTE: This is a work in progress and not ready for production use. Please wait till v1.0.0 is released.

# Development and Testing

Qified is written in TypeScript and tests are written in `vitest`. To run the tests, use the following command:

1. `npm install` - This will install all the dependencies
2. `npm test:services:start` - This will start the services needed for testing (Redis, RabbitMQ, etc)
3. `npm test` - This will run the tests

To contribute follow the [Contributing Guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md).

# License

[MIT & © Jared Wray](LICENSE)