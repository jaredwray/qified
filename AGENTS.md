# AGENTS.md

Guidelines for AI coding agents (Claude, Gemini, Codex).

## Project

Qified is a task and message queue library with multiple providers, built with TypeScript and Node.js (>=20). This is a monorepo containing:

- `qified` - Core package with in-memory provider
- `@qified/redis` - Redis provider
- `@qified/rabbitmq` - RabbitMQ provider
- `@qified/nats` - NATS provider
- `@qified/zeromq` - ZeroMQ provider

## Commands

- `pnpm install` - Install dependencies
- `pnpm build` - Build all packages
- `pnpm test` - Run linter and tests with coverage
- `pnpm test:services:start` - Start Docker services (Redis, RabbitMQ, etc.)
- `pnpm test:services:stop` - Stop Docker services

**Use pnpm, not npm.**

## Development Rules

1. **Always run `pnpm test` after every change** - You must test your changes every time, no exceptions. All tests must pass before committing.
2. **Maintain 100% code coverage** - Add tests for any new code. Every change must achieve 100% coverage. If coverage drops below 100%, add or update tests until it is restored.
3. **Follow existing code style** - Biome enforces formatting and linting

## Structure

- `packages/qified/` - Core package with types and in-memory providers
- `packages/redis/` - Redis provider
- `packages/rabbitmq/` - RabbitMQ provider
- `packages/nats/` - NATS provider
- `packages/zeromq/` - ZeroMQ provider
- `site/` - Website assets
