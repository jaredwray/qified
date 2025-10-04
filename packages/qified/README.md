[![logo.svg](https://qified.org/logo.svg)](https://qified.org)

[![tests](https://github.com/jaredwray/qified/actions/workflows/tests.yaml/badge.svg)](https://github.com/jaredwray/qified/actions/workflows/tests.yaml)
[![GitHub license](https://img.shields.io/github/license/jaredwray/qified)](https://github.com/jaredwray/qified/blob/master/LICENSE)
[![codecov](https://codecov.io/gh/jaredwray/qified/graph/badge.svg?token=jcRdy8SkOG)](https://codecov.io/gh/jaredwray/qified)
[![npm](https://img.shields.io/npm/dm/qified)](https://npmjs.com/package/qified)
[![npm](https://img.shields.io/npm/v/qified)](https://npmjs.com/package/qified)

# qified
Task and Message Queues with Multiple Providers

## NOTE: This is a work in progress and not ready for production use. Please wait till v1.0.0 is released.

# Features

* Simple Message Queue for Processing Messages
* Simple Message Format `Message`
* Easily Send a Message `publish()`
* Easily Subscribe to a message Queue `subscribe()`
* Simple Task Format `Task` (Coming in v2.0.0)
* Easily Send a Task `enqueue()` (Coming in v2.0.0)
* Easily Subscribe to a Task Queue `dequeue()` (Coming in v2.0.0)
* Simple Acknowledge `Acknowledge()` in handler (Coming in v2.0.0)
* Async/Await Built In By Default
* Written in Typescript, Nodejs Last Two Versions, ESM and CJS
* Events and Hooks for all major actions via [Hookified](https://hookified.org)
* Customizable Serialize / Deserialize Handlers (Coming in v2.0.0)
* Customizable Compress / Decompress Handlers (Coming in v2.0.0)
* Provider Fail Over Support

# Installation

```bash
pnpm add qified
```

# Quick Start

```typescript
import { Qified, MemoryMessageProvider } from 'qified';

// Create a new Qified instance with a memory provider
const qified = new Qified({
  messageProviders: [new MemoryMessageProvider()]
});

// Subscribe to a topic
await qified.subscribe('notifications', {
  id: 'notificationHandler',
  handler: async (message) => {
    console.log('Received:', message.data);
  }
});

// Publish a message
await qified.publish('notifications', {
  id: 'msg-1',
  data: { text: 'Hello, World!' }
});

// Clean up
await qified.disconnect();
```

# API Documentation

## Qified Class

The main class for managing message queues and task queues.

### Constructor

```typescript
new Qified(options?: QifiedOptions)
```

**Options:**
- `messageProviders?: MessageProvider[]` - Array of message providers to use
- `taskProviders?: TaskProvider[]` - Array of task providers to use

**Example:**
```typescript
import { Qified, MemoryMessageProvider } from 'qified';

const qified = new Qified({
  messageProviders: [new MemoryMessageProvider()]
});
```

### Methods

#### `subscribe(topic: string, handler: TopicHandler): Promise<void>`

Subscribe to a topic to receive messages. If multiple message providers are configured, this will subscribe on all of them.

**Parameters:**
- `topic: string` - The topic to subscribe to
- `handler: TopicHandler` - Object containing an optional `id` and a `handler` function

**Example:**
```typescript
await qified.subscribe('user-events', {
  id: 'userEventHandler',
  handler: async (message) => {
    console.log('User event:', message.data);
  }
});
```

#### `publish(topic: string, message: Message): Promise<void>`

Publish a message to a topic. If multiple message providers are configured, this will publish to all of them.

**Parameters:**
- `topic: string` - The topic to publish to
- `message: Message` - The message object to publish

**Example:**
```typescript
await qified.publish('user-events', {
  id: 'evt-123',
  data: {
    userId: 'user-456',
    action: 'login',
    timestamp: Date.now()
  },
  headers: {
    'content-type': 'application/json'
  }
});
```

#### `unsubscribe(topic: string, id?: string): Promise<void>`

Unsubscribe from a topic. If an `id` is provided, only that handler is unsubscribed. Otherwise, all handlers for the topic are unsubscribed.

**Parameters:**
- `topic: string` - The topic to unsubscribe from
- `id?: string` - Optional handler ID. If not provided, all handlers are unsubscribed

**Example:**
```typescript
// Unsubscribe a specific handler
await qified.unsubscribe('user-events', 'userEventHandler');

// Unsubscribe all handlers for a topic
await qified.unsubscribe('user-events');
```

#### `disconnect(): Promise<void>`

Disconnect from all providers and clean up resources.

**Example:**
```typescript
await qified.disconnect();
```

## Events

Qified extends [Hookified](https://hookified.org) and emits events for all major operations. You can listen to these events to add custom logging, monitoring, or error handling.

### Available Events

The following events are available via the `QifiedEvents` enum:

- `QifiedEvents.publish` - Emitted after a message is successfully published
- `QifiedEvents.subscribe` - Emitted after successfully subscribing to a topic
- `QifiedEvents.unsubscribe` - Emitted after successfully unsubscribing from a topic
- `QifiedEvents.disconnect` - Emitted after successfully disconnecting from all providers
- `QifiedEvents.error` - Emitted when an error occurs during any operation
- `QifiedEvents.info` - Emitted for informational messages
- `QifiedEvents.warn` - Emitted for warning messages

### Listening to Events

Use the `on()` method to listen to events:

```typescript
import { Qified, MemoryMessageProvider, QifiedEvents } from 'qified';

const qified = new Qified({
  messageProviders: [new MemoryMessageProvider()]
});

// Listen for publish events
await qified.on(QifiedEvents.publish, async (data) => {
  console.log('Message published to topic:', data.topic);
  console.log('Message:', data.message);
});

// Listen for subscribe events
await qified.on(QifiedEvents.subscribe, async (data) => {
  console.log('Subscribed to topic:', data.topic);
  console.log('Handler ID:', data.handler.id);
});

// Listen for unsubscribe events
await qified.on(QifiedEvents.unsubscribe, async (data) => {
  console.log('Unsubscribed from topic:', data.topic);
  if (data.id) {
    console.log('Handler ID:', data.id);
  }
});

// Listen for disconnect events
await qified.on(QifiedEvents.disconnect, async () => {
  console.log('Disconnected from all providers');
});

// Listen for errors
await qified.on(QifiedEvents.error, async (error) => {
  console.error('Error occurred:', error);
});

// Now perform operations
await qified.subscribe('events', {
  id: 'handler1',
  handler: async (message) => {
    console.log('Received:', message.data);
  }
});

await qified.publish('events', {
  id: 'msg-1',
  data: { text: 'Hello!' }
});

await qified.unsubscribe('events', 'handler1');
await qified.disconnect();
```

### Error Handling with Events

Events provide a centralized way to handle errors across all operations:

```typescript
import { Qified, QifiedEvents } from 'qified';
import { NatsMessageProvider } from '@qified/nats';

const qified = new Qified({
  messageProviders: [new NatsMessageProvider()]
});

// Centralized error handler
await qified.on(QifiedEvents.error, async (error) => {
  console.error('Qified error:', error.message);
  // Send to error tracking service
  // Log to file
  // Send alert
});

// Errors from publish, subscribe, etc. will be caught and emitted
await qified.publish('topic', { id: '1', data: { test: true } });
```

### Properties

#### `messageProviders: MessageProvider[]`

Get or set the array of message providers.

**Example:**
```typescript
// Get providers
const providers = qified.messageProviders;

// Set providers
qified.messageProviders = [new MemoryMessageProvider()];
```

## Types

### Message<T>

The message type used for pub/sub messaging.

```typescript
type Message<T = any> = {
  id: string;                        // Unique identifier
  data: T;                           // Message payload
  timestamp?: number;                // Optional timestamp
  headers?: Record<string, string>;  // Optional metadata headers
}
```

### TopicHandler

Handler configuration for subscriptions.

```typescript
type TopicHandler = {
  id?: string;                              // Optional unique identifier
  handler: (message: Message) => Promise<void>;  // Async handler function
}
```

### Task<T>

The task type used for task queues (coming in v2.0.0).

```typescript
type Task<T = any> = {
  id: string;        // Unique identifier
  data: T;           // Task payload
  channel: string;   // Task channel/queue
  priority?: number; // Optional priority
  retries?: number;  // Optional retry count
}
```

## Providers

### MemoryMessageProvider

An in-memory message provider for testing or simple use cases.

**Example:**
```typescript
import { MemoryMessageProvider } from 'qified';

const provider = new MemoryMessageProvider();
```

**Note:** Other providers (Redis, RabbitMQ, NATS, ZeroMQ) are available in separate packages.

# Examples

## Using NATS Provider

The NATS provider allows you to use NATS as your message broker.

```typescript
import { Qified } from 'qified';
import { NatsMessageProvider } from '@qified/nats';

// Create a NATS provider (defaults to localhost:4222)
const natsProvider = new NatsMessageProvider({
  uri: 'localhost:4222'
});

const qified = new Qified({
  messageProviders: [natsProvider]
});

// Subscribe to a topic
await qified.subscribe('user-events', {
  id: 'userEventHandler',
  handler: async (message) => {
    console.log('User event received:', message.data);
  }
});

// Publish a message
await qified.publish('user-events', {
  id: 'evt-001',
  data: {
    userId: 'user-123',
    action: 'login',
    timestamp: Date.now()
  }
});

// Clean up
await qified.disconnect();
```

Or use the convenience function:

```typescript
import { createQified } from '@qified/nats';

// Creates Qified instance with NATS provider already configured
const qified = createQified({ uri: 'localhost:4222' });

await qified.subscribe('notifications', {
  id: 'notifHandler',
  handler: async (message) => {
    console.log('Notification:', message.data);
  }
});

await qified.publish('notifications', {
  id: 'notif-001',
  data: { message: 'Hello from NATS!' }
});

await qified.disconnect();
```

## Basic Pub/Sub

```typescript
import { Qified, MemoryMessageProvider } from 'qified';

const qified = new Qified({
  messageProviders: [new MemoryMessageProvider()]
});

// Subscribe
await qified.subscribe('orders', {
  id: 'orderProcessor',
  handler: async (message) => {
    console.log('Processing order:', message.data);
  }
});

// Publish
await qified.publish('orders', {
  id: 'order-001',
  data: {
    orderId: '12345',
    items: ['item1', 'item2'],
    total: 99.99
  }
});
```

## Multiple Handlers

```typescript
import { Qified, MemoryMessageProvider } from 'qified';

const qified = new Qified({
  messageProviders: [new MemoryMessageProvider()]
});

// Add multiple handlers for the same topic
await qified.subscribe('notifications', {
  id: 'emailHandler',
  handler: async (message) => {
    console.log('Sending email:', message.data);
  }
});

await qified.subscribe('notifications', {
  id: 'smsHandler',
  handler: async (message) => {
    console.log('Sending SMS:', message.data);
  }
});

// One publish triggers both handlers
await qified.publish('notifications', {
  id: 'notif-001',
  data: { message: 'Hello!' }
});
```

## Using Multiple Message Providers

Qified supports using multiple message providers simultaneously for redundancy, failover, or broadcasting messages across different message brokers. When you configure multiple providers:

- **`subscribe()`** subscribes to the topic on **all** providers
- **`publish()`** publishes the message to **all** providers
- **`unsubscribe()`** unsubscribes from **all** providers
- **Handler behavior**: Your handler will receive messages from **all** providers

This is useful for:
- **Redundancy**: If one provider fails, messages continue flowing through others
- **Migration**: Gradually migrate from one message broker to another
- **Broadcasting**: Send messages to multiple messaging systems simultaneously

```typescript
import { Qified } from 'qified';
import { NatsMessageProvider } from '@qified/nats';
import { RabbitMqMessageProvider } from '@qified/rabbitmq';

// Create multiple providers
const natsProvider = new NatsMessageProvider({
  uri: 'localhost:4222'
});

const rabbitProvider = new RabbitMqMessageProvider({
  uri: 'amqp://localhost:5672'
});

// Configure Qified with both providers
const qified = new Qified({
  messageProviders: [natsProvider, rabbitProvider]
});

// Subscribe once - but subscribes to BOTH NATS and RabbitMQ
await qified.subscribe('orders', {
  id: 'orderProcessor',
  handler: async (message) => {
    console.log('Order received:', message.data);
    // This handler will be called for messages from EITHER provider
  }
});

// Publish once - but publishes to BOTH NATS and RabbitMQ
await qified.publish('orders', {
  id: 'order-001',
  data: {
    orderId: '12345',
    items: ['item1', 'item2'],
    total: 99.99
  }
});
// The message is now in both NATS and RabbitMQ queues

// Clean up - disconnects from BOTH providers
await qified.disconnect();
```

**Important Notes:**
- When publishing to multiple providers, each provider receives the same message
- Your handler may receive the same message multiple times (once from each provider) if you're both publishing and subscribing with multiple providers
- All operations (`subscribe`, `publish`, `unsubscribe`, `disconnect`) execute in parallel across all providers using `Promise.all()`

## Typed Messages

```typescript
import { Qified, MemoryMessageProvider, Message } from 'qified';

interface UserEvent {
  userId: string;
  action: 'login' | 'logout' | 'signup';
  timestamp: number;
}

const qified = new Qified({
  messageProviders: [new MemoryMessageProvider()]
});

await qified.subscribe('user-events', {
  id: 'userHandler',
  handler: async (message: Message<UserEvent>) => {
    const { userId, action, timestamp } = message.data;
    console.log(`User ${userId} performed ${action} at ${timestamp}`);
  }
});

await qified.publish('user-events', {
  id: 'evt-123',
  data: {
    userId: 'user-456',
    action: 'login',
    timestamp: Date.now()
  }
});
```

## Cleanup and Unsubscribe

```typescript
import { Qified, MemoryMessageProvider } from 'qified';

const qified = new Qified({
  messageProviders: [new MemoryMessageProvider()]
});

await qified.subscribe('temp-events', {
  id: 'tempHandler',
  handler: async (message) => {
    console.log('Temporary event:', message.data);
  }
});

// Unsubscribe specific handler
await qified.unsubscribe('temp-events', 'tempHandler');

// Or disconnect all providers
await qified.disconnect();
```

# Development and Testing

Qified is written in TypeScript and tests are written in `vitest`. To run the tests, use the following command:

1. `pnpm install` - This will install all the dependencies
2. `pnpm test:services:start` - This will start the services needed for testing (Redis, RabbitMQ, etc)
3. `pnpm test` - This will run the tests

To contribute follow the [Contributing Guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md).

# License

[MIT & © Jared Wray](LICENSE)