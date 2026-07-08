# @qified/valkey

Valkey message provider for [Qified](https://github.com/jaredwray/qified).

This package implements a message provider backed by [Valkey](https://valkey.io) using the Valkey `publish`/`subscribe` commands. It is built on the [`iovalkey`](https://github.com/valkey-io/iovalkey) client and, because Valkey is wire-compatible with Redis, connects using `redis://` URIs.

## Table of Contents

- [Installation](#installation)
- [Usage with Qified](#usage-with-qified)
- [API](#api)
  - [ValkeyMessageProviderOptions](#valkeymessageprovideroptions)
  - [defaultValkeyUri](#defaultvalkeyuri)
  - [ValkeyMessageProvider](#valkeymessageprovider)
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
pnpm add @qified/valkey
```

## Usage with Qified

```ts
import { createQified } from "@qified/valkey";
import type { Message } from "qified";

const qified = createQified({ uri: "redis://localhost:6380" });

await qified.subscribe("example-topic", {
        async handler(message: Message) {
                console.log(message);
        },
});

await qified.publish("example-topic", { id: "1", data: "Hello from Valkey!" });

await qified.disconnect();
```

## API

### ValkeyMessageProviderOptions

Configuration options for the Valkey message provider.

- `uri?`: Valkey connection URI. Defaults to [`defaultValkeyUri`](#defaultvalkeyuri).

### defaultValkeyUri

Default Valkey connection string (`"redis://localhost:6380"`).

### ValkeyMessageProvider

Implements the `MessageProvider` interface using Valkey pub/sub.

#### constructor(options?: ValkeyMessageProviderOptions)

Creates a new provider.

Options:

- `uri`: Valkey connection URI (defaults to `"redis://localhost:6380"`).

#### publish(topic: string, message: Message)

Publishes a message to a topic.

#### subscribe(topic: string, handler: TopicHandler)

Subscribes a handler to a topic.

#### unsubscribe(topic: string, id?: string)

Unsubscribes a handler by id or all handlers for a topic.

#### disconnect()

Disconnects the underlying Valkey clients and clears all subscriptions.

### createQified(options?: ValkeyMessageProviderOptions)

Convenience factory that returns a `Qified` instance configured with `ValkeyMessageProvider`.

## Contributing

Contributions are welcome! Please read the [CONTRIBUTING.md](../../CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md) for details on our process.

## License

MIT © Jared Wray. See [LICENSE](../../LICENSE) for details.
