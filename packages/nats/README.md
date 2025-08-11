# @qified/nats

NATS message provider for [Qified](https://github.com/jaredwray/qified).

This package implements a message provider backed by NATS using the `publish`/`subscribe` operations.

## Table of Contents

- [Installation](#installation)
- [Usage with Qified](#usage-with-qified)
- [API](#api)
  - [NatsMessageProviderOptions](#natsmessageprovideroptions)
  - [defaultNatsUri](#defaultnatsuri)
  - [NatsMessageProvider](#natsmessageprovider)
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
pnpm add @qified/nats
```

## Usage with Qified

```ts
import { createQified } from "@qified/nats";
import type { Message } from "qified";

const qified = createQified({ uri: "localhost:4222" });

await qified.subscribe("example-topic", {
        async handler(message: Message) {
                console.log(message);
        },
});

await qified.publish("example-topic", { id: "1", data: "Hello from NATS!" });

await qified.disconnect();
```

## API

### NatsMessageProviderOptions

Configuration options for the NATS message provider.

- `uri?`: NATS connection URI. Defaults to [`defaultNatsUri`](#defaultnatsuri).

### defaultNatsUri

Default NATS connection string (`"localhost:4222"`).

### NatsMessageProvider

Implements the `MessageProvider` interface using NATS publish/subscribe.

#### constructor(options?: NatsMessageProviderOptions)

Creates a new provider.

Options:

- `uri`: NATS connection URI (defaults to `"localhost:4222"`).

#### publish(topic: string, message: Message)

Publishes a message to a topic.

#### subscribe(topic: string, handler: TopicHandler)

Subscribes a handler to a topic.

#### unsubscribe(topic: string, id?: string)

Unsubscribes a handler by id or all handlers for a topic.

#### disconnect()

Disconnects from the NATS server and clears all subscriptions.

### createQified(options?: NatsMessageProviderOptions)

Convenience factory that returns a `Qified` instance configured with `NatsMessageProvider`.

## Contributing

Contributions are welcome! Please read the [CONTRIBUTING.md](../../CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md) for details on our process.

## License

MIT © Jared Wray. See [LICENSE](../../LICENSE) for details.

