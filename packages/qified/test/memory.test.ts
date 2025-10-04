// biome-ignore-all lint/suspicious/noExplicitAny: This is a test file and explicit any is acceptable here.
import { describe, expect, test } from "vitest";
import { MemoryMessageProvider } from "../src/memory/message.js";
import type { Message, TopicHandler } from "../src/types.js";

describe("MemoryMessageProvider", () => {
	test("should initialize with empty subscriptions", async () => {
		const provider = new MemoryMessageProvider();
		expect(provider.subscriptions).toEqual(new Map());
	});

	test("should be able to set subscriptions", () => {
		const provider = new MemoryMessageProvider();
		const subscriptions = new Map<string, TopicHandler[]>();
		subscriptions.set("test/topic1", [{ async handler(_message: any) {} }]);
		subscriptions.set("test/topic2", [{ async handler(_message: any) {} }]);
		provider.subscriptions = subscriptions;
		expect(provider.subscriptions).toEqual(subscriptions);
	});

	test("should add a subscription", async () => {
		const provider = new MemoryMessageProvider();
		const handler = async (_message: any) => {};
		await provider.subscribe("test/topic", { id: "test", handler });
		expect(provider.subscriptions.size).toBe(1);
		expect(provider.subscriptions.get("test/topic")?.[0].id).toBe("test");
	});

	test("should add multiple to a subscription", async () => {
		const provider = new MemoryMessageProvider();
		const handler = async (_message: any) => {};
		await provider.subscribe("test/topic", { id: "test", handler });
		await provider.subscribe("test/topic", { id: "test2", handler });
		expect(provider.subscriptions.size).toBe(1);
		expect(provider.subscriptions.get("test/topic")?.[0].id).toBe("test");
		expect(provider.subscriptions.get("test/topic")?.[1].id).toBe("test2");
		expect(provider.subscriptions.get("test/topic")?.length).toBe(2);
	});

	test("should remove a subscription", async () => {
		const provider = new MemoryMessageProvider();
		const handler = async (_message: any) => {};
		await provider.subscribe("test/topic", { id: "test", handler });
		expect(provider.subscriptions.size).toBe(1);
		await provider.unsubscribe("test/topic", "test");
		expect(provider.subscriptions.get("test/topic")?.length).toBe(0);
	});

	test("should remove a subscription without id", async () => {
		const provider = new MemoryMessageProvider();
		const handler = async (_message: any) => {};
		await provider.subscribe("test/topic", { id: "test", handler });
		expect(provider.subscriptions.size).toBe(1);
		await provider.unsubscribe("test/topic");
		expect(provider.subscriptions.get("test/topic")).toBe(undefined);
	});

	test("should publish a message to the correct topic", async () => {
		const provider = new MemoryMessageProvider();
		const message: Message = { id: "foo", data: { test: "message" } };
		let handlerMessage: Message | undefined;
		const handler = async (msg: Message) => {
			handlerMessage = msg;
		};

		await provider.subscribe("test/topic", { id: "test", handler });

		await provider.publish("test/topic", message);

		expect(handlerMessage).toEqual({
			...message,
			providerId: "@qified/memory",
		});
		expect(handlerMessage?.providerId).toBe("@qified/memory");
	});

	test("should disconnect and clear subscriptions", async () => {
		const provider = new MemoryMessageProvider();
		const handler = async (_message: any) => {};
		await provider.subscribe("test/topic", { id: "test", handler });
		expect(provider.subscriptions.size).toBe(1);
		await provider.disconnect();
		expect(provider.subscriptions.size).toBe(0);
	});

	test("should get default provider id", () => {
		const provider = new MemoryMessageProvider();
		expect(provider.id).toBe("@qified/memory");
	});

	test("should set and get custom provider id", () => {
		const provider = new MemoryMessageProvider();
		provider.id = "custom-memory-id";
		expect(provider.id).toBe("custom-memory-id");
	});

	test("should set custom provider ID in published messages", async () => {
		const customId = "custom-memory-provider";
		const provider = new MemoryMessageProvider({ id: customId });
		const message: Message = { id: "foo", data: { test: "message" } };
		let handlerMessage: Message | undefined;
		const handler = async (msg: Message) => {
			handlerMessage = msg;
		};

		await provider.subscribe("test/topic", { id: "test", handler });
		await provider.publish("test/topic", message);

		expect(handlerMessage?.providerId).toBe(customId);
		expect(handlerMessage).toEqual({ ...message, providerId: customId });
	});
});
