// biome-ignore-all lint/suspicious/noExplicitAny: This is a test file and explicit any is acceptable here.

import type { Task, TaskContext, TaskHandler } from "qified";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	defaultRabbitMqTaskId,
	defaultTaskRetries,
	defaultTaskTimeout,
	RabbitMqTaskProvider,
} from "../src/index.js";

async function waitFor(
	condition: () => boolean | Promise<boolean>,
	timeoutMs = 5000,
	intervalMs = 50,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await condition()) {
			return;
		}

		await new Promise((resolve) => {
			setTimeout(resolve, intervalMs);
		});
	}

	throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

let queueCounter = 0;
function uniqueQueue(): string {
	queueCounter++;
	return `test-queue-${Date.now()}-${queueCounter}`;
}

describe("RabbitMqTaskProvider", () => {
	let provider: RabbitMqTaskProvider;
	const testQueue = uniqueQueue();

	// Track custom providers for cleanup
	const customProviders: RabbitMqTaskProvider[] = [];

	async function createCustomProvider(
		options: ConstructorParameters<typeof RabbitMqTaskProvider>[0] = {},
	): Promise<RabbitMqTaskProvider> {
		const p = new RabbitMqTaskProvider(options);
		customProviders.push(p);
		return p;
	}

	describe("hookified inheritance", () => {
		test("should extend Hookified and support event emission", () => {
			const p = new RabbitMqTaskProvider();
			expect(typeof p.on).toBe("function");
			expect(typeof p.emit).toBe("function");
			expect(typeof p.off).toBe("function");
		});

		test("should emit error events when RabbitMQ operations fail in ack", async () => {
			const customProvider = await createCustomProvider();
			await customProvider.connect();
			const q = uniqueQueue();
			await customProvider.clearQueue(q);

			const errors: Error[] = [];
			customProvider.on("error", (error: Error) => {
				errors.push(error);
			});

			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, _ctx: TaskContext) => {
					// Handler completes, auto-ack will happen
				},
			};

			await customProvider.dequeue(q, handler);
			await customProvider.enqueue(q, { data: { message: "test" } });

			// Wait for task to be processed
			await new Promise((resolve) => setTimeout(resolve, 200));

			// Clean up
			await customProvider.clearQueue(q);
			await customProvider.disconnect();

			// Create a new provider to verify error listener support
			const p2 = await createCustomProvider();
			await p2.connect();
			await p2.clearQueue(q);

			const errors2: Error[] = [];
			p2.on("error", (error: Error) => {
				errors2.push(error);
			});

			expect(typeof p2.on).toBe("function");

			await p2.clearQueue(q);
			await p2.disconnect();
		});

		test("should support onHook and removeHook from Hookified", () => {
			const p = new RabbitMqTaskProvider();
			expect(typeof p.onHook).toBe("function");
			expect(typeof p.removeHook).toBe("function");
		});

		test("should support once method from Hookified", () => {
			const p = new RabbitMqTaskProvider();
			expect(typeof p.once).toBe("function");
		});
	});

	beforeEach(async () => {
		provider = new RabbitMqTaskProvider();
		await provider.connect();
		await provider.clearQueue(testQueue);
	});

	afterEach(async () => {
		// Clean up custom providers first
		for (const p of customProviders) {
			try {
				await p.disconnect(true);
			} catch {
				/* ignore */
			}
		}

		customProviders.length = 0;

		await provider.clearQueue(testQueue);
		await provider.disconnect();
	});

	describe("constructor and initialization", () => {
		test("should initialize with default values", () => {
			const p = new RabbitMqTaskProvider();
			expect(p.id).toBe(defaultRabbitMqTaskId);
			expect(p.timeout).toBe(defaultTaskTimeout);
			expect(p.retries).toBe(defaultTaskRetries);
			expect(p.taskHandlers).toEqual(new Map());
		});

		test("should initialize with custom id", () => {
			const p = new RabbitMqTaskProvider({ id: "custom-id" });
			expect(p.id).toBe("custom-id");
		});

		test("should initialize with custom timeout", () => {
			const p = new RabbitMqTaskProvider({ timeout: 5000 });
			expect(p.timeout).toBe(5000);
		});

		test("should initialize with custom retries", () => {
			const p = new RabbitMqTaskProvider({ retries: 5 });
			expect(p.retries).toBe(5);
		});

		test("should initialize with all custom options", () => {
			const p = new RabbitMqTaskProvider({
				id: "custom-id",
				timeout: 5000,
				retries: 5,
			});
			expect(p.id).toBe("custom-id");
			expect(p.timeout).toBe(5000);
			expect(p.retries).toBe(5);
		});

		test("should fail to connect when RabbitMQ is not available", async () => {
			const p = new RabbitMqTaskProvider({ uri: "amqp://localhost:9999" });
			await expect(p.connect()).rejects.toThrow();
		});
	});

	describe("getters and setters", () => {
		test("should set and get id", () => {
			provider.id = "new-id";
			expect(provider.id).toBe("new-id");
		});

		test("should set and get timeout", () => {
			provider.timeout = 10000;
			expect(provider.timeout).toBe(10000);
		});

		test("should set and get retries", () => {
			provider.retries = 10;
			expect(provider.retries).toBe(10);
		});

		test("should set and get taskHandlers", () => {
			const handlers = new Map<string, TaskHandler[]>();
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {},
			};
			handlers.set("test-queue", [handler]);
			provider.taskHandlers = handlers;
			expect(provider.taskHandlers).toBe(handlers);
		});
	});

	describe("enqueue", () => {
		test("should enqueue a task with auto-generated id and timestamp", async () => {
			const taskId = await provider.enqueue(testQueue, {
				data: { message: "test" },
			});

			expect(taskId).toBeDefined();
			expect(typeof taskId).toBe("string");
			expect(taskId).toMatch(
				/^task-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
			);
		});

		test("should enqueue multiple tasks with unique ids", async () => {
			const taskId1 = await provider.enqueue(testQueue, {
				data: { message: "test1" },
			});
			const taskId2 = await provider.enqueue(testQueue, {
				data: { message: "test2" },
			});

			expect(taskId1).not.toBe(taskId2);
		});

		test("should enqueue task with all optional fields", async () => {
			const taskId = await provider.enqueue(testQueue, {
				data: { message: "test" },
				headers: { "x-custom": "value" },
				priority: 10,
				maxRetries: 5,
				timeout: 5000,
			});

			expect(taskId).toBeDefined();
		});

		test("should throw error when disconnected", async () => {
			await provider.disconnect();

			await expect(
				provider.enqueue(testQueue, { data: { message: "test" } }),
			).rejects.toThrow("TaskProvider has been disconnected");
		});
	});

	describe("dequeue and task processing", () => {
		test("should register a handler for a queue", async () => {
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {},
			};

			await provider.dequeue(testQueue, handler);

			expect(provider.taskHandlers.has(testQueue)).toBe(true);
			expect(provider.taskHandlers.get(testQueue)?.length).toBe(1);
			expect(provider.taskHandlers.get(testQueue)?.[0]).toBe(handler);
		});

		test("should register multiple handlers for the same queue", async () => {
			const handler1: TaskHandler = {
				id: "handler-1",
				handler: async () => {},
			};
			const handler2: TaskHandler = {
				id: "handler-2",
				handler: async () => {},
			};

			await provider.dequeue(testQueue, handler1);
			await provider.dequeue(testQueue, handler2);

			expect(provider.taskHandlers.get(testQueue)?.length).toBe(2);
		});

		test("should process enqueued task when handler is registered", async () => {
			let processedTask: Task | undefined;
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (task: Task) => {
					processedTask = task;
				},
			};

			await provider.dequeue(testQueue, handler);
			const taskId = await provider.enqueue(testQueue, {
				data: { message: "test" },
			});

			await waitFor(() => processedTask !== undefined);

			expect(processedTask).toBeDefined();
			expect(processedTask?.id).toBe(taskId);
			expect(processedTask?.data).toEqual({ message: "test" });
		});

		test("should auto-acknowledge task when handler completes successfully", async () => {
			let processed = false;
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {
					processed = true;
				},
			};

			await provider.dequeue(testQueue, handler);
			await provider.enqueue(testQueue, { data: { message: "test" } });

			await waitFor(() => processed);

			const stats = await provider.getQueueStats(testQueue);
			expect(stats.waiting).toBe(0);
		});

		test("should throw error when disconnected", async () => {
			await provider.disconnect();

			await expect(
				provider.dequeue(testQueue, { handler: async () => {} }),
			).rejects.toThrow("TaskProvider has been disconnected");
		});
	});

	describe("task acknowledgment", () => {
		test("should acknowledge task explicitly", async () => {
			let context: TaskContext | undefined;
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					context = ctx;
					await ctx.ack();
				},
			};

			await provider.dequeue(testQueue, handler);
			await provider.enqueue(testQueue, { data: { message: "test" } });

			await waitFor(() => context !== undefined);

			expect(context).toBeDefined();
			const stats = await provider.getQueueStats(testQueue);
			expect(stats.waiting).toBe(0);
		});

		test("should not acknowledge twice", async () => {
			let ackCount = 0;
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					await ctx.ack();
					ackCount++;
					await ctx.ack(); // Second ack should be no-op
					ackCount++;
				},
			};

			await provider.dequeue(testQueue, handler);
			await provider.enqueue(testQueue, { data: { message: "test" } });

			await waitFor(() => ackCount >= 2);

			expect(ackCount).toBe(2);
			const stats = await provider.getQueueStats(testQueue);
			expect(stats.waiting).toBe(0);
		});
	});

	describe("task rejection and retry", () => {
		test("should reject and requeue task on failure", async () => {
			const q = uniqueQueue();
			const customProvider = await createCustomProvider({});
			await customProvider.connect();
			await customProvider.clearQueue(q);

			let attemptCount = 0;
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					attemptCount++;
					if (attemptCount === 1) {
						await ctx.reject(true);
					} else {
						await ctx.ack();
					}
				},
			};

			await customProvider.dequeue(q, handler);
			await customProvider.enqueue(q, { data: { message: "test" } });

			await waitFor(() => attemptCount > 1);

			expect(attemptCount).toBeGreaterThan(1);

			await customProvider.clearQueue(q);
		});

		test("should move to dead-letter queue after max retries", async () => {
			const q = uniqueQueue();
			const customProvider = await createCustomProvider({
				retries: 2,
			});
			await customProvider.connect();
			await customProvider.clearQueue(q);

			let attemptCount = 0;
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					attemptCount++;
					await ctx.reject(true);
				},
			};

			await customProvider.dequeue(q, handler);
			await customProvider.enqueue(q, { data: { message: "test" } });

			await waitFor(async () => {
				const dlq = await customProvider.getDeadLetterTasks(q);
				return dlq.length === 1;
			});

			const deadLetterTasks = await customProvider.getDeadLetterTasks(q);
			expect(deadLetterTasks.length).toBe(1);
			expect(deadLetterTasks[0].data).toEqual({ message: "test" });
			expect(attemptCount).toBe(2);

			await customProvider.clearQueue(q);
		});

		test("should move to dead-letter queue when reject with requeue=false", async () => {
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					await ctx.reject(false);
				},
			};

			await provider.dequeue(testQueue, handler);
			await provider.enqueue(testQueue, { data: { message: "test" } });

			await waitFor(async () => {
				const dlq = await provider.getDeadLetterTasks(testQueue);
				return dlq.length === 1;
			});

			const deadLetterTasks = await provider.getDeadLetterTasks(testQueue);
			expect(deadLetterTasks.length).toBe(1);
		});

		test("should not reject twice", async () => {
			let rejectCount = 0;
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					await ctx.reject(false);
					rejectCount++;
					await ctx.reject(false); // Second reject should be no-op
					rejectCount++;
				},
			};

			await provider.dequeue(testQueue, handler);
			await provider.enqueue(testQueue, { data: { message: "test" } });

			await waitFor(() => rejectCount >= 2);

			expect(rejectCount).toBe(2);
			const deadLetterTasks = await provider.getDeadLetterTasks(testQueue);
			expect(deadLetterTasks.length).toBe(1);
		});

		test("should auto-reject task on handler error", async () => {
			const q = uniqueQueue();
			const customProvider = await createCustomProvider({
				retries: 3,
			});
			await customProvider.connect();
			await customProvider.clearQueue(q);

			let attemptCount = 0;
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {
					attemptCount++;
					throw new Error("Handler error");
				},
			};

			await customProvider.dequeue(q, handler);
			await customProvider.enqueue(q, { data: { message: "test" } });

			await waitFor(async () => {
				const dlq = await customProvider.getDeadLetterTasks(q);
				return dlq.length === 1;
			});

			expect(attemptCount).toBe(3);
			const deadLetterTasks = await customProvider.getDeadLetterTasks(q);
			expect(deadLetterTasks.length).toBe(1);

			await customProvider.clearQueue(q);
		});
	});

	describe("task timeout", () => {
		test("should timeout task after configured timeout", async () => {
			const q = uniqueQueue();
			const customProvider = await createCustomProvider({
				timeout: 100,
				retries: 1,
			});
			await customProvider.connect();
			await customProvider.clearQueue(q);

			let handlerCalled = false;
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {
					handlerCalled = true;
					// Simulate long-running task
					await new Promise((resolve) => setTimeout(resolve, 500));
				},
			};

			await customProvider.dequeue(q, handler);
			await customProvider.enqueue(q, { data: { message: "test" } });

			// Wait for the task to be processed and eventually end up in DLQ
			await waitFor(async () => {
				const dlq = await customProvider.getDeadLetterTasks(q);
				return dlq.length > 0;
			}, 10_000);

			expect(handlerCalled).toBe(true);
			const dlq = await customProvider.getDeadLetterTasks(q);
			expect(dlq.length).toBeGreaterThan(0);

			await customProvider.clearQueue(q);
		});

		test("should use task-specific timeout over provider default", async () => {
			const q = uniqueQueue();
			const customProvider = await createCustomProvider({
				timeout: 5000,
				retries: 1,
			});
			await customProvider.connect();
			await customProvider.clearQueue(q);

			let handlerCalled = false;
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {
					handlerCalled = true;
					// Simulate long-running task
					await new Promise((resolve) => setTimeout(resolve, 500));
				},
			};

			await customProvider.dequeue(q, handler);
			await customProvider.enqueue(q, {
				data: { message: "test" },
				timeout: 50, // Task-specific timeout (shorter than handler duration)
			});

			// Wait for the task to end up in DLQ after retries exhaust
			await waitFor(async () => {
				const dlq = await customProvider.getDeadLetterTasks(q);
				return dlq.length > 0;
			}, 10_000);

			expect(handlerCalled).toBe(true);
			const dlq = await customProvider.getDeadLetterTasks(q);
			expect(dlq.length).toBeGreaterThan(0);

			await customProvider.clearQueue(q);
		});
	});

	describe("task context extend", () => {
		test("should extend task deadline", async () => {
			const q = uniqueQueue();
			const customProvider = await createCustomProvider({
				timeout: 200,
			});
			await customProvider.connect();
			await customProvider.clearQueue(q);

			let completed = false;

			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					// Extend timeout before long operation
					await ctx.extend(1000);
					await new Promise((resolve) => setTimeout(resolve, 300));
					completed = true;
					await ctx.ack();
				},
			};

			await customProvider.dequeue(q, handler);
			await customProvider.enqueue(q, { data: { message: "test" } });

			await waitFor(() => completed);

			expect(completed).toBe(true);
			const stats = await customProvider.getQueueStats(q);
			expect(stats.waiting).toBe(0);

			await customProvider.clearQueue(q);
		});

		test("should not extend after acknowledgment", async () => {
			let extendCalled = false;
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					await ctx.ack();
					await ctx.extend(1000); // Should be no-op
					extendCalled = true;
				},
			};

			await provider.dequeue(testQueue, handler);
			await provider.enqueue(testQueue, { data: { message: "test" } });

			await waitFor(() => extendCalled);

			expect(extendCalled).toBe(true);
		});
	});

	describe("task context metadata", () => {
		test("should provide attempt and maxRetries in context", async () => {
			let contextMetadata: any;
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					contextMetadata = ctx.metadata;
					await ctx.ack();
				},
			};

			await provider.dequeue(testQueue, handler);
			await provider.enqueue(testQueue, { data: { message: "test" } });

			await waitFor(() => contextMetadata !== undefined);

			expect(contextMetadata).toBeDefined();
			expect(contextMetadata.attempt).toBe(1);
			expect(contextMetadata.maxRetries).toBe(defaultTaskRetries);
		});

		test("should increment attempt on retry", async () => {
			const q = uniqueQueue();
			const customProvider = await createCustomProvider({});
			await customProvider.connect();
			await customProvider.clearQueue(q);

			const attempts: number[] = [];
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					attempts.push(ctx.metadata.attempt);
					if (ctx.metadata.attempt < 2) {
						await ctx.reject(true);
					} else {
						await ctx.ack();
					}
				},
			};

			await customProvider.dequeue(q, handler);
			await customProvider.enqueue(q, { data: { message: "test" } });

			await waitFor(() => attempts.length > 1);

			expect(attempts.length).toBeGreaterThan(1);
			expect(attempts[0]).toBe(1);
			expect(attempts[1]).toBe(2);

			await customProvider.clearQueue(q);
		});

		test("should use task-specific maxRetries", async () => {
			let contextMetadata: any;
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					contextMetadata = ctx.metadata;
					await ctx.ack();
				},
			};

			await provider.dequeue(testQueue, handler);
			await provider.enqueue(testQueue, {
				data: { message: "test" },
				maxRetries: 10,
			});

			await waitFor(() => contextMetadata !== undefined);

			expect(contextMetadata.maxRetries).toBe(10);
		});
	});

	describe("unsubscribe", () => {
		test("should unsubscribe specific handler by id", async () => {
			const handler1: TaskHandler = {
				id: "handler-1",
				handler: async () => {},
			};
			const handler2: TaskHandler = {
				id: "handler-2",
				handler: async () => {},
			};

			await provider.dequeue(testQueue, handler1);
			await provider.dequeue(testQueue, handler2);

			expect(provider.taskHandlers.get(testQueue)?.length).toBe(2);

			await provider.unsubscribe(testQueue, "handler-1");

			const handlers = provider.taskHandlers.get(testQueue);
			expect(handlers?.length).toBe(1);
			expect(handlers?.[0].id).toBe("handler-2");
		});

		test("should unsubscribe all handlers when id not provided", async () => {
			const handler1: TaskHandler = {
				id: "handler-1",
				handler: async () => {},
			};
			const handler2: TaskHandler = {
				id: "handler-2",
				handler: async () => {},
			};

			await provider.dequeue(testQueue, handler1);
			await provider.dequeue(testQueue, handler2);

			expect(provider.taskHandlers.get(testQueue)?.length).toBe(2);

			await provider.unsubscribe(testQueue);

			expect(provider.taskHandlers.has(testQueue)).toBe(false);
		});

		test("should handle unsubscribe for non-existent queue", async () => {
			await expect(
				provider.unsubscribe("non-existent-queue", "handler-1"),
			).resolves.not.toThrow();
		});

		test("should handle unsubscribe for non-existent handler id", async () => {
			const handler: TaskHandler = {
				id: "handler-1",
				handler: async () => {},
			};

			await provider.dequeue(testQueue, handler);

			await expect(
				provider.unsubscribe(testQueue, "non-existent-handler"),
			).resolves.not.toThrow();

			expect(provider.taskHandlers.get(testQueue)?.length).toBe(1);
		});
	});

	describe("disconnect", () => {
		test("should clear all handlers on disconnect", async () => {
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {},
			};

			await provider.dequeue(testQueue, handler);
			await provider.enqueue(testQueue, { data: { message: "test" } });

			expect(provider.taskHandlers.size).toBeGreaterThan(0);

			await provider.disconnect();

			expect(provider.taskHandlers.size).toBe(0);
		});

		test("should prevent operations after disconnect", async () => {
			await provider.disconnect();

			await expect(
				provider.enqueue(testQueue, { data: { message: "test" } }),
			).rejects.toThrow("TaskProvider has been disconnected");

			await expect(
				provider.dequeue(testQueue, { handler: async () => {} }),
			).rejects.toThrow("TaskProvider has been disconnected");
		});

		test("should force disconnect", async () => {
			const p = await createCustomProvider();
			await p.connect();

			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {},
			};
			const q = uniqueQueue();
			await p.dequeue(q, handler);

			// Force disconnect should skip graceful close
			await p.disconnect(true);
			expect(p.taskHandlers.size).toBe(0);
		});
	});

	describe("getDeadLetterTasks", () => {
		test("should return empty array for queue with no dead-letter tasks", async () => {
			const deadLetterTasks = await provider.getDeadLetterTasks(testQueue);
			expect(deadLetterTasks).toEqual([]);
		});

		test("should return dead-letter tasks for queue", async () => {
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					await ctx.reject(false);
				},
			};

			await provider.dequeue(testQueue, handler);
			await provider.enqueue(testQueue, { data: { message: "test1" } });
			await provider.enqueue(testQueue, { data: { message: "test2" } });

			await waitFor(async () => {
				const dlq = await provider.getDeadLetterTasks(testQueue);
				return dlq.length === 2;
			});

			const deadLetterTasks = await provider.getDeadLetterTasks(testQueue);
			expect(deadLetterTasks.length).toBe(2);
		});
	});

	describe("getQueueStats", () => {
		test("should return empty stats for non-existent queue", async () => {
			const stats = await provider.getQueueStats("non-existent-queue");
			expect(stats).toEqual({
				waiting: 0,
				processing: 0,
				deadLetter: 0,
			});
		});

		test("should return correct stats for queue with waiting tasks", async () => {
			// Use a fresh queue with no consumer so messages stay as "ready"
			const q = uniqueQueue();
			await provider.enqueue(q, { data: { message: "test1" } });
			await provider.enqueue(q, { data: { message: "test2" } });

			// Small delay for RabbitMQ to process
			await new Promise((resolve) => setTimeout(resolve, 50));

			const stats = await provider.getQueueStats(q);
			expect(stats.waiting).toBe(2);
			expect(stats.processing).toBe(0);
			expect(stats.deadLetter).toBe(0);

			await provider.clearQueue(q);
		});

		test("should return correct stats with dead-letter tasks", async () => {
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					await ctx.reject(false);
				},
			};

			await provider.dequeue(testQueue, handler);
			await provider.enqueue(testQueue, { data: { message: "test1" } });
			await provider.enqueue(testQueue, { data: { message: "test2" } });

			await waitFor(async () => {
				const dlq = await provider.getDeadLetterTasks(testQueue);
				return dlq.length === 2;
			});

			const stats = await provider.getQueueStats(testQueue);
			expect(stats.waiting).toBe(0);
			expect(stats.deadLetter).toBe(2);
		});
	});

	describe("multiple handlers", () => {
		test("should deliver task to all registered handlers", async () => {
			let handler1Called = false;
			let handler2Called = false;

			const handler1: TaskHandler = {
				id: "handler-1",
				handler: async () => {
					handler1Called = true;
				},
			};

			const handler2: TaskHandler = {
				id: "handler-2",
				handler: async () => {
					handler2Called = true;
				},
			};

			await provider.dequeue(testQueue, handler1);
			await provider.dequeue(testQueue, handler2);
			await provider.enqueue(testQueue, { data: { message: "test" } });

			await waitFor(() => handler1Called && handler2Called);

			expect(handler1Called).toBe(true);
			expect(handler2Called).toBe(true);
		});
	});

	describe("multiple queues", () => {
		test("should maintain separate queues", async () => {
			const queue1 = uniqueQueue();
			const queue2 = uniqueQueue();

			let queue1Processed = false;
			let queue2Processed = false;

			const handler1: TaskHandler = {
				id: "handler-1",
				handler: async () => {
					queue1Processed = true;
				},
			};

			const handler2: TaskHandler = {
				id: "handler-2",
				handler: async () => {
					queue2Processed = true;
				},
			};

			await provider.dequeue(queue1, handler1);
			await provider.dequeue(queue2, handler2);
			await provider.enqueue(queue1, { data: { message: "test1" } });
			await provider.enqueue(queue2, { data: { message: "test2" } });

			await waitFor(() => queue1Processed && queue2Processed);

			expect(queue1Processed).toBe(true);
			expect(queue2Processed).toBe(true);

			const stats1 = await provider.getQueueStats(queue1);
			const stats2 = await provider.getQueueStats(queue2);

			expect(stats1.waiting).toBe(0);
			expect(stats2.waiting).toBe(0);

			// Clean up
			await provider.clearQueue(queue1);
			await provider.clearQueue(queue2);
		});
	});

	describe("task fields", () => {
		test("should preserve task data fields", async () => {
			let receivedTask: Task | undefined;

			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (task: Task) => {
					receivedTask = task;
				},
			};

			await provider.dequeue(testQueue, handler);
			await provider.enqueue(testQueue, {
				data: { message: "test", nested: { value: 123 } },
				headers: { "x-custom": "header-value" },
				priority: 5,
			});

			await waitFor(() => receivedTask !== undefined);

			expect(receivedTask).toBeDefined();
			expect(receivedTask?.data).toEqual({
				message: "test",
				nested: { value: 123 },
			});
			expect(receivedTask?.headers).toEqual({ "x-custom": "header-value" });
			expect(receivedTask?.priority).toBe(5);
			expect(receivedTask?.timestamp).toBeDefined();
		});
	});

	describe("clearQueue", () => {
		test("should clear all data for a queue", async () => {
			// Add tasks to various states
			await provider.enqueue(testQueue, { data: { message: "test1" } });

			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					await ctx.reject(false);
				},
			};

			await provider.dequeue(testQueue, handler);
			await provider.enqueue(testQueue, { data: { message: "test3" } });

			await waitFor(async () => {
				const dlq = await provider.getDeadLetterTasks(testQueue);
				return dlq.length > 0;
			});

			// Clear queue
			await provider.clearQueue(testQueue);

			// Verify data is cleared
			const statsAfter = await provider.getQueueStats(testQueue);
			expect(statsAfter.waiting).toBe(0);
			expect(statsAfter.deadLetter).toBe(0);
		});
	});

	describe("edge cases", () => {
		test("should handle disconnect during task processing", async () => {
			const q = uniqueQueue();
			const customProvider = await createCustomProvider({});
			await customProvider.connect();
			await customProvider.clearQueue(q);

			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {
					// Long operation
					await new Promise((resolve) => setTimeout(resolve, 200));
				},
			};

			await customProvider.dequeue(q, handler);
			await customProvider.enqueue(q, { data: { message: "test" } });

			// Wait just enough for processing to start
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Disconnect while potentially in the middle of processing
			await customProvider.disconnect();

			// Should handle gracefully
			expect(customProvider.taskHandlers.size).toBe(0);
		});

		test("should handle polling loop exit when inactive", async () => {
			const q = uniqueQueue();
			const customProvider = await createCustomProvider({});
			await customProvider.connect();
			await customProvider.clearQueue(q);

			await customProvider.dequeue(q, {
				id: "test-handler",
				handler: async () => {},
			});

			// Let polling start
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Disconnect - this sets _active to false
			await customProvider.disconnect();

			// Wait a bit more - polling should have stopped
			await new Promise((resolve) => setTimeout(resolve, 100));

			// No errors should occur
			expect(customProvider.taskHandlers.size).toBe(0);
		});

		test("should handle extended timeout expiration triggering reject", async () => {
			const q = uniqueQueue();
			const customProvider = await createCustomProvider({
				timeout: 5000,
				retries: 1,
			});
			await customProvider.connect();
			await customProvider.clearQueue(q);

			let extendCalled = false;
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					// Extend with a short timeout
					await ctx.extend(50);
					extendCalled = true;
					// Wait longer than the extended timeout
					await new Promise((resolve) => setTimeout(resolve, 200));
					// Task should have been auto-rejected by now via the extended timeout
				},
			};

			await customProvider.dequeue(q, handler);
			await customProvider.enqueue(q, { data: { message: "test" } });

			// Wait for processing and extended timeout to eventually move to DLQ
			await waitFor(async () => {
				const dlq = await customProvider.getDeadLetterTasks(q);
				return extendCalled && dlq.length > 0;
			}, 10_000);

			expect(extendCalled).toBe(true);

			await customProvider.clearQueue(q);
		});
	});
});
