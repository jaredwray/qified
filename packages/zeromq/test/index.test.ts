import { type Message, Qified } from "qified";
import { describe, expect, test, vi } from "vitest";
import { Subscriber } from "zeromq";
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
		const message: Omit<Message, "providerId"> = { id: "1", data: "test" };
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
		const provider = new ZmqMessageProvider({ uri: "tcp://localhost:5558" });
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
		const message: Omit<Message, "providerId"> = { id: "1", data: "test" };
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

		await qified.unsubscribeMessage("test-topic", id);
		await qified.disconnect();
	});

	test("should keep the topic until the last subscriber is gone", async () => {
		const provider = new ZmqMessageProvider({ uri: "tcp://localhost:5559" });
		const topic = "test-topic";
		const firstId = "first-handler";
		const secondId = "second-handler";
		const unsubscribeSpy = vi.spyOn(Subscriber.prototype, "unsubscribe");
		const firstMessage: Omit<Message, "providerId"> = { id: "1", data: "one" };
		const secondMessage: Omit<Message, "providerId"> = { id: "2", data: "two" };
		let firstReceived: Message | undefined;
		let secondReceived: Message | undefined;

		try {
			await provider.subscribe(topic, {
				id: firstId,
				async handler(message) {
					firstReceived = message;
				},
			});
			await provider.subscribe(topic, {
				id: secondId,
				async handler(message) {
					secondReceived = message;
				},
			});

			// Let the event loop iterate so message queue is read/written at next tick
			await new Promise<void>((resolve) => {
				setTimeout(resolve, 100);
			});

			await provider.publish(topic, firstMessage);

			// Let the event loop iterate so message queue is read/written at next tick
			await new Promise<void>((resolve) => {
				setTimeout(resolve, 100);
			});

			expect(firstReceived).toEqual({
				...firstMessage,
				providerId: "@qified/zeromq",
			});
			expect(secondReceived).toEqual({
				...firstMessage,
				providerId: "@qified/zeromq",
			});
			expect(provider.subscriptions.get(topic)?.length).toBe(2);

			await provider.unsubscribe(topic, firstId);

			expect(provider.subscriptions.get(topic)?.length).toBe(1);
			expect(unsubscribeSpy).not.toHaveBeenCalled();

			firstReceived = undefined;
			secondReceived = undefined;
			await provider.publish(topic, secondMessage);

			// Let the event loop iterate so message queue is read/written at next tick
			await new Promise<void>((resolve) => {
				setTimeout(resolve, 100);
			});

			expect(firstReceived).toBeUndefined();
			expect(secondReceived).toEqual({
				...secondMessage,
				providerId: "@qified/zeromq",
			});

			await provider.unsubscribe(topic, secondId);

			expect(provider.subscriptions.get(topic)).toBeUndefined();
			expect(unsubscribeSpy).toHaveBeenCalledWith(topic);
		} finally {
			unsubscribeSpy.mockRestore();
			await provider.disconnect();
		}
	});

	test("should allow unsubscribe before any subscription", async () => {
		const provider = new ZmqMessageProvider();
		await provider.unsubscribe("test-topic", "missing");
		expect(provider.subscriptions.size).toBe(0);
		await provider.disconnect();
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
		const message: Omit<Message, "providerId"> = { id: "1", data: "test" };
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
