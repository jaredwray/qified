import { type Message, Qified } from "qified";
import { describe, expect, test } from "vitest";
import {
	createQified,
	defaultZmqId,
	ZmqMessageProvider,
} from "../src/index.js";

describe("ZmqMessageProvider", () => {
	test("should create an instance", () => {
		const provider = new ZmqMessageProvider();
		expect(provider).toBeInstanceOf(ZmqMessageProvider);
		expect(provider.subscriptions.size).toBe(0);
	});

	test("should publish and receive a message", async () => {
		const provider = new ZmqMessageProvider();
		const message: Message = { id: "1", data: "test" };
		let received: Message | undefined;
		const id = "test-handler";
		await provider.subscribe("test-topic", {
			id,
			async handler(message) {
				received = message;
			},
		});

		// Let the event loop iterate so message queue is read/written at next tick
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100);
		});

		await provider.publish("test-topic", message);

		// Let the event loop iterate so message queue is read/written at next tick
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100);
		});

		expect(received).toEqual({ ...message, providerId: "@qified/zeromq" });
		expect(received?.providerId).toBe("@qified/zeromq");

		await provider.unsubscribe("test-topic", id);
		await provider.disconnect();
	});

	test("should unsubscribe all handlers with no id", async () => {
		const provider = new ZmqMessageProvider();
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

		// Let the event loop iterate so message queue is read/written at next tick
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100);
		});

		await provider.publish("test-topic", message);

		// Let the event loop iterate so message queue is read/written at next tick
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100);
		});

		const firstSubscriptions = provider.subscriptions.get("test-topic");
		expect(firstSubscriptions?.length).toBe(2);

		expect(received1).toEqual({ ...message, providerId: "@qified/zeromq" });
		expect(received2).toEqual({ ...message, providerId: "@qified/zeromq" });

		await provider.unsubscribe("test-topic");

		const subscriptions = provider.subscriptions.get("test-topic");
		expect(subscriptions).toBeUndefined();

		await provider.disconnect();
	});

	test("should be able to use with Qified", async () => {
		const provider = new ZmqMessageProvider({ uri: "tcp://localhost:5556" });
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

		// Let the event loop iterate so message queue is read/written at next tick
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100);
		});

		await qified.publish("test-topic", message);

		// Let the event loop iterate so message queue is read/written at next tick
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100);
		});

		expect(received).toEqual({ ...message, providerId: "@qified/zeromq" });

		await qified.unsubscribe("test-topic", id);
		await qified.disconnect();
	});

	test("should create Qified instance with ZeroMQ provider", () => {
		const qified = createQified();
		expect(qified).toBeInstanceOf(Qified);
		expect(qified.messageProviders.length).toBe(1);
		expect(qified.messageProviders[0]).toBeInstanceOf(ZmqMessageProvider);
	});

	test("should set custom provider ID in published messages", async () => {
		const customId = "custom-zeromq-provider";
		const provider = new ZmqMessageProvider({
			uri: "tcp://localhost:5557",
			id: customId,
		});
		const message: Message = { id: "1", data: "test" };
		let received: Message | undefined;
		const handlerId = "test-handler";

		await provider.subscribe("test-topic", {
			id: handlerId,
			async handler(message) {
				received = message;
			},
		});

		// Let the event loop iterate so message queue is read/written at next tick
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100);
		});

		await provider.publish("test-topic", message);

		// Let the event loop iterate so message queue is read/written at next tick
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100);
		});

		expect(received?.providerId).toBe(customId);
		expect(received).toEqual({ ...message, providerId: customId });

		await provider.unsubscribe("test-topic", handlerId);
		await provider.disconnect();
	});

	test("should get provider id", () => {
		const provider = new ZmqMessageProvider();
		expect(provider.id).toBe(defaultZmqId);
	});

	test("should set provider id", async () => {
		const customId = "custom-zmq-id";
		const provider = new ZmqMessageProvider({ id: customId });
		expect(provider.id).toBe(customId);

		provider.id = "new-id";
		expect(provider.id).toBe("new-id");

		await provider.disconnect();
	});
});
