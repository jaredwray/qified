import { type Message, Qified } from "qified";
import { describe, expect, test } from "vitest";
import {
	createQified,
	defaultRedisId,
	RedisMessageProvider,
} from "../src/index.js";

describe("RedisMessageProvider", () => {
	test("should fail to connect when Redis is not available", async () => {
		const provider = new RedisMessageProvider({
			uri: "redis://localhost:9999",
		}); // Use non-existent port
		await expect(provider.connect()).rejects.toThrow();
	});

	test("should publish and receive a message", async () => {
		const provider = new RedisMessageProvider();
		const message: Omit<Message, "providerId"> = { id: "1", data: "test" };
		let received: Message | undefined;
		const id = "test-handler";
		await provider.subscribe("test-topic", {
			id,
			async handler(message) {
				received = message;
			},
		});
		await provider.publish("test-topic", message);
		// Wait a moment for async delivery
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100);
		});
		expect(received).toEqual({ ...message, providerId: defaultRedisId });

		await provider.unsubscribe("test-topic", id);
		await provider.disconnect();
	});

	test("should unsubscribe all handlers with no id", async () => {
		const provider = new RedisMessageProvider();
		const message: Omit<Message, "providerId"> = { id: "1", data: "test" };
		let received1: Message | undefined;
		let received2: Message | undefined;
		await provider.subscribe("test-topic", {
			async handler(message) {
				received1 = message;
			},
		});

		await provider.subscribe("test-topic", {
			async handler(message) {
				received2 = message;
			},
		});

		await provider.publish("test-topic", message);

		const firstSubscriptions = provider.subscriptions.get("test-topic");
		expect(firstSubscriptions?.length).toBe(2);

		// Wait a moment for async delivery
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100);
		});
		expect(received1).toEqual({ ...message, providerId: defaultRedisId });
		expect(received2).toEqual({ ...message, providerId: defaultRedisId });

		await provider.unsubscribe("test-topic");

		const subscriptions = provider.subscriptions.get("test-topic");
		expect(subscriptions).toBeUndefined();

		await provider.disconnect();
	});

	test("should be able to use with Qified", async () => {
		const provider = new RedisMessageProvider();
		const qified = new Qified({ messageProviders: [provider] });
		const message: Omit<Message, "providerId"> = { id: "1", data: "test" };
		let received: Message | undefined;
		const id = "test-handler";
		await qified.subscribe("test-topic", {
			id,
			async handler(message) {
				received = message;
			},
		});
		await qified.publish("test-topic", message);
		// Wait a moment for async delivery
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100);
		});
		expect(received).toEqual({ ...message, providerId: defaultRedisId });

		await qified.unsubscribeMessage("test-topic", id);
		await qified.disconnect();
	});

	test("should create Qified instance with Redis provider", () => {
		const qified = createQified();
		expect(qified).toBeInstanceOf(Qified);
		expect(qified.messageProviders.length).toBe(1);
		expect(qified.messageProviders[0]).toBeInstanceOf(RedisMessageProvider);
	});

	test("should ignore malformed messages without crashing", async () => {
		const provider = new RedisMessageProvider();
		let received: Message | undefined;
		await provider.subscribe("test-topic", {
			async handler(message) {
				received = message;
			},
		});
		// Publish a raw, non-JSON payload directly on the channel to exercise the
		// parse-error path in the subscriber's message listener.
		const { pub } = provider as unknown as {
			pub: { publish(channel: string, message: string): Promise<number> };
		};
		await pub.publish("test-topic", "not-json{");
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100);
		});
		expect(received).toBeUndefined();

		await provider.disconnect();
	});

	test("should roll back topic state when subscribe fails", async () => {
		const provider = new RedisMessageProvider({
			uri: "redis://localhost:9999",
		});
		await expect(
			provider.subscribe("test-topic", { async handler() {} }),
		).rejects.toThrow();
		// The topic entry must not linger, or a later retry would skip the real
		// subscribe and never receive messages.
		expect(provider.subscriptions.has("test-topic")).toBe(false);
	});

	test("should not crash when a handler rejects", async () => {
		const provider = new RedisMessageProvider();
		await provider.subscribe("test-topic", {
			async handler() {
				throw new Error("handler failure");
			},
		});
		await provider.publish("test-topic", { id: "1", data: "test" });
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100);
		});
		await provider.disconnect();
		expect(provider.subscriptions.size).toBe(0);
	});

	test("should get provider id", () => {
		const provider = new RedisMessageProvider();
		expect(provider.id).toBe(defaultRedisId);
	});

	test("should set provider id", async () => {
		const customId = "custom-redis-id";
		const provider = new RedisMessageProvider({ id: customId });
		expect(provider.id).toBe(customId);

		provider.id = "new-id";
		expect(provider.id).toBe("new-id");
	});

	test("should force disconnect and destroy connections", async () => {
		const provider = new RedisMessageProvider();
		await provider.connect();
		await provider.subscribe("test-topic", {
			id: "test-handler",
			async handler() {},
		});
		// Force disconnect should call destroy() instead of close()
		await provider.disconnect(true);
		expect(provider.subscriptions.size).toBe(0);
	});
});
