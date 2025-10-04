# @qified/zeromq

ZeroMQ message provider for [Qified](https://github.com/jaredwray/qified).

This package implements a message provider backed by ZeroMQ using queues for publish and subscribe operations.

## Table of Contents

- [Installation](#installation)
- [Usage with Qified](#usage-with-qified)
- [API](#api)
  - [ZmqMessageProviderOptions](#ZmqMessageProviderOptions)
  - [defaultZmqUri](#defaultzmquri)
  - [ZmqMessageProvider](#zmqmessageprovider)
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
pnpm add @qified/zeromq
```

## Usage with Qified

```ts
import { createQified } from "@qified/zeromq";
import type { Message } from "qified";

// Standalone mode (default) - peer-to-peer messaging in same process
const qified = createQified({ uri: "tcp://localhost:5555" });

await qified.subscribe("example-topic", {
        async handler(message: Message) {
                console.log(message);
        },
});

await qified.publish("example-topic", { id: "1", data: "Hello from ZeroMQ!" });

await qified.disconnect();
```

### Usage with External Broker (Multi-Process)

To enable communication between multiple processes or containers, use broker mode with the ZeroMQ proxy:

```ts
import { createQified } from "@qified/zeromq";
import type { Message } from "qified";

// Broker mode - connects to external ZeroMQ proxy
const qified = createQified({
  uri: "tcp://localhost:5555",
  mode: "broker"
});

await qified.subscribe("example-topic", {
        async handler(message: Message) {
                console.log(message);
        },
});

await qified.publish("example-topic", { id: "1", data: "Hello from ZeroMQ!" });

await qified.disconnect();
```

Run the broker using Docker:

```bash
docker-compose up zeromq
```

## API

### ZmqMessageProviderOptions

Configuration options for the ZeroMQ message provider.

- `uri?`: ZeroMQ connection URI. Defaults to [`defaultZmqUri`](#defaultzmquri).
- `mode?`: Connection mode - `'standalone'` (default) for peer-to-peer or `'broker'` for external proxy.

### defaultZmqUri

Default ZeroMQ connection string (`"tcp://localhost:5555"`).

### ZmqMessageProvider

Implements the `MessageProvider` interface using ZeroMQ queues.

#### constructor(options?: ZmqMessageProviderOptions)

Creates a new provider.

Options:

- `uri`: ZeroMQ connection URI (defaults to `"tcp://localhost:5555"`).
- `mode`: Connection mode - `'standalone'` or `'broker'` (defaults to `'standalone'`).

#### publish(topic: string, message: Message)

Publishes a message to a topic.

#### subscribe(topic: string, handler: TopicHandler)

Subscribes a handler to a topic.

#### unsubscribe(topic: string, id?: string)

Unsubscribes a handler by id or all handlers for a topic.

#### disconnect()

Cancels all subscriptions and closes the underlying ZeroMQ Publisher/Subscriber.

### createQified(options?: ZmqMessageProviderOptions)

Convenience factory that returns a `Qified` instance configured with `ZmqMessageProvider`.

## Contributing

Contributions are welcome! Please read the [CONTRIBUTING.md](../../CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md) for details on our process.

## License

MIT © Jared Wray. See [LICENSE](../../LICENSE) for details.

