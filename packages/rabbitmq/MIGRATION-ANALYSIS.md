# Issue #157: Switching from `amqplib` to `amqp-connection-manager`

## Summary

Issue #157 proposes replacing `amqplib` with `amqp-connection-manager` in the `@qified/rabbitmq` package because amqplib lacks built-in connection recovery, making it unreliable in production environments.

## Is this a breaking change?

**Partially — but manageable at v0.7.0 (pre-1.0).**

### What does NOT break

The `MessageProvider` interface contract is unaffected. All standard methods remain the same:

- `publish(topic, message)` — no change in signature or behavior
- `subscribe(topic, handler)` — no change in signature or behavior
- `unsubscribe(topic, id?)` — no change in signature or behavior
- `disconnect()` — no change in signature or behavior

Consumers using the provider through Qified's standard API (i.e., `qified.publish()`, `qified.subscribe()`, etc.) will notice **zero breaking changes**.

The `RabbitMqMessageProviderOptions` type, `createQified()` helper, `id` getter/setter, and `uri` getter/setter are all unchanged.

### What DOES break

Two public methods expose raw amqplib types directly:

1. **`getClient()` and `getChannel()`** — Both methods currently return a `Promise<Channel>`. With `amqp-connection-manager`, the return type would become `Promise<ChannelWrapper>`, which has a similar but not identical API (e.g., `publish`/`sendToQueue` return Promises instead of booleans).

3. **`consumerTags` map** — the current approach of storing consumer tags from `channel.consume()` would need rethinking, since `amqp-connection-manager` uses setup functions that re-run on reconnect, making stored consumer tags unreliable across reconnections.

### Impact assessment

The breaking surface is small. `getClient()` and `getChannel()` are convenience methods that leak the underlying implementation. They are not part of the `MessageProvider` interface. Anyone using the provider correctly through the Qified interface will not be affected.

## Is this a simple shim?

**Mostly yes.** `amqp-connection-manager` is a thin wrapper around amqplib — it uses amqplib internally and adds connection recovery and round-robin broker support on top.

### What changes in the implementation

The diff is contained to `packages/rabbitmq/src/index.ts` (~210 lines). Key changes:

| Current (`amqplib`)                         | New (`amqp-connection-manager`)                          |
|---------------------------------------------|----------------------------------------------------------|
| `connect(uri)`                              | `amqp.connect([uri])`                                    |
| `conn.createChannel()`                      | `connection.createChannel({ setup: fn })`                |
| Queue assertions inline                     | Queue assertions in setup functions (re-run on reconnect)|
| `channel.sendToQueue()` returns `boolean`   | `channelWrapper.sendToQueue()` returns `Promise`         |
| `channel.consume()` returns consumer tag    | Done inside setup function                               |
| `channel.ack(msg)` called directly          | `channelWrapper.ack(msg)` pass-through alias             |

### What stays the same

- The `amqplib` package remains an indirect dependency (amqp-connection-manager wraps it)
- AMQP protocol behavior is identical
- Message serialization/deserialization is unchanged
- `RabbitMqMessageProviderOptions` type is unchanged
- Test assertions remain valid (tests go through the `MessageProvider` interface)

## Recommendations

1. **Do the switch** — the reliability improvement (auto-reconnect, message buffering during disconnects) is worth the small breaking change at v0.7.0.

2. **Remove or retype `getClient()`/`getChannel()`** — these methods leak implementation details. Options:
   - Remove them entirely (cleanest, encourages use of `MessageProvider` interface)
   - Change return type to `ChannelWrapper` (honest about the new underlying type)
   - Add a new `getConnection()` method for the `AmqpConnectionManager` if direct access is needed

3. **Add connection options** — `amqp-connection-manager` supports options like `heartbeatIntervalInSeconds`, `reconnectTimeInSeconds`, and `findServers` for service discovery. Consider exposing these in `RabbitMqMessageProviderOptions`.

4. **Move queue/consumer setup into setup functions** — this is the main conceptual shift. Setup functions re-execute on reconnect, ensuring queues and consumers are re-established automatically.
