# @qified/rabbitmq

RabbitMQ message provider for [Qified](https://github.com/jaredwray/qified).

This package implements a message provider backed by RabbitMQ using queues for publish and subscribe operations.

## Table of Contents

- [Installation](#installation)
- [Usage with Qified](#usage-with-qified)
- [API](#api)
  - [RabbitMqMessageProviderOptions](#rabbitmqmessageprovideroptions)
  - [defaultRabbitMqUri](#defaultrabbitmquri)
  - [RabbitMqMessageProvider](#rabbitmqmessageprovider)
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
pnpm add @qified/rabbitmq
```

## Usage with Qified

```ts
import { createQified } from "@qified/rabbitmq";
import type { Message } from "qified";

const qified = createQified({ uri: "amqp://localhost:5672" });

await qified.subscribe("example-topic", {
        async handler(message: Message) {
                console.log(message);
        },
});

await qified.publish("example-topic", { id: "1", data: "Hello from RabbitMQ!" });

await qified.disconnect();
```

## API

### RabbitMqMessageProviderOptions

Configuration options for the RabbitMQ message provider.

- `uri?`: RabbitMQ connection URI. Defaults to [`defaultRabbitMqUri`](#defaultrabbitmquri).

### defaultRabbitMqUri

Default RabbitMQ connection string (`"amqp://localhost:5672"`).

### RabbitMqMessageProvider

Implements the `MessageProvider` interface using RabbitMQ queues.

#### constructor(options?: RabbitMqMessageProviderOptions)

Creates a new provider.

Options:

- `uri`: RabbitMQ connection URI (defaults to `"amqp://localhost:5672"`).

#### publish(topic: string, message: Message)

Publishes a message to a topic.

#### subscribe(topic: string, handler: TopicHandler)

Subscribes a handler to a topic.

#### unsubscribe(topic: string, id?: string)

Unsubscribes a handler by id or all handlers for a topic.

#### disconnect()

Cancels all subscriptions and closes the underlying RabbitMQ connection.

### createQified(options?: RabbitMqMessageProviderOptions)

Convenience factory that returns a `Qified` instance configured with `RabbitMqMessageProvider`.

## Contributing

Contributions are welcome! Please read the [CONTRIBUTING.md](../../CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md) for details on our process.

## License

MIT © Jared Wray. See [LICENSE](../../LICENSE) for details.

