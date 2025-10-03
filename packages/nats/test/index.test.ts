import { type Message, Qified } from "qified";
import { describe, expect, test } from "vitest";
import {
	createQified,
	defaultNatsUri,
	NatsMessageProvider,
} from "../src/index.js";

describe("NATSMessageProvider", () => {
	test("should create an instance", () => {
		const provider = new NatsMessageProvider();
		expect(provider).toBeInstanceOf(NatsMessageProvider);
		expect(provider.subscriptions.size).toBe(0);
	});

	test("should set and get URI", () => {
		const provider = new NatsMessageProvider();
		const uri = defaultNatsUri;
		provider.uri = uri;
		expect(provider.uri).toBe(uri);
	});

	test("should publish and receive a message", async () => {
		const provider = new NatsMessageProvider();
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
		expect(received).toEqual(message);

		await provider.unsubscribe("test-topic", id);
		await provider.disconnect();
	});

	test("should unsubscribe handler with id", async () => {
		const provider = new NatsMessageProvider();
		const message: Message = { id: "1", data: "test" };
		let received1: Message | undefined;
		let received2: Message | undefined;
		await provider.subscribe("test-topic", {
			id: "1",
			async handler(message) {
				received1 = message;
			},
		});

		await provider.subscribe("test-topic", {
			id: "2",
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
		expect(received1).toEqual(message);
		expect(received2).toEqual(message);

		await provider.unsubscribe("test-topic", "1");

		const subscriptions = provider.subscriptions.get("test-topic");
		// biome-ignore lint/style/noNonNullAssertion: test
		expect(subscriptions!.length).toBe(1);

		await provider.disconnect();
	});

	test("should unsubscribe all handlers with no id", async () => {
		const provider = new NatsMessageProvider();
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
		expect(received1).toEqual(message);
		expect(received2).toEqual(message);

		await provider.unsubscribe("test-topic");

		const subscriptions = provider.subscriptions.get("test-topic");
		expect(subscriptions).toBeUndefined();

		await provider.disconnect();
	});

	test("should not handle in-flight messages after unsubscribing", async () => {
		const provider = new NatsMessageProvider();
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
				// Uncomment the line below to check that nats executes this
				// handler and reaches here but cancels further execution as we
				// are not using drain()
				// console.log("here");

				// Delay in execution is more than the delay to call unsubscribe after publish()
				await new Promise<void>((resolve) => {
					setTimeout(resolve, 150);
				});

				received2 = message;
			},
		});

		// Give some time to handler registration
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100);
		});

		await provider.publish("test-topic", message);

		await new Promise<void>((resolve) => {
			setTimeout(resolve, 50);
		});

		await provider.unsubscribe("test-topic");

		expect(received1).toEqual(message);
		expect(received2).toEqual(undefined);

		const subscriptions = provider.subscriptions.get("test-topic");
		expect(subscriptions).toBeUndefined();

		await provider.disconnect();
	});

	test("should be able to use with Qified", async () => {
		const provider = new NatsMessageProvider();
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
		expect(received).toEqual(message);

		await qified.unsubscribe("test-topic", id);
		await qified.disconnect();
	});

	test("should create Qified instance with NATSMessageProvider provider", () => {
		const qified = createQified();
		expect(qified).toBeInstanceOf(Qified);
		expect(qified.messageProviders.length).toBe(1);
		expect(qified.messageProviders[0]).toBeInstanceOf(NatsMessageProvider);
	});
});
