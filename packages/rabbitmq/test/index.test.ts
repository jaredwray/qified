import { type Message, Qified } from "qified";
import { describe, expect, test } from "vitest";
import {
	createQified,
	defaultRabbitMqUri,
	defaultReconnectTimeInSeconds,
	RabbitMqMessageProvider,
} from "../src/index.js";

describe("RabbitMqMessageProvider", () => {
	test("should create an instance", () => {
		const provider = new RabbitMqMessageProvider();
		expect(provider).toBeInstanceOf(RabbitMqMessageProvider);
		expect(provider.subscriptions.size).toBe(0);
		expect(provider.consumerTags.size).toBe(0);
	});

	test("should set and get URI", () => {
		const provider = new RabbitMqMessageProvider();
		const uri = defaultRabbitMqUri;
		provider.uri = uri;
		expect(provider.uri).toBe(uri);
	});

	test("should have default reconnect time", () => {
		const provider = new RabbitMqMessageProvider();
		expect(provider.reconnectTimeInSeconds).toBe(defaultReconnectTimeInSeconds);
		expect(provider.reconnectTimeInSeconds).toBe(5);
	});

	test("should set custom reconnect time via options", () => {
		const provider = new RabbitMqMessageProvider({
			reconnectTimeInSeconds: 10,
		});
		expect(provider.reconnectTimeInSeconds).toBe(10);
	});

	test("should set and get reconnect time", () => {
		const provider = new RabbitMqMessageProvider();
		provider.reconnectTimeInSeconds = 15;
		expect(provider.reconnectTimeInSeconds).toBe(15);
	});

	test("should disable reconnection with 0", () => {
		const provider = new RabbitMqMessageProvider({
			reconnectTimeInSeconds: 0,
		});
		expect(provider.reconnectTimeInSeconds).toBe(0);
	});

	test("should publish and receive a message", async () => {
		const provider = new RabbitMqMessageProvider();
		const message: Message = { id: "1", data: "test" };
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
		expect(received).toEqual({ ...message, providerId: "@qified/rabbitmq" });
		expect(received?.providerId).toBe("@qified/rabbitmq");

		await provider.unsubscribe("test-topic", id);
		await provider.disconnect();
	});

	test("should unsubscribe all handlers with no id", async () => {
		const provider = new RabbitMqMessageProvider();
		const message: Message = { id: "1", data: "test" };
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
		expect(received1).toEqual({ ...message, providerId: "@qified/rabbitmq" });
		expect(received2).toEqual({ ...message, providerId: "@qified/rabbitmq" });

		await provider.unsubscribe("test-topic");

		const subscriptions = provider.subscriptions.get("test-topic");
		expect(subscriptions).toBeUndefined();

		await provider.disconnect();
	});

	test("should be able to use with Qified", async () => {
		const provider = new RabbitMqMessageProvider();
		const qified = new Qified({ messageProviders: [provider] });
		const message: Message = { id: "1", data: "test" };
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
		expect(received).toEqual({ ...message, providerId: "@qified/rabbitmq" });

		await qified.unsubscribe("test-topic", id);
		await qified.disconnect();
	});

	test("should create Qified instance with RabbitMQ provider", () => {
		const qified = createQified();
		expect(qified).toBeInstanceOf(Qified);
		expect(qified.messageProviders.length).toBe(1);
		expect(qified.messageProviders[0]).toBeInstanceOf(RabbitMqMessageProvider);
	});

	test("should get default provider id", () => {
		const provider = new RabbitMqMessageProvider();
		expect(provider.id).toBe("@qified/rabbitmq");
	});

	test("should set and get custom provider id", () => {
		const provider = new RabbitMqMessageProvider();
		provider.id = "custom-rabbitmq-id";
		expect(provider.id).toBe("custom-rabbitmq-id");
	});

	test("should set custom provider ID in published messages", async () => {
		const customId = "custom-rabbitmq-provider";
		const provider = new RabbitMqMessageProvider({ id: customId });
		const message: Message = { id: "1", data: "test" };
		let received: Message | undefined;
		const handlerId = "test-handler";

		await provider.subscribe("test-topic", {
			id: handlerId,
			async handler(message) {
				received = message;
			},
		});

		await provider.publish("test-topic", message);

		// Wait a moment for async delivery
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100);
		});

		expect(received?.providerId).toBe(customId);
		expect(received).toEqual({ ...message, providerId: customId });

		await provider.unsubscribe("test-topic", handlerId);
		await provider.disconnect();
	});

	test("should not attempt reconnection when disconnect is called", async () => {
		const provider = new RabbitMqMessageProvider();
		const message: Message = { id: "1", data: "test" };
		await provider.subscribe("test-topic", {
			id: "handler",
			async handler(_message) {
				// noop
			},
		});
		await provider.publish("test-topic", message);

		// Disconnect should cleanly close without scheduling reconnection
		await provider.disconnect();
		expect(provider.subscriptions.size).toBe(0);
		expect(provider.consumerTags.size).toBe(0);
	});

	test("should disconnect cleanly when no connection exists", async () => {
		const provider = new RabbitMqMessageProvider();
		// Should not throw when disconnecting without a connection
		await provider.disconnect();
		expect(provider.subscriptions.size).toBe(0);
	});
});
