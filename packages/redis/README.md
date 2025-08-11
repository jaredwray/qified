# @qified/redis

Redis message provider for [Qified](https://github.com/jaredwray/qified).

This package implements a message provider backed by Redis using the Redis `publish`/`subscribe` commands.

## Table of Contents

- [Installation](#installation)
- [Usage with Qified](#usage-with-qified)
- [API](#api)
  - [RedisMessageProviderOptions](#redismessageprovideroptions)
  - [defaultRedisUri](#defaultredisuri)
  - [RedisMessageProvider](#redismessageprovider)
    - [constructor](#constructor)
    - [publish](#publish)
    - [subscribe](#subscribe)
    - [unsubscribe](#unsubscribe)
    - [disconnect](#disconnect)
  - [createQified](#createqified)
- [Contributing](#contributing)
- [License](#license)

## Installation

```bash
pnpm add @qified/redis
```

## Usage with Qified

```ts
import { createQified } from "@qified/redis";
import type { Message } from "qified";

const qified = createQified({ uri: "redis://localhost:6379" });

await qified.subscribe("example-topic", {
        async handler(message: Message) {
                console.log(message);
        },
});

await qified.publish("example-topic", { id: "1", data: "Hello from Redis!" });

await qified.disconnect();
```

## API

### RedisMessageProviderOptions

Configuration options for the Redis message provider.

- `uri?`: Redis connection URI. Defaults to [`defaultRedisUri`](#defaultredisuri).

### defaultRedisUri

Default Redis connection string (`"redis://localhost:6379"`).

### RedisMessageProvider

Implements the `MessageProvider` interface using Redis pub/sub.

#### constructor(options?: RedisMessageProviderOptions)

Creates a new provider.

Options:

- `uri`: Redis connection URI (defaults to `"redis://localhost:6379"`).

#### publish(topic: string, message: Message)

Publishes a message to a topic.

#### subscribe(topic: string, handler: TopicHandler)

Subscribes a handler to a topic.

#### unsubscribe(topic: string, id?: string)

Unsubscribes a handler by id or all handlers for a topic.

#### disconnect()

Disconnects the underlying Redis clients and clears all subscriptions.

### createQified(options?: RedisMessageProviderOptions)

Convenience factory that returns a `Qified` instance configured with `RedisMessageProvider`.

## Contributing

Contributions are welcome! Please read the [CONTRIBUTING.md](../../CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md) for details on our process.

## License

MIT © Jared Wray. See [LICENSE](../../LICENSE) for details.

