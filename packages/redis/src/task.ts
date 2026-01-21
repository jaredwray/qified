import { Hookified } from "hookified";
import type {
	EnqueueTask,
	Task,
	TaskContext,
	TaskHandler,
	TaskProvider,
	TaskProviderOptions,
} from "qified";
import { createClient, type RedisClientType } from "redis";

/**
 * Configuration options for the Redis task provider.
 */
export type RedisTaskProviderOptions = TaskProviderOptions & {
	/** Redis connection URI. Defaults to "redis://localhost:6379" */
	uri?: string;
	/** Unique identifier for this provider instance. Defaults to "@qified/redis-task" */
	id?: string;
	/** Poll interval in milliseconds for checking scheduled and timed-out tasks. Defaults to 1000 */
	pollInterval?: number;
};

/** Default Redis connection URI */
export const defaultRedisUri = "redis://localhost:6379";

/** Default Redis task provider identifier */
export const defaultRedisTaskId = "@qified/redis-task";

/** Default timeout for task processing (30 seconds) */
export const defaultTimeout = 30000;

/** Default maximum retry attempts */
export const defaultRetries = 3;

/** Default poll interval (1 second) */
export const defaultPollInterval = 1000;

/**
 * Redis-based task provider for Qified.
 * Uses Redis lists and sorted sets to enable reliable task queue processing
 * across multiple instances with visibility timeout, retries, and dead-letter queues.
 * Extends Hookified to emit events for errors and other lifecycle events.
 */
export class RedisTaskProvider extends Hookified implements TaskProvider {
	private _id: string;
	private _timeout: number;
	private _retries: number;
	private _taskHandlers: Map<string, TaskHandler[]>;
	private _client: RedisClientType;
	private _connectionPromise: Promise<void> | null = null;
	private _active = true;
	private _pollInterval: number;
	private _pollTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
	private _taskIdCounter = 0;
	private _processingTasks: Map<string, Set<string>> = new Map();

	/**
	 * Creates a new Redis task provider instance.
	 * @param options Configuration options for the provider
	 */
	constructor(options: RedisTaskProviderOptions = {}) {
		super();
		const uri = options.uri ?? defaultRedisUri;
		this._id = options.id ?? defaultRedisTaskId;
		this._timeout = options.timeout ?? defaultTimeout;
		this._retries = options.retries ?? defaultRetries;
		this._pollInterval = options.pollInterval ?? defaultPollInterval;
		this._taskHandlers = new Map();
		this._client = createClient({ url: uri });
	}

	/**
	 * Gets the provider ID.
	 */
	public get id(): string {
		return this._id;
	}

	/**
	 * Sets the provider ID.
	 */
	public set id(id: string) {
		this._id = id;
	}

	/**
	 * Gets the default timeout for task processing.
	 */
	public get timeout(): number {
		return this._timeout;
	}

	/**
	 * Sets the default timeout for task processing.
	 */
	public set timeout(timeout: number) {
		this._timeout = timeout;
	}

	/**
	 * Gets the default maximum retry attempts.
	 */
	public get retries(): number {
		return this._retries;
	}

	/**
	 * Sets the default maximum retry attempts.
	 */
	public set retries(retries: number) {
		this._retries = retries;
	}

	/**
	 * Gets the task handlers map.
	 */
	public get taskHandlers(): Map<string, TaskHandler[]> {
		return this._taskHandlers;
	}

	/**
	 * Sets the task handlers map.
	 */
	public set taskHandlers(value: Map<string, TaskHandler[]>) {
		this._taskHandlers = value;
	}

	/**
	 * Connects to Redis. Can be called explicitly or will be called automatically on first use.
	 */
	async connect(): Promise<void> {
		if (!this._connectionPromise) {
			this._connectionPromise = (async () => {
				await this._client.connect();
			})();
		}
		return this._connectionPromise;
	}

	/**
	 * Returns the connected client, connecting if necessary.
	 */
	private async getClient(): Promise<RedisClientType> {
		await this.connect();
		return this._client;
	}

	/**
	 * Generates a unique task ID.
	 */
	private generateTaskId(): string {
		return `task-${Date.now()}-${++this._taskIdCounter}`;
	}

	/**
	 * Gets the Redis key for the task queue list.
	 */
	private getQueueKey(queue: string): string {
		return `${queue}:tasks`;
	}

	/**
	 * Gets the Redis key for scheduled tasks sorted set.
	 */
	private getScheduledKey(queue: string): string {
		return `${queue}:scheduled`;
	}

	/**
	 * Gets the Redis key for processing tasks sorted set.
	 */
	private getProcessingKey(queue: string): string {
		return `${queue}:processing`;
	}

	/**
	 * Gets the Redis key for dead-letter queue.
	 */
	private getDeadLetterKey(queue: string): string {
		return `${queue}:dead-letter`;
	}

	/**
	 * Gets the Redis key for task data.
	 */
	private getTaskDataKey(queue: string, taskId: string): string {
		return `${queue}:task:${taskId}`;
	}

	/**
	 * Gets the Redis key for task attempt count.
	 */
	private getTaskAttemptKey(queue: string, taskId: string): string {
		return `${queue}:task:${taskId}:attempt`;
	}

	/**
	 * Enqueues a task to a specific queue.
	 * @param queue The queue name to enqueue to
	 * @param taskData The task data to enqueue
	 * @returns The ID of the enqueued task
	 */
	public async enqueue(queue: string, taskData: EnqueueTask): Promise<string> {
		if (!this._active) {
			throw new Error("TaskProvider has been disconnected");
		}

		const client = await this.getClient();

		const task: Task = {
			id: this.generateTaskId(),
			timestamp: Date.now(),
			...taskData,
		};

		// Store task data
		await client.set(this.getTaskDataKey(queue, task.id), JSON.stringify(task));

		// Initialize attempt count
		await client.set(this.getTaskAttemptKey(queue, task.id), "0");

		// Add to appropriate queue
		if (task.scheduledAt && task.scheduledAt > Date.now()) {
			// Add to scheduled sorted set with scheduledAt as score
			await client.zAdd(this.getScheduledKey(queue), {
				score: task.scheduledAt,
				value: task.id,
			});
		} else {
			// Add to queue list (LPUSH for FIFO with RPOP)
			await client.lPush(this.getQueueKey(queue), task.id);
		}

		// Process immediately if handlers are registered
		void this.processQueue(queue);

		return task.id;
	}

	/**
	 * Registers a handler to process tasks from a queue.
	 * @param queue The queue name to dequeue from
	 * @param handler The handler configuration
	 */
	public async dequeue(queue: string, handler: TaskHandler): Promise<void> {
		if (!this._active) {
			throw new Error("TaskProvider has been disconnected");
		}

		if (!this._taskHandlers.has(queue)) {
			this._taskHandlers.set(queue, []);
		}

		this._taskHandlers.get(queue)?.push(handler);

		// Start polling for this queue if not already polling
		if (!this._pollTimers.has(queue)) {
			this.startPolling(queue);
		}

		// Process any pending tasks
		await this.processQueue(queue);
	}

	/**
	 * Starts the polling loop for a queue.
	 */
	private startPolling(queue: string): void {
		const poll = async () => {
			if (!this._active) {
				return;
			}

			try {
				await this.checkScheduledTasks(queue);
				await this.checkTimedOutTasks(queue);
				await this.processQueue(queue);
			} catch (error) {
				this.emit("error", error);
			}

			if (this._active && this._taskHandlers.has(queue)) {
				this._pollTimers.set(queue, setTimeout(poll, this._pollInterval));
			}
		};

		this._pollTimers.set(queue, setTimeout(poll, this._pollInterval));
	}

	/**
	 * Checks for scheduled tasks that are ready to execute.
	 */
	private async checkScheduledTasks(queue: string): Promise<void> {
		if (!this._active) {
			return;
		}

		const client = await this.getClient();
		const now = Date.now();

		// Get scheduled tasks with score <= now
		const readyTasks = await client.zRangeByScore(
			this.getScheduledKey(queue),
			0,
			now,
		);

		for (const taskId of readyTasks) {
			if (!this._active) {
				return;
			}
			// Move from scheduled to queue
			await client.zRem(this.getScheduledKey(queue), taskId);
			await client.lPush(this.getQueueKey(queue), taskId);
		}
	}

	/**
	 * Checks for tasks that have timed out during processing.
	 */
	private async checkTimedOutTasks(queue: string): Promise<void> {
		if (!this._active) {
			return;
		}

		const client = await this.getClient();
		const now = Date.now();

		// Get tasks with deadline < now
		const timedOutTasks = await client.zRangeByScore(
			this.getProcessingKey(queue),
			0,
			now - 1,
		);

		for (const taskId of timedOutTasks) {
			if (!this._active) {
				return;
			}
			// Get attempt count
			const attemptStr = await client.get(
				this.getTaskAttemptKey(queue, taskId),
			);
			const attempt = Number.parseInt(attemptStr ?? "0", 10);

			// Get task data to check maxRetries
			const taskDataStr = await client.get(this.getTaskDataKey(queue, taskId));
			if (!taskDataStr) {
				// Task data missing, clean up
				await client.zRem(this.getProcessingKey(queue), taskId);
				continue;
			}

			const task = JSON.parse(taskDataStr) as Task;
			const maxRetries = task.maxRetries ?? this._retries;

			// Remove from processing
			await client.zRem(this.getProcessingKey(queue), taskId);

			// Remove from local processing set
			this._processingTasks.get(queue)?.delete(taskId);

			if (attempt < maxRetries) {
				// Requeue for retry
				await client.lPush(this.getQueueKey(queue), taskId);
			} else {
				// Move to dead-letter queue
				await client.lPush(this.getDeadLetterKey(queue), taskId);
			}
		}
	}

	/**
	 * Processes tasks in a queue by delivering them to registered handlers.
	 */
	private async processQueue(queue: string): Promise<void> {
		if (!this._active) {
			return;
		}

		const handlers = this._taskHandlers.get(queue);
		if (!handlers || handlers.length === 0) {
			return;
		}

		const client = await this.getClient();

		// Check again after async operation
		if (!this._active) {
			return;
		}

		// Initialize processing set for this queue if needed
		if (!this._processingTasks.has(queue)) {
			this._processingTasks.set(queue, new Set());
		}

		const processingSet = this._processingTasks.get(queue) ?? new Set<string>();

		// Get task from queue
		let taskId: string | null;
		try {
			taskId = await client.rPop(this.getQueueKey(queue));
		} catch (error) {
			this.emit("error", error);
			return;
		}
		if (!taskId) {
			return;
		}

		// Check if already being processed locally
		if (processingSet.has(taskId)) {
			// Put back in queue and return
			await client.lPush(this.getQueueKey(queue), taskId);
			return;
		}

		// Get task data
		const taskDataStr = await client.get(this.getTaskDataKey(queue, taskId));
		if (!taskDataStr) {
			// Task data missing, skip
			return;
		}

		const task = JSON.parse(taskDataStr) as Task;

		// Mark as processing locally
		processingSet.add(taskId);

		// Process with each handler
		for (const handler of handlers) {
			void this.processTask(queue, task, handler);
		}

		// Continue processing more tasks
		void this.processQueue(queue);
	}

	/**
	 * Processes a single task with a handler.
	 */
	private async processTask(
		queue: string,
		task: Task,
		handler: TaskHandler,
	): Promise<void> {
		const client = await this.getClient();
		const maxRetries = task.maxRetries ?? this._retries;
		const timeout = task.timeout ?? this._timeout;

		// Increment attempt count
		const attempt = await client.incr(this.getTaskAttemptKey(queue, task.id));

		// Add to processing sorted set with deadline
		const deadline = Date.now() + timeout;
		await client.zAdd(this.getProcessingKey(queue), {
			score: deadline,
			value: task.id,
		});

		let acknowledged = false;
		let rejected = false;
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

		// Create task context
		const context: TaskContext = {
			ack: async () => {
				if (acknowledged || rejected || !this._active) {
					return;
				}
				acknowledged = true;
				try {
					await this.removeTask(queue, task.id);
				} catch (error) {
					this.emit("error", error);
				}
			},
			reject: async (requeue = true) => {
				if (acknowledged || rejected || !this._active) {
					return;
				}
				rejected = true;

				try {
					// Remove from processing
					await client.zRem(this.getProcessingKey(queue), task.id);
					this._processingTasks.get(queue)?.delete(task.id);

					if (requeue && attempt < maxRetries) {
						// Requeue for retry
						await client.lPush(this.getQueueKey(queue), task.id);
					} else {
						// Move to dead-letter queue
						await client.lPush(this.getDeadLetterKey(queue), task.id);
					}
				} catch (error) {
					this.emit("error", error);
				}
			},
			extend: async (ttl: number) => {
				if (acknowledged || rejected || !this._active) {
					return;
				}
				try {
					// Update deadline in processing set
					const newDeadline = Date.now() + ttl;
					await client.zAdd(this.getProcessingKey(queue), {
						score: newDeadline,
						value: task.id,
					});
					// Reset timeout handle
					if (timeoutHandle) {
						clearTimeout(timeoutHandle);
					}
					timeoutHandle = setTimeout(() => {
						if (!acknowledged && !rejected && this._active) {
							void context.reject(true);
						}
					}, ttl);
				} catch (error) {
					this.emit("error", error);
				}
			},
			metadata: {
				attempt,
				maxRetries,
			},
		};

		// Set timeout handler
		timeoutHandle = setTimeout(() => {
			if (!acknowledged && !rejected && this._active) {
				void context.reject(true);
			}
		}, timeout);

		try {
			await handler.handler(task, context);

			// Auto-ack if handler completes without explicit ack/reject
			if (!acknowledged && !rejected) {
				await context.ack();
			}
		} catch {
			// Auto-reject on error
			if (!acknowledged && !rejected) {
				await context.reject(true);
			}
		} finally {
			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
			}
		}
	}

	/**
	 * Removes a task completely (on successful ack).
	 */
	private async removeTask(queue: string, taskId: string): Promise<void> {
		const client = await this.getClient();

		// Remove from processing set
		await client.zRem(this.getProcessingKey(queue), taskId);

		// Remove task data
		await client.del(this.getTaskDataKey(queue, taskId));

		// Remove attempt counter
		await client.del(this.getTaskAttemptKey(queue, taskId));

		// Remove from local processing set
		this._processingTasks.get(queue)?.delete(taskId);
	}

	/**
	 * Unsubscribes a handler from a queue.
	 * @param queue The queue name to unsubscribe from
	 * @param id Optional handler ID. If not provided, removes all handlers.
	 */
	public async unsubscribe(queue: string, id?: string): Promise<void> {
		if (id) {
			const handlers = this._taskHandlers.get(queue);
			if (handlers) {
				this._taskHandlers.set(
					queue,
					handlers.filter((h) => h.id !== id),
				);
			}
		} else {
			this._taskHandlers.delete(queue);
		}

		// Stop polling if no handlers left for this queue
		if (
			!this._taskHandlers.has(queue) ||
			this._taskHandlers.get(queue)?.length === 0
		) {
			const timer = this._pollTimers.get(queue);
			if (timer) {
				clearTimeout(timer);
				this._pollTimers.delete(queue);
			}
		}
	}

	/**
	 * Disconnects and cleans up the provider.
	 * @param force If true, forcefully terminates the connection. Defaults to false.
	 */
	public async disconnect(force = false): Promise<void> {
		this._active = false;

		// Clear all poll timers
		for (const timer of this._pollTimers.values()) {
			clearTimeout(timer);
		}
		this._pollTimers.clear();

		// Clear handlers
		this._taskHandlers.clear();
		this._processingTasks.clear();

		// Disconnect from Redis
		if (this._connectionPromise) {
			await this._connectionPromise;

			if (force) {
				if (this._client.isOpen) {
					this._client.destroy();
				}
			} else {
				if (this._client.isOpen) {
					await this._client.close();
				}
			}

			this._connectionPromise = null;
		}
	}

	/**
	 * Gets all tasks in the dead-letter queue for a specific queue.
	 * @param queue The queue name
	 * @returns Array of tasks in the dead-letter queue
	 */
	public async getDeadLetterTasks(queue: string): Promise<Task[]> {
		const client = await this.getClient();
		const taskIds = await client.lRange(this.getDeadLetterKey(queue), 0, -1);

		const tasks: Task[] = [];
		for (const taskId of taskIds) {
			const taskDataStr = await client.get(this.getTaskDataKey(queue, taskId));
			if (taskDataStr) {
				tasks.push(JSON.parse(taskDataStr) as Task);
			}
		}

		return tasks;
	}

	/**
	 * Gets the current state of a queue.
	 * @param queue The queue name
	 * @returns Queue statistics
	 */
	public async getQueueStats(queue: string): Promise<{
		waiting: number;
		processing: number;
		deadLetter: number;
		scheduled: number;
	}> {
		const client = await this.getClient();

		const [waiting, processing, deadLetter, scheduled] = await Promise.all([
			client.lLen(this.getQueueKey(queue)),
			client.zCard(this.getProcessingKey(queue)),
			client.lLen(this.getDeadLetterKey(queue)),
			client.zCard(this.getScheduledKey(queue)),
		]);

		return {
			waiting,
			processing,
			deadLetter,
			scheduled,
		};
	}

	/**
	 * Clears all data for a queue. Useful for testing.
	 * @param queue The queue name to clear
	 */
	public async clearQueue(queue: string): Promise<void> {
		const client = await this.getClient();

		// Get all task IDs from all locations
		const [queueTasks, processingTasks, deadLetterTasks, scheduledTasks] =
			await Promise.all([
				client.lRange(this.getQueueKey(queue), 0, -1),
				client.zRange(this.getProcessingKey(queue), 0, -1),
				client.lRange(this.getDeadLetterKey(queue), 0, -1),
				client.zRange(this.getScheduledKey(queue), 0, -1),
			]);

		const allTaskIds = [
			...queueTasks,
			...processingTasks,
			...deadLetterTasks,
			...scheduledTasks,
		];

		// Delete all task data and attempt counters
		for (const taskId of allTaskIds) {
			await client.del(this.getTaskDataKey(queue, taskId));
			await client.del(this.getTaskAttemptKey(queue, taskId));
		}

		// Clear all queue structures
		await client.del(this.getQueueKey(queue));
		await client.del(this.getProcessingKey(queue));
		await client.del(this.getDeadLetterKey(queue));
		await client.del(this.getScheduledKey(queue));
	}
}
