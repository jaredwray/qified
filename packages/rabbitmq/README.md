# @qified/rabbitmq

RabbitMQ message and task provider for [Qified](https://github.com/jaredwray/qified).

This package implements a message provider and a task provider backed by RabbitMQ. The message provider uses queues for publish/subscribe operations, and the task provider adds reliable task queue processing with retries, timeouts, and dead-letter queues.

## Table of Contents

- [Installation](#installation)
- [Usage with Qified](#usage-with-qified)
  - [Message Provider](#message-provider)
  - [Task Provider](#task-provider)
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
  - [RabbitMqTaskProviderOptions](#rabbitmqtaskprovideroptions)
  - [RabbitMqTaskProvider](#rabbitmqtaskprovider)
    - [constructor](#constructor-1)
    - [connect](#connect)
    - [enqueue](#enqueue)
    - [dequeue](#dequeue)
    - [unsubscribe](#unsubscribe-1)
    - [disconnect](#disconnect-1)
    - [getDeadLetterTasks](#getdeadlettertasks)
    - [getQueueStats](#getqueuestats)
    - [clearQueue](#clearqueue)
- [Contributing](#contributing)
- [License](#license)

## Installation

```bash
pnpm add @qified/rabbitmq
```

## Usage with Qified

### Message Provider

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

### Task Provider

```ts
import { RabbitMqTaskProvider } from "@qified/rabbitmq";

const taskProvider = new RabbitMqTaskProvider({ uri: "amqp://localhost:5672" });

// Enqueue a task
await taskProvider.enqueue("my-queue", {
        data: { action: "send-email", to: "user@example.com" },
});

// Dequeue and process tasks
await taskProvider.dequeue("my-queue", {
        id: "email-handler",
        handler: async (task, ctx) => {
                console.log("Processing task:", task.data);

                // Access attempt metadata
                console.log(`Attempt ${ctx.metadata.attempt} of ${ctx.metadata.maxRetries}`);

                // Extend the deadline if needed
                await ctx.extend(10_000);

                // Acknowledge the task on success
                await ctx.ack();
        },
});

// Get queue statistics
const stats = await taskProvider.getQueueStats("my-queue");
console.log(stats); // { waiting, processing, deadLetter }

// Get dead-letter tasks for inspection
const deadLetters = await taskProvider.getDeadLetterTasks("my-queue");

// Clean up
await taskProvider.disconnect();
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

### RabbitMqTaskProviderOptions

Configuration options for the RabbitMQ task provider. Extends `TaskProviderOptions`.

- `uri?`: RabbitMQ connection URI. Defaults to `"amqp://localhost:5672"`.
- `id?`: Unique identifier for this provider instance. Defaults to `"@qified/rabbitmq-task"`.
- `timeout?`: Default timeout in milliseconds for task processing. Defaults to `30000`.
- `retries?`: Default maximum retry attempts before a task is moved to the dead-letter queue. Defaults to `3`.
- `reconnectTimeInSeconds?`: Time in seconds to wait before reconnecting after connection loss. Set to `0` to disable. Defaults to `5`.

### RabbitMqTaskProvider

Implements the `TaskProvider` interface using RabbitMQ durable queues for reliable task processing. Extends `Hookified` for event emission. Features include:

- Automatic retries with configurable max attempts
- Task timeouts with automatic rejection on expiry
- Dead-letter queue for failed tasks
- Automatic reconnection on connection loss

#### constructor(options?: RabbitMqTaskProviderOptions)

Creates a new task provider instance.

#### connect()

Explicitly connects to RabbitMQ. Called automatically on first `enqueue` or `dequeue` if not called manually.

#### enqueue(queue: string, taskData: EnqueueTask)

Enqueues a task to the specified queue. Returns a `Promise<string>` with the generated task ID.

Task data options:

- `data`: The task payload (any serializable value).
- `id?`: Custom task ID. Auto-generated if omitted.
- `timeout?`: Per-task timeout override in milliseconds.
- `maxRetries?`: Per-task max retry override.
- `priority?`: Task priority value.

#### dequeue(queue: string, handler: TaskHandler)

Registers a handler to process tasks from the specified queue. The handler receives a `Task` and a `TaskContext`.

`TaskContext` methods:

- `ack()`: Acknowledge the task (removes it from the queue).
- `reject(requeue?: boolean)`: Reject the task. If `requeue` is `true` (default), re-enqueues for retry. After max retries, moves to dead-letter queue.
- `extend(ms: number)`: Extend the processing deadline by the given milliseconds.
- `metadata`: Object with `{ attempt, maxRetries }` for the current task.

#### unsubscribe(queue: string, id?: string)

Removes a handler by id, or all handlers for the queue if no id is provided.

#### disconnect(force?: boolean)

Disconnects from RabbitMQ and cleans up all consumers, timers, and in-memory state. If `force` is `true`, skips graceful channel close.

#### getDeadLetterTasks(queue: string)

Returns an array of tasks that have been moved to the dead-letter queue for the given queue.

#### getQueueStats(queue: string)

Returns statistics for the given queue:

```ts
{ waiting: number; processing: number; deadLetter: number }
```

#### clearQueue(queue: string)

Purges all tasks from the queue and its dead-letter queue, and clears all in-memory tracking state.

## Contributing

Contributions are welcome! Please read the [CONTRIBUTING.md](../../CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](../../CODE_OF_CONDUCT.md) for details on our process.

## License

MIT © Jared Wray. See [LICENSE](../../LICENSE) for details.

