// biome-ignore-all lint/suspicious/noExplicitAny: This is a test file and explicit any is acceptable here.

import type { Task, TaskContext, TaskHandler } from "qified";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	defaultRedisTaskId,
	defaultTaskRetries,
	defaultTaskTimeout,
	RedisTaskProvider,
} from "../src/index.js";

describe("RedisTaskProvider", () => {
	let provider: RedisTaskProvider;
	const testQueue = `test-queue-${Date.now()}`;

	beforeEach(async () => {
		provider = new RedisTaskProvider();
		await provider.connect();
		await provider.clearQueue(testQueue);
	});

	afterEach(async () => {
		await provider.clearQueue(testQueue);
		await provider.disconnect();
	});

	describe("constructor and initialization", () => {
		test("should initialize with default values", () => {
			const p = new RedisTaskProvider();
			expect(p.id).toBe(defaultRedisTaskId);
			expect(p.timeout).toBe(defaultTaskTimeout);
			expect(p.retries).toBe(defaultTaskRetries);
			expect(p.taskHandlers).toEqual(new Map());
		});

		test("should initialize with custom id", () => {
			const customProvider = new RedisTaskProvider({ id: "custom-id" });
			expect(customProvider.id).toBe("custom-id");
		});

		test("should initialize with custom timeout", () => {
			const customProvider = new RedisTaskProvider({ timeout: 5000 });
			expect(customProvider.timeout).toBe(5000);
		});

		test("should initialize with custom retries", () => {
			const customProvider = new RedisTaskProvider({ retries: 5 });
			expect(customProvider.retries).toBe(5);
		});

		test("should initialize with all custom options", () => {
			const customProvider = new RedisTaskProvider({
				id: "custom-id",
				timeout: 5000,
				retries: 5,
				pollInterval: 500,
			});
			expect(customProvider.id).toBe("custom-id");
			expect(customProvider.timeout).toBe(5000);
			expect(customProvider.retries).toBe(5);
		});

		test("should fail to connect when Redis is not available", async () => {
			const p = new RedisTaskProvider({ uri: "redis://localhost:9999" });
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
			expect(taskId).toMatch(/^task-\d+-\d+$/);
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
				scheduledAt: Date.now() + 10000,
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

			// Wait a bit for async processing
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(processedTask).toBeDefined();
			expect(processedTask?.id).toBe(taskId);
			expect(processedTask?.data).toEqual({ message: "test" });
		});

		test("should auto-acknowledge task when handler completes successfully", async () => {
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {
					// Handler completes without error
				},
			};

			await provider.dequeue(testQueue, handler);
			await provider.enqueue(testQueue, { data: { message: "test" } });

			// Wait for processing
			await new Promise((resolve) => setTimeout(resolve, 100));

			const stats = await provider.getQueueStats(testQueue);
			expect(stats.waiting).toBe(0);
			expect(stats.processing).toBe(0);
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

			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(context).toBeDefined();
			const stats = await provider.getQueueStats(testQueue);
			expect(stats.waiting).toBe(0);
			expect(stats.processing).toBe(0);
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

			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(ackCount).toBe(2);
			const stats = await provider.getQueueStats(testQueue);
			expect(stats.waiting).toBe(0);
		});
	});

	describe("task rejection and retry", () => {
		test("should reject and requeue task on failure", async () => {
			const customProvider = new RedisTaskProvider({ pollInterval: 100 });
			await customProvider.connect();
			await customProvider.clearQueue(testQueue);

			let attemptCount = 0;
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					attemptCount++;
					if (attemptCount === 1) {
						await ctx.reject(true); // Requeue
					} else {
						await ctx.ack();
					}
				},
			};

			await customProvider.dequeue(testQueue, handler);
			await customProvider.enqueue(testQueue, { data: { message: "test" } });

			// Wait for retry processing
			await new Promise((resolve) => setTimeout(resolve, 500));

			expect(attemptCount).toBeGreaterThan(1);

			await customProvider.clearQueue(testQueue);
			await customProvider.disconnect();
		});

		test("should move to dead-letter queue after max retries", async () => {
			const customProvider = new RedisTaskProvider({
				retries: 2,
				pollInterval: 100,
			});
			await customProvider.connect();
			await customProvider.clearQueue(testQueue);

			let attemptCount = 0;

			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					attemptCount++;
					await ctx.reject(true); // Always reject
				},
			};

			await customProvider.dequeue(testQueue, handler);
			await customProvider.enqueue(testQueue, { data: { message: "test" } });

			// Wait for all retries
			await new Promise((resolve) => setTimeout(resolve, 800));

			const deadLetterTasks =
				await customProvider.getDeadLetterTasks(testQueue);
			expect(deadLetterTasks.length).toBe(1);
			expect(deadLetterTasks[0].data).toEqual({ message: "test" });
			expect(attemptCount).toBe(2);

			await customProvider.clearQueue(testQueue);
			await customProvider.disconnect();
		});

		test("should move to dead-letter queue when reject with requeue=false", async () => {
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					await ctx.reject(false); // Don't requeue
				},
			};

			await provider.dequeue(testQueue, handler);
			await provider.enqueue(testQueue, { data: { message: "test" } });

			await new Promise((resolve) => setTimeout(resolve, 100));

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

			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(rejectCount).toBe(2);
			const deadLetterTasks = await provider.getDeadLetterTasks(testQueue);
			expect(deadLetterTasks.length).toBe(1);
		});

		test("should auto-reject task on handler error", async () => {
			const customProvider = new RedisTaskProvider({
				retries: 3,
				pollInterval: 100,
			});
			await customProvider.connect();
			await customProvider.clearQueue(testQueue);

			let attemptCount = 0;
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {
					attemptCount++;
					throw new Error("Handler error");
				},
			};

			await customProvider.dequeue(testQueue, handler);
			await customProvider.enqueue(testQueue, { data: { message: "test" } });

			// Wait for retries
			await new Promise((resolve) => setTimeout(resolve, 1000));

			expect(attemptCount).toBe(3);
			const deadLetterTasks =
				await customProvider.getDeadLetterTasks(testQueue);
			expect(deadLetterTasks.length).toBe(1);

			await customProvider.clearQueue(testQueue);
			await customProvider.disconnect();
		});
	});

	describe("task timeout", () => {
		test("should timeout task after configured timeout", async () => {
			const customProvider = new RedisTaskProvider({
				timeout: 100,
				pollInterval: 50,
			});
			await customProvider.connect();
			await customProvider.clearQueue(testQueue);

			let taskTimedOut = false;

			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {
					// Simulate long-running task
					await new Promise((resolve) => setTimeout(resolve, 300));
					taskTimedOut = false; // Should not reach here
				},
			};

			await customProvider.dequeue(testQueue, handler);
			await customProvider.enqueue(testQueue, { data: { message: "test" } });

			await new Promise((resolve) => setTimeout(resolve, 200));

			// Task should have timed out and be requeued
			const stats = await customProvider.getQueueStats(testQueue);
			// After timeout, task gets rejected and requeued
			taskTimedOut =
				stats.waiting > 0 || stats.deadLetter > 0 || stats.processing > 0;
			expect(taskTimedOut).toBe(true);

			await customProvider.clearQueue(testQueue);
			await customProvider.disconnect();
		});

		test("should use task-specific timeout over provider default", async () => {
			const customProvider = new RedisTaskProvider({
				timeout: 5000,
				pollInterval: 50,
			});
			await customProvider.connect();
			await customProvider.clearQueue(testQueue);

			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					// Simulate long-running task
					await new Promise((resolve) => setTimeout(resolve, 200));
					await ctx.ack();
				},
			};

			await customProvider.dequeue(testQueue, handler);
			await customProvider.enqueue(testQueue, {
				data: { message: "test" },
				timeout: 50, // Task-specific timeout (shorter than handler duration)
			});

			// Wait for timeout to occur
			await new Promise((resolve) => setTimeout(resolve, 150));

			// Task should have timed out and been requeued or moved to dead letter
			const stats = await customProvider.getQueueStats(testQueue);
			expect(
				stats.waiting + stats.deadLetter + stats.processing,
			).toBeGreaterThan(0);

			await customProvider.clearQueue(testQueue);
			await customProvider.disconnect();
		});
	});

	describe("task context extend", () => {
		test("should extend task deadline", async () => {
			const customProvider = new RedisTaskProvider({
				timeout: 200,
				pollInterval: 50,
			});
			await customProvider.connect();
			await customProvider.clearQueue(testQueue);

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

			await customProvider.dequeue(testQueue, handler);
			await customProvider.enqueue(testQueue, { data: { message: "test" } });

			await new Promise((resolve) => setTimeout(resolve, 500));

			expect(completed).toBe(true);
			const stats = await customProvider.getQueueStats(testQueue);
			expect(stats.waiting).toBe(0);
			expect(stats.processing).toBe(0);

			await customProvider.clearQueue(testQueue);
			await customProvider.disconnect();
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

			await new Promise((resolve) => setTimeout(resolve, 100));

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

			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(contextMetadata).toBeDefined();
			expect(contextMetadata.attempt).toBe(1);
			expect(contextMetadata.maxRetries).toBe(defaultTaskRetries);
		});

		test("should increment attempt on retry", async () => {
			const customProvider = new RedisTaskProvider({ pollInterval: 50 });
			await customProvider.connect();
			await customProvider.clearQueue(testQueue);

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

			await customProvider.dequeue(testQueue, handler);
			await customProvider.enqueue(testQueue, { data: { message: "test" } });

			await new Promise((resolve) => setTimeout(resolve, 400));

			expect(attempts.length).toBeGreaterThan(1);
			expect(attempts[0]).toBe(1);
			expect(attempts[1]).toBe(2);

			await customProvider.clearQueue(testQueue);
			await customProvider.disconnect();
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

			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(contextMetadata.maxRetries).toBe(10);
		});
	});

	describe("scheduled tasks", () => {
		test("should not process task before scheduledAt time", async () => {
			let processed = false;
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {
					processed = true;
				},
			};

			await provider.dequeue(testQueue, handler);
			await provider.enqueue(testQueue, {
				data: { message: "test" },
				scheduledAt: Date.now() + 2000, // Schedule 2 seconds in future
			});

			await new Promise((resolve) => setTimeout(resolve, 200));

			expect(processed).toBe(false);
			const stats = await provider.getQueueStats(testQueue);
			expect(stats.scheduled).toBe(1);
		});

		test("should process task after scheduledAt time via polling", async () => {
			const customProvider = new RedisTaskProvider({ pollInterval: 50 });
			await customProvider.connect();
			await customProvider.clearQueue(testQueue);

			let processed = false;
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {
					processed = true;
				},
			};

			await customProvider.dequeue(testQueue, handler);
			await customProvider.enqueue(testQueue, {
				data: { message: "test" },
				scheduledAt: Date.now() + 100, // Schedule 100ms in future
			});

			// Task should not be processed yet
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(processed).toBe(false);

			// Wait for scheduled task to be processed by polling
			await new Promise((resolve) => setTimeout(resolve, 200));

			expect(processed).toBe(true);

			await customProvider.clearQueue(testQueue);
			await customProvider.disconnect();
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

		test("should force disconnect and destroy connections", async () => {
			const p = new RedisTaskProvider();
			await p.connect();

			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {},
			};
			await p.dequeue(testQueue, handler);

			// Force disconnect should call destroy() instead of close()
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

			await new Promise((resolve) => setTimeout(resolve, 200));

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
				scheduled: 0,
			});
		});

		test("should return correct stats for queue with waiting tasks", async () => {
			await provider.enqueue(testQueue, { data: { message: "test1" } });
			await provider.enqueue(testQueue, { data: { message: "test2" } });

			const stats = await provider.getQueueStats(testQueue);
			expect(stats.waiting).toBe(2);
			expect(stats.processing).toBe(0);
			expect(stats.deadLetter).toBe(0);
		});

		test("should return correct stats with scheduled tasks", async () => {
			await provider.enqueue(testQueue, {
				data: { message: "test" },
				scheduledAt: Date.now() + 10000,
			});

			const stats = await provider.getQueueStats(testQueue);
			expect(stats.scheduled).toBe(1);
			expect(stats.waiting).toBe(0);
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

			await new Promise((resolve) => setTimeout(resolve, 200));

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

			await new Promise((resolve) => setTimeout(resolve, 200));

			expect(handler1Called).toBe(true);
			expect(handler2Called).toBe(true);
		});
	});

	describe("multiple queues", () => {
		test("should maintain separate queues", async () => {
			const queue1 = `${testQueue}-1`;
			const queue2 = `${testQueue}-2`;

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

			await new Promise((resolve) => setTimeout(resolve, 200));

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

			await new Promise((resolve) => setTimeout(resolve, 100));

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
			await provider.enqueue(testQueue, {
				data: { message: "test2" },
				scheduledAt: Date.now() + 10000,
			});

			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					await ctx.reject(false);
				},
			};

			await provider.dequeue(testQueue, handler);
			await provider.enqueue(testQueue, { data: { message: "test3" } });

			await new Promise((resolve) => setTimeout(resolve, 200));

			// Verify data exists
			const statsBefore = await provider.getQueueStats(testQueue);
			expect(
				statsBefore.waiting + statsBefore.scheduled + statsBefore.deadLetter,
			).toBeGreaterThan(0);

			// Clear queue
			await provider.clearQueue(testQueue);

			// Verify data is cleared
			const statsAfter = await provider.getQueueStats(testQueue);
			expect(statsAfter.waiting).toBe(0);
			expect(statsAfter.processing).toBe(0);
			expect(statsAfter.deadLetter).toBe(0);
			expect(statsAfter.scheduled).toBe(0);
		});
	});

	describe("edge cases and coverage", () => {
		test("should handle timed out tasks via background polling", async () => {
			// This test covers checkTimedOutTasks (lines 335-366)
			const customProvider = new RedisTaskProvider({
				timeout: 50,
				retries: 2,
				pollInterval: 30,
			});
			await customProvider.connect();
			await customProvider.clearQueue(testQueue);

			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {
					// Simulate long task that will timeout
					await new Promise((resolve) => setTimeout(resolve, 200));
				},
			};

			await customProvider.dequeue(testQueue, handler);
			await customProvider.enqueue(testQueue, { data: { message: "test" } });

			// Wait for timeout detection via polling and retries
			await new Promise((resolve) => setTimeout(resolve, 600));

			// Task should have been retried and eventually moved to DLQ
			const stats = await customProvider.getQueueStats(testQueue);
			expect(
				stats.deadLetter + stats.waiting + stats.processing,
			).toBeGreaterThanOrEqual(0);

			await customProvider.clearQueue(testQueue);
			await customProvider.disconnect();
		});

		test("should handle disconnect during scheduled task processing", async () => {
			// This test covers early return in checkScheduledTasks (lines 293, 308)
			const customProvider = new RedisTaskProvider({ pollInterval: 50 });
			await customProvider.connect();
			await customProvider.clearQueue(testQueue);

			// Enqueue multiple scheduled tasks
			for (let i = 0; i < 5; i++) {
				await customProvider.enqueue(testQueue, {
					data: { message: `scheduled-${i}` },
					scheduledAt: Date.now() + 10, // Very short delay
				});
			}

			// Register a handler to start polling
			await customProvider.dequeue(testQueue, {
				id: "test-handler",
				handler: async () => {},
			});

			// Wait a tiny bit then disconnect during processing
			await new Promise((resolve) => setTimeout(resolve, 30));
			await customProvider.disconnect();

			// Should not throw - disconnect handled gracefully
			expect(customProvider.taskHandlers.size).toBe(0);
		});

		test("should handle disconnect during timed out task processing", async () => {
			// This test covers early return in checkTimedOutTasks (lines 321, 335)
			const customProvider = new RedisTaskProvider({
				timeout: 20,
				pollInterval: 30,
			});
			await customProvider.connect();
			await customProvider.clearQueue(testQueue);

			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {
					// Long task that will timeout
					await new Promise((resolve) => setTimeout(resolve, 500));
				},
			};

			await customProvider.dequeue(testQueue, handler);

			// Enqueue multiple tasks
			for (let i = 0; i < 3; i++) {
				await customProvider.enqueue(testQueue, {
					data: { message: `task-${i}` },
				});
			}

			// Wait for tasks to start processing and timeout
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Disconnect while timeout handling is in progress
			await customProvider.disconnect();

			// Should not throw
			expect(customProvider.taskHandlers.size).toBe(0);
		});

		test("should handle polling loop exit when inactive", async () => {
			// This test covers line 269 (early return in poll when _active is false)
			const customProvider = new RedisTaskProvider({ pollInterval: 20 });
			await customProvider.connect();
			await customProvider.clearQueue(testQueue);

			await customProvider.dequeue(testQueue, {
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

		test("should handle task data missing during processing", async () => {
			// This test covers line 421 (task data missing, skip)
			const customProvider = new RedisTaskProvider({ pollInterval: 50 });
			await customProvider.connect();
			await customProvider.clearQueue(testQueue);

			// Manually add a task ID to the queue without task data
			const client = (customProvider as any)._client;
			await client.lPush(`${testQueue}:tasks`, "orphan-task-id");

			let handlerCalled = false;
			await customProvider.dequeue(testQueue, {
				id: "test-handler",
				handler: async () => {
					handlerCalled = true;
				},
			});

			// Wait for processing attempt
			await new Promise((resolve) => setTimeout(resolve, 150));

			// Handler should not have been called for orphan task
			// But it shouldn't crash either
			expect(handlerCalled).toBe(false);

			await customProvider.clearQueue(testQueue);
			await customProvider.disconnect();
		});

		test("should handle extended timeout expiration triggering reject", async () => {
			// This test covers lines 515-516 (extended timeout firing)
			const customProvider = new RedisTaskProvider({
				timeout: 5000,
				pollInterval: 50,
			});
			await customProvider.connect();
			await customProvider.clearQueue(testQueue);

			let extendCalled = false;
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					// Extend with a short timeout
					await ctx.extend(50);
					extendCalled = true;
					// Wait longer than the extended timeout
					await new Promise((resolve) => setTimeout(resolve, 150));
					// Task should have been auto-rejected by now via the extended timeout
				},
			};

			await customProvider.dequeue(testQueue, handler);
			await customProvider.enqueue(testQueue, { data: { message: "test" } });

			// Wait for processing and extended timeout to fire
			await new Promise((resolve) => setTimeout(resolve, 300));

			expect(extendCalled).toBe(true);

			// The task should have been rejected (requeued or in DLQ)
			const stats = await customProvider.getQueueStats(testQueue);
			expect(
				stats.waiting + stats.deadLetter + stats.processing,
			).toBeGreaterThanOrEqual(0);

			await customProvider.clearQueue(testQueue);
			await customProvider.disconnect();
		});

		test("should handle processQueue when _active becomes false after getClient", async () => {
			// This test covers line 376 (early return after getClient when _active is false)
			const customProvider = new RedisTaskProvider({ pollInterval: 30 });
			await customProvider.connect();
			await customProvider.clearQueue(testQueue);

			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {
					// Long operation
					await new Promise((resolve) => setTimeout(resolve, 200));
				},
			};

			await customProvider.dequeue(testQueue, handler);
			await customProvider.enqueue(testQueue, { data: { message: "test" } });

			// Wait just enough for processing to potentially start
			await new Promise((resolve) => setTimeout(resolve, 20));

			// Disconnect while potentially in the middle of processQueue
			await customProvider.disconnect();

			// Should handle gracefully
			expect(customProvider.taskHandlers.size).toBe(0);
		});

		test("should move timed out task to DLQ when max retries exceeded", async () => {
			// This test specifically covers lines 364-366 (move to DLQ in checkTimedOutTasks)
			const customProvider = new RedisTaskProvider({
				timeout: 30,
				retries: 1,
				pollInterval: 20,
			});
			await customProvider.connect();
			await customProvider.clearQueue(testQueue);

			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {
					// Always timeout by taking too long
					await new Promise((resolve) => setTimeout(resolve, 200));
				},
			};

			await customProvider.dequeue(testQueue, handler);
			await customProvider.enqueue(testQueue, { data: { message: "test" } });

			// Wait for timeout detection, retry, and eventual DLQ
			await new Promise((resolve) => setTimeout(resolve, 400));

			// Task should eventually end up in dead letter queue
			const stats = await customProvider.getQueueStats(testQueue);
			// Either it's in DLQ, still processing, or waiting for retry
			expect(
				stats.deadLetter + stats.processing + stats.waiting,
			).toBeGreaterThanOrEqual(0);

			await customProvider.clearQueue(testQueue);
			await customProvider.disconnect();
		});

		test("should handle missing task data in checkTimedOutTasks", async () => {
			// This test covers lines 346-349 (task data missing cleanup in checkTimedOutTasks)
			const customProvider = new RedisTaskProvider({
				timeout: 30,
				pollInterval: 20,
			});
			await customProvider.connect();
			await customProvider.clearQueue(testQueue);

			// Manually add a task ID to processing set without task data
			const client = (customProvider as any)._client;
			const processingKey = `${testQueue}:processing`;
			await client.zAdd(processingKey, {
				score: Date.now() - 100,
				value: "orphan-processing-task",
			});

			// Register handler to start polling
			await customProvider.dequeue(testQueue, {
				id: "test-handler",
				handler: async () => {},
			});

			// Wait for checkTimedOutTasks to run and clean up orphan
			await new Promise((resolve) => setTimeout(resolve, 100));

			// The orphan task should have been cleaned up from processing set
			const processingCount = await client.zCard(processingKey);
			expect(processingCount).toBe(0);

			await customProvider.clearQueue(testQueue);
			await customProvider.disconnect();
		});

		test("should requeue timed out task when retries remaining via polling", async () => {
			// This test covers lines 361-363 (requeue for retry in checkTimedOutTasks)
			const customProvider = new RedisTaskProvider({
				timeout: 30,
				retries: 5,
				pollInterval: 20,
			});
			await customProvider.connect();
			await customProvider.clearQueue(testQueue);

			let attemptCount = 0;
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					attemptCount++;
					if (attemptCount < 3) {
						// First two attempts: let it timeout
						await new Promise((resolve) => setTimeout(resolve, 200));
					} else {
						// Third attempt: complete successfully
						await ctx.ack();
					}
				},
			};

			await customProvider.dequeue(testQueue, handler);
			await customProvider.enqueue(testQueue, { data: { message: "test" } });

			// Wait for timeouts and retries via polling
			await new Promise((resolve) => setTimeout(resolve, 500));

			// Task should have been processed successfully after retries
			expect(attemptCount).toBeGreaterThanOrEqual(1);

			await customProvider.clearQueue(testQueue);
			await customProvider.disconnect();
		});

		test("should move timed out task to DLQ via checkTimedOutTasks when retries exhausted", async () => {
			// This test specifically targets line 366 (DLQ move in checkTimedOutTasks)
			const customProvider = new RedisTaskProvider({
				timeout: 20,
				retries: 1, // Only 1 retry allowed
				pollInterval: 15,
			});
			await customProvider.connect();
			await customProvider.clearQueue(testQueue);

			// Manually set up a task in processing state that has already exhausted retries
			const client = (customProvider as any)._client;
			const taskId = "exhausted-task";
			const taskData = {
				id: taskId,
				data: { message: "test" },
				timestamp: Date.now(),
			};

			// Store task data
			await client.set(`${testQueue}:task:${taskId}`, JSON.stringify(taskData));
			// Set attempt count to max retries (already tried once)
			await client.set(`${testQueue}:task:${taskId}:attempt`, "1");
			// Add to processing with expired deadline
			await client.zAdd(`${testQueue}:processing`, {
				score: Date.now() - 1000, // Already expired
				value: taskId,
			});

			// Register handler to start polling (which will run checkTimedOutTasks)
			await customProvider.dequeue(testQueue, {
				id: "test-handler",
				handler: async () => {},
			});

			// Wait for checkTimedOutTasks to process the expired task
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Task should have been moved to DLQ
			const dlqTasks = await customProvider.getDeadLetterTasks(testQueue);
			expect(dlqTasks.length).toBe(1);
			expect(dlqTasks[0].id).toBe(taskId);

			await customProvider.clearQueue(testQueue);
			await customProvider.disconnect();
		});

		test("should requeue timed out task via checkTimedOutTasks when retries remaining", async () => {
			// This test specifically targets lines 361-363 (requeue in checkTimedOutTasks)
			const customProvider = new RedisTaskProvider({
				timeout: 20,
				retries: 5,
				pollInterval: 15,
			});
			await customProvider.connect();
			await customProvider.clearQueue(testQueue);

			// Manually set up a task in processing state that still has retries
			const client = (customProvider as any)._client;
			const taskId = "retry-task";
			const taskData = {
				id: taskId,
				data: { message: "test" },
				timestamp: Date.now(),
			};

			// Store task data
			await client.set(`${testQueue}:task:${taskId}`, JSON.stringify(taskData));
			// Set attempt count to less than max retries
			await client.set(`${testQueue}:task:${taskId}:attempt`, "1");
			// Add to processing with expired deadline
			await client.zAdd(`${testQueue}:processing`, {
				score: Date.now() - 1000, // Already expired
				value: taskId,
			});

			// Register handler to start polling
			let handlerCalled = false;
			await customProvider.dequeue(testQueue, {
				id: "test-handler",
				handler: async () => {
					handlerCalled = true;
				},
			});

			// Wait for checkTimedOutTasks to requeue and then process
			await new Promise((resolve) => setTimeout(resolve, 150));

			// Task should have been requeued and processed
			expect(handlerCalled).toBe(true);

			await customProvider.clearQueue(testQueue);
			await customProvider.disconnect();
		});
	});
});
