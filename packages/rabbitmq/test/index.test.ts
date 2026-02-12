import { type Message, Qified } from "qified";
import { afterEach, describe, expect, test } from "vitest";
import {
	createQified,
	defaultRabbitMqId,
	defaultRabbitMqUri,
	defaultReconnectTimeInSeconds,
	RabbitMqMessageProvider,
} from "../src/index.js";

const topicPrefix = `test-${Date.now()}`;
let providers: RabbitMqMessageProvider[] = [];

function createProvider(
	options?: ConstructorParameters<typeof RabbitMqMessageProvider>[0],
): RabbitMqMessageProvider {
	const p = new RabbitMqMessageProvider(options);
	providers.push(p);
	return p;
}

afterEach(async () => {
	for (const p of providers) {
		try {
			await p.disconnect();
		} catch {}
	}

	providers = [];
});

describe("RabbitMqMessageProvider", () => {
	// --- Constructor & defaults ---

	test("should create an instance with default values", () => {
		const provider = createProvider();
		expect(provider).toBeInstanceOf(RabbitMqMessageProvider);
		expect(provider.subscriptions.size).toBe(0);
		expect(provider.consumerTags.size).toBe(0);
		expect(provider.id).toBe(defaultRabbitMqId);
		expect(provider.uri).toBe(defaultRabbitMqUri);
		expect(provider.reconnectTimeInSeconds).toBe(defaultReconnectTimeInSeconds);
	});

	test("should create instance with custom options", () => {
		const provider = createProvider({
			uri: "amqp://custom:5672",
			id: "custom-id",
			reconnectTimeInSeconds: 10,
		});
		expect(provider.uri).toBe("amqp://custom:5672");
		expect(provider.id).toBe("custom-id");
		expect(provider.reconnectTimeInSeconds).toBe(10);
	});

	// --- Getters / setters ---

	test("should get and set id", () => {
		const provider = createProvider();
		expect(provider.id).toBe("@qified/rabbitmq");
		provider.id = "new-id";
		expect(provider.id).toBe("new-id");
	});

	test("should get and set uri", () => {
		const provider = createProvider();
		expect(provider.uri).toBe("amqp://localhost:5672");
		provider.uri = "amqp://other:5672";
		expect(provider.uri).toBe("amqp://other:5672");
	});

	test("should get and set reconnectTimeInSeconds", () => {
		const provider = createProvider();
		expect(provider.reconnectTimeInSeconds).toBe(5);
		provider.reconnectTimeInSeconds = 15;
		expect(provider.reconnectTimeInSeconds).toBe(15);
	});

	test("should disable reconnection with 0", () => {
		const provider = createProvider({ reconnectTimeInSeconds: 0 });
		expect(provider.reconnectTimeInSeconds).toBe(0);
	});

	test("should get consumerTags as empty map initially", () => {
		const provider = createProvider();
		expect(provider.consumerTags).toBeInstanceOf(Map);
		expect(provider.consumerTags.size).toBe(0);
	});

	// --- getClient / getChannel ---

	test("should connect and return a channel from getClient", async () => {
		const provider = createProvider();
		const channel = await provider.getClient();
		expect(channel).toBeDefined();
		expect(typeof channel.assertQueue).toBe("function");
		expect(typeof channel.sendToQueue).toBe("function");
	});

	test("should return same channel on second getClient call", async () => {
		const provider = createProvider();
		const first = await provider.getClient();
		const second = await provider.getClient();
		expect(first).toBe(second);
	});

	test("should return channel from getChannel", async () => {
		const provider = createProvider();
		const channel = await provider.getChannel();
		expect(channel).toBeDefined();
		expect(typeof channel.assertQueue).toBe("function");
	});

	test("should return existing channel from getChannel when already connected", async () => {
		const provider = createProvider();
		await provider.getClient();
		const channel = await provider.getChannel();
		expect(channel).toBeDefined();
	});

	// --- Publish / Subscribe ---

	test("should publish and receive a message", async () => {
		const topic = `${topicPrefix}-pub-recv`;
		const provider = createProvider();
		const message: Message = { id: "1", data: "hello" };
		let received: Message | undefined;

		await provider.subscribe(topic, {
			id: "h1",
			async handler(msg) {
				received = msg;
			},
		});

		await provider.publish(topic, message);

		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100);
		});

		expect(received).toEqual({ ...message, providerId: "@qified/rabbitmq" });
		expect(received?.providerId).toBe("@qified/rabbitmq");
	});

	test("should handle multiple handlers on same topic", async () => {
		const topic = `${topicPrefix}-multi-handler`;
		const provider = createProvider();

		await provider.subscribe(topic, {
			id: "h1",
			handler: async () => {},
		});
		await provider.subscribe(topic, {
			id: "h2",
			handler: async () => {},
		});

		expect(provider.subscriptions.get(topic)?.length).toBe(2);
		// Only one consumer tag per topic
		expect(provider.consumerTags.has(topic)).toBe(true);
	});

	test("should deliver message to all handlers on a topic", async () => {
		const topic = `${topicPrefix}-deliver-all`;
		const provider = createProvider();
		let received1: Message | undefined;
		let received2: Message | undefined;

		await provider.subscribe(topic, {
			id: "h1",
			async handler(msg) {
				received1 = msg;
			},
		});
		await provider.subscribe(topic, {
			id: "h2",
			async handler(msg) {
				received2 = msg;
			},
		});

		await provider.publish(topic, { id: "1", data: "broadcast" });

		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100);
		});

		expect(received1?.data).toBe("broadcast");
		expect(received2?.data).toBe("broadcast");
	});

	test("should set custom provider ID in published messages", async () => {
		const topic = `${topicPrefix}-custom-id`;
		const customId = "custom-rabbitmq-provider";
		const provider = createProvider({ id: customId });
		let received: Message | undefined;

		await provider.subscribe(topic, {
			id: "h1",
			async handler(msg) {
				received = msg;
			},
		});

		await provider.publish(topic, { id: "1", data: "test" });

		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100);
		});

		expect(received?.providerId).toBe(customId);
	});

	// --- Unsubscribe ---

	test("should unsubscribe specific handler by id", async () => {
		const topic = `${topicPrefix}-unsub-id`;
		const provider = createProvider();

		await provider.subscribe(topic, {
			id: "h1",
			handler: async () => {},
		});
		await provider.subscribe(topic, {
			id: "h2",
			handler: async () => {},
		});

		await provider.unsubscribe(topic, "h1");

		const remaining = provider.subscriptions.get(topic);
		expect(remaining?.length).toBe(1);
		expect(remaining?.[0].id).toBe("h2");
		// Consumer tag still present (consumer not cancelled)
		expect(provider.consumerTags.has(topic)).toBe(true);
	});

	test("should unsubscribe all handlers and cancel consumer", async () => {
		const topic = `${topicPrefix}-unsub-all`;
		const provider = createProvider();

		await provider.subscribe(topic, {
			id: "h1",
			handler: async () => {},
		});

		await provider.unsubscribe(topic);

		expect(provider.subscriptions.has(topic)).toBe(false);
		expect(provider.consumerTags.has(topic)).toBe(false);
	});

	test("should handle unsubscribe by id on nonexistent topic", async () => {
		const provider = createProvider();
		await provider.getClient();

		// Should not throw
		await provider.unsubscribe("nonexistent-topic", "h1");
		expect(provider.subscriptions.has("nonexistent-topic")).toBe(false);
	});

	test("should handle unsubscribe all on topic with no consumer tag", async () => {
		const provider = createProvider();
		await provider.getClient();

		// Should not throw — no consumer tag for this topic
		await provider.unsubscribe("nonexistent-topic");
		expect(provider.consumerTags.has("nonexistent-topic")).toBe(false);
	});

	// --- Disconnect ---

	test("should disconnect cleanly with active subscriptions", async () => {
		const topic = `${topicPrefix}-disconnect-active`;
		const provider = createProvider();

		await provider.subscribe(topic, {
			id: "h1",
			handler: async () => {},
		});
		await provider.subscribe(`${topic}-2`, {
			id: "h2",
			handler: async () => {},
		});

		await provider.disconnect();

		expect(provider.subscriptions.size).toBe(0);
		expect(provider.consumerTags.size).toBe(0);
	});

	test("should disconnect cleanly when no connection exists", async () => {
		const provider = createProvider();
		// Should not throw when disconnecting without a connection
		await provider.disconnect();
		expect(provider.subscriptions.size).toBe(0);
	});

	test("should not attempt reconnection when disconnect is called", async () => {
		const topic = `${topicPrefix}-no-reconnect`;
		const provider = createProvider();

		await provider.subscribe(topic, {
			id: "h1",
			handler: async () => {},
		});
		await provider.publish(topic, { id: "1", data: "test" });

		// Wait for message to be processed before disconnecting
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100);
		});

		await provider.disconnect();

		expect(provider.subscriptions.size).toBe(0);
		expect(provider.consumerTags.size).toBe(0);
	});

	// --- Reconnection (real RabbitMQ) ---

	test("should reconnect and re-establish subscriptions after connection loss", async () => {
		const topic = `${topicPrefix}-reconnect`;
		const provider = createProvider({ reconnectTimeInSeconds: 1 });

		let received: Message | undefined;
		await provider.subscribe(topic, {
			id: "h1",
			async handler(msg) {
				received = msg;
			},
		});

		// Verify initial publish works
		await provider.publish(topic, { id: "1", data: "before-disconnect" });
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100);
		});
		expect(received?.data).toBe("before-disconnect");

		// Force connection close to trigger reconnection
		received = undefined as Message | undefined;
		const internal = provider as unknown as {
			_connection: { close: () => Promise<void> } | undefined;
			_channel: unknown;
		};
		await internal._connection?.close();

		// Poll until reconnection completes (channel is re-established)
		const deadline = Date.now() + 8000;
		while (!internal._channel && Date.now() < deadline) {
			await new Promise<void>((resolve) => {
				setTimeout(resolve, 100);
			});
		}
		expect(internal._channel).toBeDefined();

		// Verify subscription was re-established
		await provider.publish(topic, { id: "2", data: "after-reconnect" });
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100);
		});
		expect(received?.data).toBe("after-reconnect");
	}, 10_000);

	test("should not reconnect when reconnectTimeInSeconds is 0", async () => {
		const topic = `${topicPrefix}-no-reconnect-zero`;
		const provider = createProvider({ reconnectTimeInSeconds: 0 });

		await provider.subscribe(topic, {
			id: "h1",
			handler: async () => {},
		});

		// Force connection close
		const internal = provider as unknown as {
			_connection: { close: () => Promise<void> } | undefined;
		};
		await internal._connection?.close();

		// Wait and verify no reconnection happened
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 1500);
		});

		// Connection should still be undefined (no reconnect)
		expect(internal._connection).toBeUndefined();
	}, 5000);

	test("should clear pending reconnect timer on disconnect", async () => {
		const topic = `${topicPrefix}-clear-timer`;
		const provider = createProvider({ reconnectTimeInSeconds: 2 });

		await provider.subscribe(topic, {
			id: "h1",
			handler: async () => {},
		});

		// Force connection close to trigger reconnect scheduling
		const internal = provider as unknown as {
			_connection: { close: () => Promise<void> } | undefined;
		};
		await internal._connection?.close();

		// Immediately disconnect before the reconnect timer fires
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100);
		});
		await provider.disconnect();

		// Wait past when reconnect would have fired
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 3000);
		});

		// Should still be disconnected — no reconnection occurred
		expect(internal._connection).toBeUndefined();
	}, 10_000);

	// --- Qified integration ---

	test("should work with Qified", async () => {
		const topic = `${topicPrefix}-qified`;
		const provider = createProvider();
		const qified = new Qified({ messageProviders: [provider] });
		const message: Message = { id: "1", data: "test" };
		let received: Message | undefined;

		await qified.subscribe(topic, {
			id: "h1",
			async handler(msg) {
				received = msg;
			},
		});

		await qified.publish(topic, message);

		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100);
		});

		expect(received).toEqual({ ...message, providerId: "@qified/rabbitmq" });

		await qified.unsubscribe(topic, "h1");
		await qified.disconnect();
	});

	test("should create Qified instance via createQified", () => {
		const qified = createQified();
		expect(qified).toBeInstanceOf(Qified);
		expect(qified.messageProviders.length).toBe(1);
		expect(qified.messageProviders[0]).toBeInstanceOf(RabbitMqMessageProvider);
	});

	test("should create Qified instance with custom options", () => {
		const qified = createQified({
			uri: "amqp://custom:5672",
			id: "custom-factory-id",
		});
		expect(qified).toBeInstanceOf(Qified);
		const provider = qified.messageProviders[0] as RabbitMqMessageProvider;
		expect(provider.uri).toBe("amqp://custom:5672");
		expect(provider.id).toBe("custom-factory-id");
	});
});
