import { describe, expect, test } from "vitest";
import { MemoryMessageProvider, Qified, QifiedHooks } from "../src/index.js";
import type { Message, TopicHandler } from "../src/types.js";

describe("QifiedHooks", () => {
	test("should export QifiedHooks enum with correct values", () => {
		expect(QifiedHooks.beforeSubscribe).toBe("before:subscribe");
		expect(QifiedHooks.afterSubscribe).toBe("after:subscribe");
		expect(QifiedHooks.beforePublish).toBe("before:publish");
		expect(QifiedHooks.afterPublish).toBe("after:publish");
		expect(QifiedHooks.beforeUnsubscribe).toBe("before:unsubscribe");
		expect(QifiedHooks.afterUnsubscribe).toBe("after:unsubscribe");
		expect(QifiedHooks.beforeDisconnect).toBe("before:disconnect");
		expect(QifiedHooks.afterDisconnect).toBe("after:disconnect");
	});
});

describe("Qified Subscribe Hooks", () => {
	test("should call beforeSubscribe hook before subscribing", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		const callOrder: string[] = [];

		qified.onHook(QifiedHooks.beforeSubscribe, async () => {
			callOrder.push("beforeSubscribe");
		});

		const handler = async (_message: Message) => {};
		await qified.subscribe("test/topic", { id: "testHandler", handler });

		expect(callOrder).toContain("beforeSubscribe");
		expect(memoryProvider.subscriptions.size).toBe(1);
	});

	test("should call afterSubscribe hook after subscribing", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		let afterHookCalled = false;

		qified.onHook(QifiedHooks.afterSubscribe, async () => {
			afterHookCalled = true;
		});

		const handler = async (_message: Message) => {};
		await qified.subscribe("test/topic", { id: "testHandler", handler });

		expect(afterHookCalled).toBe(true);
	});

	test("should allow beforeSubscribe hook to modify topic", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });

		qified.onHook(
			QifiedHooks.beforeSubscribe,
			async (context: { topic: string; handler: TopicHandler }) => {
				context.topic = "modified/topic";
			},
		);

		const handler = async (_message: Message) => {};
		await qified.subscribe("original/topic", { id: "testHandler", handler });

		expect(memoryProvider.subscriptions.has("modified/topic")).toBe(true);
		expect(memoryProvider.subscriptions.has("original/topic")).toBe(false);
	});

	test("should allow beforeSubscribe hook to modify handler", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });

		qified.onHook(
			QifiedHooks.beforeSubscribe,
			async (context: { topic: string; handler: TopicHandler }) => {
				context.handler = {
					id: "modifiedHandler",
					handler: context.handler.handler,
				};
			},
		);

		const handler = async (_message: Message) => {};
		await qified.subscribe("test/topic", { id: "originalHandler", handler });

		const handlers = memoryProvider.subscriptions.get("test/topic");
		expect(handlers?.[0].id).toBe("modifiedHandler");
	});

	test("should pass modified values to afterSubscribe hook", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		let afterHookTopic = "";

		qified.onHook(
			QifiedHooks.beforeSubscribe,
			async (context: { topic: string }) => {
				context.topic = "modified/topic";
			},
		);

		qified.onHook(
			QifiedHooks.afterSubscribe,
			async (context: { topic: string }) => {
				afterHookTopic = context.topic;
			},
		);

		const handler = async (_message: Message) => {};
		await qified.subscribe("original/topic", { id: "testHandler", handler });

		expect(afterHookTopic).toBe("modified/topic");
	});

	test("should execute multiple beforeSubscribe hooks in order", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		const callOrder: number[] = [];

		qified.onHook(QifiedHooks.beforeSubscribe, async () => {
			callOrder.push(1);
		});

		qified.onHook(QifiedHooks.beforeSubscribe, async () => {
			callOrder.push(2);
		});

		qified.onHook(QifiedHooks.beforeSubscribe, async () => {
			callOrder.push(3);
		});

		const handler = async (_message: Message) => {};
		await qified.subscribe("test/topic", { id: "testHandler", handler });

		expect(callOrder).toEqual([1, 2, 3]);
	});
});

describe("Qified Publish Hooks", () => {
	test("should call beforePublish hook before publishing", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		let beforeHookCalled = false;

		qified.onHook(QifiedHooks.beforePublish, async () => {
			beforeHookCalled = true;
		});

		await qified.publish("test/topic", {
			id: "msg1",
			data: { content: "Hello" },
		});

		expect(beforeHookCalled).toBe(true);
	});

	test("should call afterPublish hook after publishing", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		let afterHookCalled = false;

		qified.onHook(QifiedHooks.afterPublish, async () => {
			afterHookCalled = true;
		});

		await qified.publish("test/topic", {
			id: "msg1",
			data: { content: "Hello" },
		});

		expect(afterHookCalled).toBe(true);
	});

	test("should allow beforePublish hook to modify topic", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		let handlerCalled = false;

		const handler = async (_message: Message) => {
			handlerCalled = true;
		};
		await qified.subscribe("modified/topic", { id: "testHandler", handler });

		qified.onHook(
			QifiedHooks.beforePublish,
			async (context: { topic: string }) => {
				context.topic = "modified/topic";
			},
		);

		await qified.publish("original/topic", {
			id: "msg1",
			data: { content: "Hello" },
		});

		// Handler should have been called on modified topic
		expect(handlerCalled).toBe(true);
	});

	test("should allow beforePublish hook to modify message data", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		let receivedMessage: Message | undefined;

		const handler = async (message: Message) => {
			receivedMessage = message;
		};
		await qified.subscribe("test/topic", { id: "testHandler", handler });

		qified.onHook(
			QifiedHooks.beforePublish,
			async (context: { message: Omit<Message, "providerId"> }) => {
				context.message.data = { ...context.message.data, modified: true };
			},
		);

		await qified.publish("test/topic", {
			id: "msg1",
			data: { original: true },
		});

		expect(receivedMessage?.data.original).toBe(true);
		expect(receivedMessage?.data.modified).toBe(true);
	});

	test("should allow beforePublish hook to add timestamp", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		let receivedMessage: Message | undefined;

		const handler = async (message: Message) => {
			receivedMessage = message;
		};
		await qified.subscribe("test/topic", { id: "testHandler", handler });

		const timestamp = Date.now();
		qified.onHook(
			QifiedHooks.beforePublish,
			async (context: { message: Omit<Message, "providerId"> }) => {
				context.message.timestamp = timestamp;
			},
		);

		await qified.publish("test/topic", {
			id: "msg1",
			data: { content: "Hello" },
		});

		expect(receivedMessage?.timestamp).toBe(timestamp);
	});

	test("should allow beforePublish hook to add headers", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		let receivedMessage: Message | undefined;

		const handler = async (message: Message) => {
			receivedMessage = message;
		};
		await qified.subscribe("test/topic", { id: "testHandler", handler });

		qified.onHook(
			QifiedHooks.beforePublish,
			async (context: { message: Omit<Message, "providerId"> }) => {
				context.message.headers = {
					...context.message.headers,
					"x-custom-header": "custom-value",
				};
			},
		);

		await qified.publish("test/topic", {
			id: "msg1",
			data: { content: "Hello" },
		});

		expect(receivedMessage?.headers?.["x-custom-header"]).toBe("custom-value");
	});

	test("should pass modified message to afterPublish hook", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		let afterHookMessage: Omit<Message, "providerId"> | undefined;

		qified.onHook(
			QifiedHooks.beforePublish,
			async (context: { message: Omit<Message, "providerId"> }) => {
				context.message.data = { ...context.message.data, modified: true };
			},
		);

		qified.onHook(
			QifiedHooks.afterPublish,
			async (context: { message: Omit<Message, "providerId"> }) => {
				afterHookMessage = context.message;
			},
		);

		await qified.publish("test/topic", {
			id: "msg1",
			data: { original: true },
		});

		expect(afterHookMessage?.data.modified).toBe(true);
	});
});

describe("Qified Unsubscribe Hooks", () => {
	test("should call beforeUnsubscribe hook before unsubscribing", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		let beforeHookCalled = false;

		const handler = async (_message: Message) => {};
		await qified.subscribe("test/topic", { id: "testHandler", handler });

		qified.onHook(QifiedHooks.beforeUnsubscribe, async () => {
			beforeHookCalled = true;
		});

		await qified.unsubscribe("test/topic", "testHandler");

		expect(beforeHookCalled).toBe(true);
	});

	test("should call afterUnsubscribe hook after unsubscribing", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		let afterHookCalled = false;

		const handler = async (_message: Message) => {};
		await qified.subscribe("test/topic", { id: "testHandler", handler });

		qified.onHook(QifiedHooks.afterUnsubscribe, async () => {
			afterHookCalled = true;
		});

		await qified.unsubscribe("test/topic", "testHandler");

		expect(afterHookCalled).toBe(true);
	});

	test("should allow beforeUnsubscribe hook to modify topic", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });

		const handler = async (_message: Message) => {};
		await qified.subscribe("topic1", { id: "handler1", handler });
		await qified.subscribe("topic2", { id: "handler2", handler });

		qified.onHook(
			QifiedHooks.beforeUnsubscribe,
			async (context: { topic: string }) => {
				context.topic = "topic2";
			},
		);

		await qified.unsubscribe("topic1", "handler2");

		// topic2 should be unsubscribed, not topic1
		expect(memoryProvider.subscriptions.get("topic1")?.length).toBe(1);
		expect(memoryProvider.subscriptions.get("topic2")?.length).toBe(0);
	});

	test("should allow beforeUnsubscribe hook to modify handler id", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });

		const handler = async (_message: Message) => {};
		await qified.subscribe("test/topic", { id: "handler1", handler });
		await qified.subscribe("test/topic", { id: "handler2", handler });

		qified.onHook(
			QifiedHooks.beforeUnsubscribe,
			async (context: { id?: string }) => {
				context.id = "handler2";
			},
		);

		await qified.unsubscribe("test/topic", "handler1");

		// handler2 should be unsubscribed, not handler1
		const handlers = memoryProvider.subscriptions.get("test/topic");
		expect(handlers?.some((h) => h.id === "handler1")).toBe(true);
		expect(handlers?.some((h) => h.id === "handler2")).toBe(false);
	});

	test("should pass context to afterUnsubscribe hook", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		let afterHookContext: { topic: string; id?: string } | undefined;

		const handler = async (_message: Message) => {};
		await qified.subscribe("test/topic", { id: "testHandler", handler });

		qified.onHook(
			QifiedHooks.afterUnsubscribe,
			async (context: { topic: string; id?: string }) => {
				afterHookContext = context;
			},
		);

		await qified.unsubscribe("test/topic", "testHandler");

		expect(afterHookContext?.topic).toBe("test/topic");
		expect(afterHookContext?.id).toBe("testHandler");
	});
});

describe("Qified Disconnect Hooks", () => {
	test("should call beforeDisconnect hook before disconnecting", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		let beforeHookCalled = false;

		qified.onHook(QifiedHooks.beforeDisconnect, async () => {
			beforeHookCalled = true;
		});

		await qified.disconnect();

		expect(beforeHookCalled).toBe(true);
	});

	test("should call afterDisconnect hook after disconnecting", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		let afterHookCalled = false;

		qified.onHook(QifiedHooks.afterDisconnect, async () => {
			afterHookCalled = true;
		});

		await qified.disconnect();

		expect(afterHookCalled).toBe(true);
	});

	test("should pass providerCount to beforeDisconnect hook", async () => {
		const memoryProvider1 = new MemoryMessageProvider();
		const memoryProvider2 = new MemoryMessageProvider();
		const qified = new Qified({
			messageProviders: [memoryProvider1, memoryProvider2],
		});
		let hookProviderCount = 0;

		qified.onHook(
			QifiedHooks.beforeDisconnect,
			async (context: { providerCount: number }) => {
				hookProviderCount = context.providerCount;
			},
		);

		await qified.disconnect();

		expect(hookProviderCount).toBe(2);
	});

	test("should pass providerCount to afterDisconnect hook", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		let hookProviderCount = 0;

		qified.onHook(
			QifiedHooks.afterDisconnect,
			async (context: { providerCount: number }) => {
				hookProviderCount = context.providerCount;
			},
		);

		await qified.disconnect();

		expect(hookProviderCount).toBe(1);
	});

	test("should call beforeDisconnect hook while providers still exist", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		let providersAtHookTime = 0;

		qified.onHook(QifiedHooks.beforeDisconnect, async () => {
			providersAtHookTime = qified.messageProviders.length;
		});

		await qified.disconnect();

		expect(providersAtHookTime).toBe(1);
		expect(qified.messageProviders.length).toBe(0);
	});

	test("should call afterDisconnect hook after providers are cleared", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		let providersAtHookTime = -1;

		qified.onHook(QifiedHooks.afterDisconnect, async () => {
			providersAtHookTime = qified.messageProviders.length;
		});

		await qified.disconnect();

		expect(providersAtHookTime).toBe(0);
	});
});

describe("Qified Hooks Integration", () => {
	test("should work with hooks and events together", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		const callOrder: string[] = [];

		qified.onHook(QifiedHooks.beforePublish, async () => {
			callOrder.push("beforeHook");
		});

		qified.onHook(QifiedHooks.afterPublish, async () => {
			callOrder.push("afterHook");
		});

		qified.on("publish", () => {
			callOrder.push("event");
		});

		await qified.publish("test/topic", { id: "msg1", data: {} });

		expect(callOrder).toEqual(["beforeHook", "afterHook", "event"]);
	});

	test("should allow chaining multiple data modifications", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		let receivedMessage: Message | undefined;

		const handler = async (message: Message) => {
			receivedMessage = message;
		};
		await qified.subscribe("test/topic", { id: "testHandler", handler });

		// First hook adds timestamp
		qified.onHook(
			QifiedHooks.beforePublish,
			async (context: { message: Omit<Message, "providerId"> }) => {
				context.message.timestamp = 12345;
			},
		);

		// Second hook adds headers
		qified.onHook(
			QifiedHooks.beforePublish,
			async (context: { message: Omit<Message, "providerId"> }) => {
				context.message.headers = { "x-source": "hook" };
			},
		);

		// Third hook modifies data
		qified.onHook(
			QifiedHooks.beforePublish,
			async (context: { message: Omit<Message, "providerId"> }) => {
				context.message.data = { ...context.message.data, processed: true };
			},
		);

		await qified.publish("test/topic", {
			id: "msg1",
			data: { original: true },
		});

		expect(receivedMessage?.timestamp).toBe(12345);
		expect(receivedMessage?.headers?.["x-source"]).toBe("hook");
		expect(receivedMessage?.data.processed).toBe(true);
		expect(receivedMessage?.data.original).toBe(true);
	});

	test("should work with no hooks registered", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		let receivedMessage: Message | undefined;

		const handler = async (message: Message) => {
			receivedMessage = message;
		};
		await qified.subscribe("test/topic", { id: "testHandler", handler });

		await qified.publish("test/topic", {
			id: "msg1",
			data: { content: "Hello" },
		});

		expect(receivedMessage?.data.content).toBe("Hello");
	});
});
