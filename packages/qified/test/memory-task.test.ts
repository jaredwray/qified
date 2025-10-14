// biome-ignore-all lint/suspicious/noExplicitAny: This is a test file and explicit any is acceptable here.
import { beforeEach, describe, expect, test } from "vitest";
import {
	defaultMemoryTaskId,
	defaultRetries,
	defaultTimeout,
	MemoryTaskProvider,
} from "../src/memory/task.js";
import type { Task, TaskContext, TaskHandler } from "../src/types.js";

describe("MemoryTaskProvider", () => {
	let provider: MemoryTaskProvider;

	beforeEach(() => {
		provider = new MemoryTaskProvider();
	});

	describe("constructor and initialization", () => {
		test("should initialize with default values", () => {
			expect(provider.id).toBe(defaultMemoryTaskId);
			expect(provider.timeout).toBe(defaultTimeout);
			expect(provider.retries).toBe(defaultRetries);
			expect(provider.taskHandlers).toEqual(new Map());
		});

		test("should initialize with custom id", () => {
			const customProvider = new MemoryTaskProvider({ id: "custom-id" });
			expect(customProvider.id).toBe("custom-id");
		});

		test("should initialize with custom timeout", () => {
			const customProvider = new MemoryTaskProvider({ timeout: 5000 });
			expect(customProvider.timeout).toBe(5000);
		});

		test("should initialize with custom retries", () => {
			const customProvider = new MemoryTaskProvider({ retries: 5 });
			expect(customProvider.retries).toBe(5);
		});

		test("should initialize with all custom options", () => {
			const customProvider = new MemoryTaskProvider({
				id: "custom-id",
				timeout: 5000,
				retries: 5,
			});
			expect(customProvider.id).toBe("custom-id");
			expect(customProvider.timeout).toBe(5000);
			expect(customProvider.retries).toBe(5);
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
			const taskId = await provider.enqueue("test-queue", {
				data: { message: "test" },
			});

			expect(taskId).toBeDefined();
			expect(typeof taskId).toBe("string");
			expect(taskId).toMatch(/^task-\d+-\d+$/);
		});

		test("should enqueue multiple tasks with unique ids", async () => {
			const taskId1 = await provider.enqueue("test-queue", {
				data: { message: "test1" },
			});
			const taskId2 = await provider.enqueue("test-queue", {
				data: { message: "test2" },
			});

			expect(taskId1).not.toBe(taskId2);
		});

		test("should enqueue task with all optional fields", async () => {
			const taskId = await provider.enqueue("test-queue", {
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
				provider.enqueue("test-queue", { data: { message: "test" } }),
			).rejects.toThrow("TaskProvider has been disconnected");
		});
	});

	describe("dequeue and task processing", () => {
		test("should register a handler for a queue", async () => {
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {},
			};

			await provider.dequeue("test-queue", handler);

			expect(provider.taskHandlers.has("test-queue")).toBe(true);
			expect(provider.taskHandlers.get("test-queue")?.length).toBe(1);
			expect(provider.taskHandlers.get("test-queue")?.[0]).toBe(handler);
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

			await provider.dequeue("test-queue", handler1);
			await provider.dequeue("test-queue", handler2);

			expect(provider.taskHandlers.get("test-queue")?.length).toBe(2);
		});

		test("should process enqueued task when handler is registered", async () => {
			let processedTask: Task | undefined;
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (task: Task) => {
					processedTask = task;
				},
			};

			await provider.dequeue("test-queue", handler);
			const taskId = await provider.enqueue("test-queue", {
				data: { message: "test" },
			});

			// Wait a bit for async processing
			await new Promise((resolve) => setTimeout(resolve, 50));

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

			await provider.dequeue("test-queue", handler);
			await provider.enqueue("test-queue", { data: { message: "test" } });

			// Wait for processing
			await new Promise((resolve) => setTimeout(resolve, 50));

			const stats = provider.getQueueStats("test-queue");
			expect(stats.waiting).toBe(0);
			expect(stats.processing).toBe(0);
		});

		test("should throw error when disconnected", async () => {
			await provider.disconnect();

			await expect(
				provider.dequeue("test-queue", { handler: async () => {} }),
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

			await provider.dequeue("test-queue", handler);
			await provider.enqueue("test-queue", { data: { message: "test" } });

			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(context).toBeDefined();
			const stats = provider.getQueueStats("test-queue");
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

			await provider.dequeue("test-queue", handler);
			await provider.enqueue("test-queue", { data: { message: "test" } });

			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(ackCount).toBe(2);
			const stats = provider.getQueueStats("test-queue");
			expect(stats.waiting).toBe(0);
		});
	});

	describe("task rejection and retry", () => {
		test("should reject and requeue task on failure", async () => {
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

			await provider.dequeue("test-queue", handler);
			await provider.enqueue("test-queue", { data: { message: "test" } });

			// Wait for retry processing
			await new Promise((resolve) => setTimeout(resolve, 200));

			expect(attemptCount).toBeGreaterThan(1);
		});

		test("should move to dead-letter queue after max retries", async () => {
			const customProvider = new MemoryTaskProvider({ retries: 2 });
			let attemptCount = 0;

			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					attemptCount++;
					await ctx.reject(true); // Always reject
				},
			};

			await customProvider.dequeue("test-queue", handler);
			await customProvider.enqueue("test-queue", { data: { message: "test" } });

			// Wait for all retries
			await new Promise((resolve) => setTimeout(resolve, 500));

			const deadLetterTasks = customProvider.getDeadLetterTasks("test-queue");
			expect(deadLetterTasks.length).toBe(1);
			expect(deadLetterTasks[0].data).toEqual({ message: "test" });
			expect(attemptCount).toBe(2);
		});

		test("should move to dead-letter queue when reject with requeue=false", async () => {
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					await ctx.reject(false); // Don't requeue
				},
			};

			await provider.dequeue("test-queue", handler);
			await provider.enqueue("test-queue", { data: { message: "test" } });

			await new Promise((resolve) => setTimeout(resolve, 50));

			const deadLetterTasks = provider.getDeadLetterTasks("test-queue");
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

			await provider.dequeue("test-queue", handler);
			await provider.enqueue("test-queue", { data: { message: "test" } });

			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(rejectCount).toBe(2);
			const deadLetterTasks = provider.getDeadLetterTasks("test-queue");
			expect(deadLetterTasks.length).toBe(1);
		});

		test("should auto-reject task on handler error", async () => {
			let attemptCount = 0;
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {
					attemptCount++;
					throw new Error("Handler error");
				},
			};

			await provider.dequeue("test-queue", handler);
			await provider.enqueue("test-queue", { data: { message: "test" } });

			// Wait for retries
			await new Promise((resolve) => setTimeout(resolve, 500));

			expect(attemptCount).toBe(defaultRetries);
			const deadLetterTasks = provider.getDeadLetterTasks("test-queue");
			expect(deadLetterTasks.length).toBe(1);
		});
	});

	describe("task timeout", () => {
		test("should timeout task after configured timeout", async () => {
			const customProvider = new MemoryTaskProvider({ timeout: 100 });
			let taskTimedOut = false;

			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {
					// Simulate long-running task
					await new Promise((resolve) => setTimeout(resolve, 200));
					taskTimedOut = false; // Should not reach here
				},
			};

			await customProvider.dequeue("test-queue", handler);
			await customProvider.enqueue("test-queue", { data: { message: "test" } });

			await new Promise((resolve) => setTimeout(resolve, 150));

			// Task should have timed out and be requeued
			const stats = customProvider.getQueueStats("test-queue");
			// After timeout, task gets rejected and requeued
			taskTimedOut = stats.waiting > 0 || stats.deadLetter > 0;
			expect(taskTimedOut).toBe(true);
		});

		test("should use task-specific timeout over provider default", async () => {
			const customProvider = new MemoryTaskProvider({ timeout: 5000 });

			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					// Simulate long-running task
					await new Promise((resolve) => setTimeout(resolve, 200));
					await ctx.ack();
				},
			};

			await customProvider.dequeue("test-queue", handler);
			await customProvider.enqueue("test-queue", {
				data: { message: "test" },
				timeout: 50, // Task-specific timeout (shorter than handler duration)
			});

			// Wait for timeout to occur
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Task should have timed out and been requeued or moved to dead letter
			const stats = customProvider.getQueueStats("test-queue");
			expect(stats.waiting + stats.deadLetter).toBeGreaterThan(0);
		});
	});

	describe("task context extend", () => {
		test("should extend task deadline", async () => {
			const customProvider = new MemoryTaskProvider({ timeout: 100 });
			let completed = false;

			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					// Extend timeout before long operation
					await ctx.extend(300);
					await new Promise((resolve) => setTimeout(resolve, 150));
					completed = true;
					await ctx.ack();
				},
			};

			await customProvider.dequeue("test-queue", handler);
			await customProvider.enqueue("test-queue", { data: { message: "test" } });

			await new Promise((resolve) => setTimeout(resolve, 200));

			expect(completed).toBe(true);
			const stats = customProvider.getQueueStats("test-queue");
			expect(stats.waiting).toBe(0);
			expect(stats.processing).toBe(0);
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

			await provider.dequeue("test-queue", handler);
			await provider.enqueue("test-queue", { data: { message: "test" } });

			await new Promise((resolve) => setTimeout(resolve, 50));

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

			await provider.dequeue("test-queue", handler);
			await provider.enqueue("test-queue", { data: { message: "test" } });

			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(contextMetadata).toBeDefined();
			expect(contextMetadata.attempt).toBe(1);
			expect(contextMetadata.maxRetries).toBe(defaultRetries);
		});

		test("should increment attempt on retry", async () => {
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

			await provider.dequeue("test-queue", handler);
			await provider.enqueue("test-queue", { data: { message: "test" } });

			await new Promise((resolve) => setTimeout(resolve, 300));

			expect(attempts.length).toBeGreaterThan(1);
			expect(attempts[0]).toBe(1);
			expect(attempts[1]).toBe(2);
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

			await provider.dequeue("test-queue", handler);
			await provider.enqueue("test-queue", {
				data: { message: "test" },
				maxRetries: 10,
			});

			await new Promise((resolve) => setTimeout(resolve, 50));

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

			await provider.dequeue("test-queue", handler);
			await provider.enqueue("test-queue", {
				data: { message: "test" },
				scheduledAt: Date.now() + 1000, // Schedule 1 second in future
			});

			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(processed).toBe(false);
			const stats = provider.getQueueStats("test-queue");
			expect(stats.waiting).toBe(1);
		});

		test("should process task after scheduledAt time", async () => {
			let processed = false;
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {
					processed = true;
				},
			};

			await provider.dequeue("test-queue", handler);
			await provider.enqueue("test-queue", {
				data: { message: "test" },
				scheduledAt: Date.now() + 50, // Schedule 50ms in future
			});

			// Task should not be processed yet
			await new Promise((resolve) => setTimeout(resolve, 25));
			expect(processed).toBe(false);

			// Now enqueue another task to trigger processing of scheduled task
			await provider.enqueue("test-queue", { data: { message: "trigger" } });

			// Wait for scheduled task to be processed
			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(processed).toBe(true);
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

			await provider.dequeue("test-queue", handler1);
			await provider.dequeue("test-queue", handler2);

			expect(provider.taskHandlers.get("test-queue")?.length).toBe(2);

			await provider.unsubscribe("test-queue", "handler-1");

			const handlers = provider.taskHandlers.get("test-queue");
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

			await provider.dequeue("test-queue", handler1);
			await provider.dequeue("test-queue", handler2);

			expect(provider.taskHandlers.get("test-queue")?.length).toBe(2);

			await provider.unsubscribe("test-queue");

			expect(provider.taskHandlers.has("test-queue")).toBe(false);
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

			await provider.dequeue("test-queue", handler);

			await expect(
				provider.unsubscribe("test-queue", "non-existent-handler"),
			).resolves.not.toThrow();

			expect(provider.taskHandlers.get("test-queue")?.length).toBe(1);
		});
	});

	describe("disconnect", () => {
		test("should clear all queues and handlers", async () => {
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {},
			};

			await provider.dequeue("test-queue", handler);
			await provider.enqueue("test-queue", { data: { message: "test" } });

			expect(provider.taskHandlers.size).toBeGreaterThan(0);

			await provider.disconnect();

			expect(provider.taskHandlers.size).toBe(0);
			const stats = provider.getQueueStats("test-queue");
			expect(stats.waiting).toBe(0);
			expect(stats.processing).toBe(0);
		});

		test("should clear timeout handles on disconnect", async () => {
			const customProvider = new MemoryTaskProvider({ timeout: 10000 });
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {
					await new Promise((resolve) => setTimeout(resolve, 20000));
				},
			};

			await customProvider.dequeue("test-queue", handler);
			await customProvider.enqueue("test-queue", { data: { message: "test" } });

			await new Promise((resolve) => setTimeout(resolve, 50));

			// Disconnect should clear the timeout
			await customProvider.disconnect();

			// Should not cause any issues
			await new Promise((resolve) => setTimeout(resolve, 100));
		});

		test("should prevent operations after disconnect", async () => {
			await provider.disconnect();

			await expect(
				provider.enqueue("test-queue", { data: { message: "test" } }),
			).rejects.toThrow("TaskProvider has been disconnected");

			await expect(
				provider.dequeue("test-queue", { handler: async () => {} }),
			).rejects.toThrow("TaskProvider has been disconnected");
		});
	});

	describe("getDeadLetterTasks", () => {
		test("should return empty array for queue with no dead-letter tasks", () => {
			const deadLetterTasks = provider.getDeadLetterTasks("test-queue");
			expect(deadLetterTasks).toEqual([]);
		});

		test("should return dead-letter tasks for queue", async () => {
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					await ctx.reject(false);
				},
			};

			await provider.dequeue("test-queue", handler);
			await provider.enqueue("test-queue", { data: { message: "test1" } });
			await provider.enqueue("test-queue", { data: { message: "test2" } });

			await new Promise((resolve) => setTimeout(resolve, 100));

			const deadLetterTasks = provider.getDeadLetterTasks("test-queue");
			expect(deadLetterTasks.length).toBe(2);
			expect(deadLetterTasks[0].data).toEqual({ message: "test1" });
			expect(deadLetterTasks[1].data).toEqual({ message: "test2" });
		});
	});

	describe("getQueueStats", () => {
		test("should return empty stats for non-existent queue", () => {
			const stats = provider.getQueueStats("non-existent-queue");
			expect(stats).toEqual({
				waiting: 0,
				processing: 0,
				deadLetter: 0,
			});
		});

		test("should return correct stats for queue with waiting tasks", async () => {
			await provider.enqueue("test-queue", { data: { message: "test1" } });
			await provider.enqueue("test-queue", { data: { message: "test2" } });

			const stats = provider.getQueueStats("test-queue");
			expect(stats.waiting).toBe(2);
			expect(stats.processing).toBe(0);
			expect(stats.deadLetter).toBe(0);
		});

		test("should return correct stats with processing tasks", async () => {
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async () => {
					// Long-running task
					await new Promise((resolve) => setTimeout(resolve, 200));
				},
			};

			await provider.dequeue("test-queue", handler);
			await provider.enqueue("test-queue", { data: { message: "test" } });

			// Wait a bit for task to start processing
			await new Promise((resolve) => setTimeout(resolve, 50));

			const stats = provider.getQueueStats("test-queue");
			expect(stats.processing).toBeGreaterThan(0);
		});

		test("should return correct stats with dead-letter tasks", async () => {
			const handler: TaskHandler = {
				id: "test-handler",
				handler: async (_task: Task, ctx: TaskContext) => {
					await ctx.reject(false);
				},
			};

			await provider.dequeue("test-queue", handler);
			await provider.enqueue("test-queue", { data: { message: "test1" } });
			await provider.enqueue("test-queue", { data: { message: "test2" } });

			await new Promise((resolve) => setTimeout(resolve, 100));

			const stats = provider.getQueueStats("test-queue");
			expect(stats.waiting).toBe(0);
			expect(stats.processing).toBe(0);
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

			await provider.dequeue("test-queue", handler1);
			await provider.dequeue("test-queue", handler2);
			await provider.enqueue("test-queue", { data: { message: "test" } });

			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(handler1Called).toBe(true);
			expect(handler2Called).toBe(true);
		});
	});

	describe("multiple queues", () => {
		test("should maintain separate queues", async () => {
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

			await provider.dequeue("queue1", handler1);
			await provider.dequeue("queue2", handler2);
			await provider.enqueue("queue1", { data: { message: "test1" } });
			await provider.enqueue("queue2", { data: { message: "test2" } });

			await new Promise((resolve) => setTimeout(resolve, 100));

			expect(queue1Processed).toBe(true);
			expect(queue2Processed).toBe(true);

			const stats1 = provider.getQueueStats("queue1");
			const stats2 = provider.getQueueStats("queue2");

			expect(stats1.waiting).toBe(0);
			expect(stats2.waiting).toBe(0);
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

			await provider.dequeue("test-queue", handler);
			await provider.enqueue("test-queue", {
				data: { message: "test", nested: { value: 123 } },
				headers: { "x-custom": "header-value" },
				priority: 5,
			});

			await new Promise((resolve) => setTimeout(resolve, 50));

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
});
