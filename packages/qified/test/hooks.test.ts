import { describe, expect, test } from "vitest";
import {
	MemoryMessageProvider,
	MemoryTaskProvider,
	Qified,
	QifiedHooks,
} from "../src/index.js";
import type {
	EnqueueTask,
	Message,
	Task,
	TaskContext,
	TaskHandler,
	TopicHandler,
} from "../src/types.js";

describe("QifiedHooks", () => {
	test("should export QifiedHooks enum with correct values", () => {
		expect(QifiedHooks.beforeSubscribe).toBe("before:subscribe");
		expect(QifiedHooks.afterSubscribe).toBe("after:subscribe");
		expect(QifiedHooks.beforePublish).toBe("before:publish");
		expect(QifiedHooks.afterPublish).toBe("after:publish");
		expect(QifiedHooks.beforeUnsubscribeMessage).toBe(
			"before:unsubscribeMessage",
		);
		expect(QifiedHooks.afterUnsubscribeMessage).toBe(
			"after:unsubscribeMessage",
		);
		expect(QifiedHooks.beforeEnqueue).toBe("before:enqueue");
		expect(QifiedHooks.afterEnqueue).toBe("after:enqueue");
		expect(QifiedHooks.beforeDequeue).toBe("before:dequeue");
		expect(QifiedHooks.afterDequeue).toBe("after:dequeue");
		expect(QifiedHooks.beforeUnsubscribeTask).toBe("before:unsubscribeTask");
		expect(QifiedHooks.afterUnsubscribeTask).toBe("after:unsubscribeTask");
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

describe("Qified UnsubscribeMessage Hooks", () => {
	test("should call beforeUnsubscribeMessage hook before unsubscribing", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		let beforeHookCalled = false;

		const handler = async (_message: Message) => {};
		await qified.subscribe("test/topic", { id: "testHandler", handler });

		qified.onHook(QifiedHooks.beforeUnsubscribeMessage, async () => {
			beforeHookCalled = true;
		});

		await qified.unsubscribeMessage("test/topic", "testHandler");

		expect(beforeHookCalled).toBe(true);
	});

	test("should call afterUnsubscribeMessage hook after unsubscribing", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		let afterHookCalled = false;

		const handler = async (_message: Message) => {};
		await qified.subscribe("test/topic", { id: "testHandler", handler });

		qified.onHook(QifiedHooks.afterUnsubscribeMessage, async () => {
			afterHookCalled = true;
		});

		await qified.unsubscribeMessage("test/topic", "testHandler");

		expect(afterHookCalled).toBe(true);
	});

	test("should allow beforeUnsubscribeMessage hook to modify topic", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });

		const handler = async (_message: Message) => {};
		await qified.subscribe("topic1", { id: "handler1", handler });
		await qified.subscribe("topic2", { id: "handler2", handler });

		qified.onHook(
			QifiedHooks.beforeUnsubscribeMessage,
			async (context: { topic: string }) => {
				context.topic = "topic2";
			},
		);

		await qified.unsubscribeMessage("topic1", "handler2");

		// topic2 should be unsubscribed, not topic1
		expect(memoryProvider.subscriptions.get("topic1")?.length).toBe(1);
		expect(memoryProvider.subscriptions.get("topic2")?.length).toBe(0);
	});

	test("should allow beforeUnsubscribeMessage hook to modify handler id", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });

		const handler = async (_message: Message) => {};
		await qified.subscribe("test/topic", { id: "handler1", handler });
		await qified.subscribe("test/topic", { id: "handler2", handler });

		qified.onHook(
			QifiedHooks.beforeUnsubscribeMessage,
			async (context: { id?: string }) => {
				context.id = "handler2";
			},
		);

		await qified.unsubscribeMessage("test/topic", "handler1");

		// handler2 should be unsubscribed, not handler1
		const handlers = memoryProvider.subscriptions.get("test/topic");
		expect(handlers?.some((h) => h.id === "handler1")).toBe(true);
		expect(handlers?.some((h) => h.id === "handler2")).toBe(false);
	});

	test("should pass context to afterUnsubscribeMessage hook", async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({ messageProviders: [memoryProvider] });
		let afterHookContext: { topic: string; id?: string } | undefined;

		const handler = async (_message: Message) => {};
		await qified.subscribe("test/topic", { id: "testHandler", handler });

		qified.onHook(
			QifiedHooks.afterUnsubscribeMessage,
			async (context: { topic: string; id?: string }) => {
				afterHookContext = context;
			},
		);

		await qified.unsubscribeMessage("test/topic", "testHandler");

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

describe("Qified Enqueue Hooks", () => {
	test("should call beforeEnqueue hook before enqueueing", async () => {
		const taskProvider = new MemoryTaskProvider();
		const qified = new Qified({ taskProviders: [taskProvider] });
		let beforeHookCalled = false;

		qified.onHook(QifiedHooks.beforeEnqueue, async () => {
			beforeHookCalled = true;
		});

		await qified.enqueue("test/queue", { data: { content: "Hello" } });

		expect(beforeHookCalled).toBe(true);
	});

	test("should call afterEnqueue hook after enqueueing", async () => {
		const taskProvider = new MemoryTaskProvider();
		const qified = new Qified({ taskProviders: [taskProvider] });
		let afterHookCalled = false;

		qified.onHook(QifiedHooks.afterEnqueue, async () => {
			afterHookCalled = true;
		});

		await qified.enqueue("test/queue", { data: { content: "Hello" } });

		expect(afterHookCalled).toBe(true);
	});

	test("should allow beforeEnqueue hook to modify queue", async () => {
		const taskProvider = new MemoryTaskProvider();
		const qified = new Qified({ taskProviders: [taskProvider] });
		let receivedOnModified = false;

		await qified.dequeue("modified/queue", {
			id: "h1",
			handler: async (_task: Task, context: TaskContext) => {
				receivedOnModified = true;
				await context.ack();
			},
		});

		qified.onHook(
			QifiedHooks.beforeEnqueue,
			async (context: { queue: string }) => {
				context.queue = "modified/queue";
			},
		);

		await qified.enqueue("original/queue", { data: { content: "Hello" } });

		expect(receivedOnModified).toBe(true);
	});

	test("should allow beforeEnqueue hook to modify task data", async () => {
		const taskProvider = new MemoryTaskProvider();
		const qified = new Qified({ taskProviders: [taskProvider] });
		let receivedTask: Task | undefined;

		await qified.dequeue("test/queue", {
			id: "h1",
			handler: async (task: Task, context: TaskContext) => {
				receivedTask = task;
				await context.ack();
			},
		});

		qified.onHook(
			QifiedHooks.beforeEnqueue,
			async (context: { task: EnqueueTask }) => {
				context.task.data = { ...context.task.data, modified: true };
			},
		);

		await qified.enqueue("test/queue", { data: { original: true } });

		expect(receivedTask?.data.original).toBe(true);
		expect(receivedTask?.data.modified).toBe(true);
	});

	test("should pass ids to afterEnqueue hook", async () => {
		const taskProvider = new MemoryTaskProvider();
		const qified = new Qified({ taskProviders: [taskProvider] });
		let hookIds: string[] = [];

		qified.onHook(
			QifiedHooks.afterEnqueue,
			async (context: { ids: string[] }) => {
				hookIds = context.ids;
			},
		);

		const ids = await qified.enqueue("test/queue", { data: {} });

		expect(hookIds).toEqual(ids);
		expect(hookIds).toHaveLength(1);
	});
});

describe("Qified Dequeue Hooks", () => {
	test("should call beforeDequeue hook before dequeueing", async () => {
		const taskProvider = new MemoryTaskProvider();
		const qified = new Qified({ taskProviders: [taskProvider] });
		let beforeHookCalled = false;

		qified.onHook(QifiedHooks.beforeDequeue, async () => {
			beforeHookCalled = true;
		});

		const handler = async (_task: Task, context: TaskContext) => {
			await context.ack();
		};
		await qified.dequeue("test/queue", { id: "h1", handler });

		expect(beforeHookCalled).toBe(true);
	});

	test("should call afterDequeue hook after dequeueing", async () => {
		const taskProvider = new MemoryTaskProvider();
		const qified = new Qified({ taskProviders: [taskProvider] });
		let afterHookCalled = false;

		qified.onHook(QifiedHooks.afterDequeue, async () => {
			afterHookCalled = true;
		});

		const handler = async (_task: Task, context: TaskContext) => {
			await context.ack();
		};
		await qified.dequeue("test/queue", { id: "h1", handler });

		expect(afterHookCalled).toBe(true);
	});

	test("should allow beforeDequeue hook to modify queue", async () => {
		const taskProvider = new MemoryTaskProvider();
		const qified = new Qified({ taskProviders: [taskProvider] });

		qified.onHook(
			QifiedHooks.beforeDequeue,
			async (context: { queue: string }) => {
				context.queue = "modified/queue";
			},
		);

		const handler = async (_task: Task, context: TaskContext) => {
			await context.ack();
		};
		await qified.dequeue("original/queue", { id: "h1", handler });

		expect(taskProvider.taskHandlers.has("modified/queue")).toBe(true);
		expect(taskProvider.taskHandlers.has("original/queue")).toBe(false);
	});

	test("should allow beforeDequeue hook to modify handler", async () => {
		const taskProvider = new MemoryTaskProvider();
		const qified = new Qified({ taskProviders: [taskProvider] });

		qified.onHook(
			QifiedHooks.beforeDequeue,
			async (context: { handler: TaskHandler }) => {
				context.handler = {
					id: "modifiedHandler",
					handler: context.handler.handler,
				};
			},
		);

		const handler = async (_task: Task, context: TaskContext) => {
			await context.ack();
		};
		await qified.dequeue("test/queue", { id: "originalHandler", handler });

		const handlers = taskProvider.taskHandlers.get("test/queue");
		expect(handlers?.[0].id).toBe("modifiedHandler");
	});
});

describe("Qified UnsubscribeTask Hooks", () => {
	test("should call beforeUnsubscribeTask hook before unsubscribing", async () => {
		const taskProvider = new MemoryTaskProvider();
		const qified = new Qified({ taskProviders: [taskProvider] });
		let beforeHookCalled = false;

		const handler = async (_task: Task, context: TaskContext) => {
			await context.ack();
		};
		await qified.dequeue("test/queue", { id: "h1", handler });

		qified.onHook(QifiedHooks.beforeUnsubscribeTask, async () => {
			beforeHookCalled = true;
		});

		await qified.unsubscribeTask("test/queue", "h1");

		expect(beforeHookCalled).toBe(true);
	});

	test("should call afterUnsubscribeTask hook after unsubscribing", async () => {
		const taskProvider = new MemoryTaskProvider();
		const qified = new Qified({ taskProviders: [taskProvider] });
		let afterHookCalled = false;

		const handler = async (_task: Task, context: TaskContext) => {
			await context.ack();
		};
		await qified.dequeue("test/queue", { id: "h1", handler });

		qified.onHook(QifiedHooks.afterUnsubscribeTask, async () => {
			afterHookCalled = true;
		});

		await qified.unsubscribeTask("test/queue", "h1");

		expect(afterHookCalled).toBe(true);
	});

	test("should allow beforeUnsubscribeTask hook to modify queue", async () => {
		const taskProvider = new MemoryTaskProvider();
		const qified = new Qified({ taskProviders: [taskProvider] });
		const handler = async (_task: Task, context: TaskContext) => {
			await context.ack();
		};
		await qified.dequeue("queue1", { id: "a", handler });
		await qified.dequeue("queue2", { id: "b", handler });

		qified.onHook(
			QifiedHooks.beforeUnsubscribeTask,
			async (context: { queue: string }) => {
				context.queue = "queue2";
			},
		);

		await qified.unsubscribeTask("queue1", "b");

		expect(taskProvider.taskHandlers.get("queue1")?.length).toBe(1);
		expect(taskProvider.taskHandlers.get("queue2")?.length ?? 0).toBe(0);
	});

	test("should pass context to afterUnsubscribeTask hook", async () => {
		const taskProvider = new MemoryTaskProvider();
		const qified = new Qified({ taskProviders: [taskProvider] });
		let afterHookContext: { queue: string; id?: string } | undefined;

		const handler = async (_task: Task, context: TaskContext) => {
			await context.ack();
		};
		await qified.dequeue("test/queue", { id: "h1", handler });

		qified.onHook(
			QifiedHooks.afterUnsubscribeTask,
			async (context: { queue: string; id?: string }) => {
				afterHookContext = context;
			},
		);

		await qified.unsubscribeTask("test/queue", "h1");

		expect(afterHookContext?.queue).toBe("test/queue");
		expect(afterHookContext?.id).toBe("h1");
	});
});
