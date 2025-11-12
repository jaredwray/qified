import type {
	EnqueueTask,
	Task,
	TaskContext,
	TaskHandler,
	TaskProvider,
	TaskProviderOptions,
} from "../types.js";

/**
 * Configuration options for the memory task provider.
 */
export type MemoryTaskProviderOptions = TaskProviderOptions & {
	/**
	 * The unique identifier for this provider instance.
	 * @default "@qified/memory-task"
	 */
	id?: string;
};

export const defaultMemoryTaskId = "@qified/memory";
export const defaultTimeout = 30000; // 30 seconds
export const defaultRetries = 3;

/**
 * Represents a task in the queue with processing state
 */
interface QueuedTask {
	task: Task;
	attempt: number;
	deadlineAt: number;
	processing: boolean;
	timeoutHandle?: NodeJS.Timeout;
}

/**
 * In-memory task provider for testing and simple use cases.
 * Tasks are stored and processed in memory without persistence.
 * Supports task acknowledgment, rejection, retry, and timeout handling.
 */
export class MemoryTaskProvider implements TaskProvider {
	private _id: string;
	private _timeout: number;
	private _retries: number;
	private _taskHandlers: Map<string, TaskHandler[]>;
	private _queues: Map<string, QueuedTask[]>;
	private _processing: Map<string, Set<string>>; // Map of queue -> Set of task IDs being processed
	private _deadLetterQueue: Map<string, Task[]>;
	private _taskIdCounter = 0;
	private _active = true;

	/**
	 * Creates an instance of MemoryTaskProvider.
	 * @param {MemoryTaskProviderOptions} options - Optional configuration for the provider.
	 */
	constructor(options?: MemoryTaskProviderOptions) {
		this._id = options?.id ?? defaultMemoryTaskId;
		this._timeout = options?.timeout ?? defaultTimeout;
		this._retries = options?.retries ?? defaultRetries;
		this._taskHandlers = new Map();
		this._queues = new Map();
		this._processing = new Map();
		this._deadLetterQueue = new Map();
	}

	/**
	 * Gets the provider ID for the memory task provider.
	 * @returns {string} The provider ID.
	 */
	public get id(): string {
		return this._id;
	}

	/**
	 * Sets the provider ID for the memory task provider.
	 * @param {string} id The new provider ID.
	 */
	public set id(id: string) {
		this._id = id;
	}

	/**
	 * Gets the default timeout for task processing.
	 * @returns {number} The timeout in milliseconds.
	 */
	public get timeout(): number {
		return this._timeout;
	}

	/**
	 * Sets the default timeout for task processing.
	 * @param {number} timeout The timeout in milliseconds.
	 */
	public set timeout(timeout: number) {
		this._timeout = timeout;
	}

	/**
	 * Gets the default maximum retry attempts.
	 * @returns {number} The maximum retry attempts.
	 */
	public get retries(): number {
		return this._retries;
	}

	/**
	 * Sets the default maximum retry attempts.
	 * @param {number} retries The maximum retry attempts.
	 */
	public set retries(retries: number) {
		this._retries = retries;
	}

	/**
	 * Gets the task handlers map.
	 * @returns {Map<string, TaskHandler[]>} The task handlers map.
	 */
	public get taskHandlers(): Map<string, TaskHandler[]> {
		return this._taskHandlers;
	}

	/**
	 * Sets the task handlers map.
	 * @param {Map<string, TaskHandler[]>} value The new task handlers map.
	 */
	public set taskHandlers(value: Map<string, TaskHandler[]>) {
		this._taskHandlers = value;
	}

	/**
	 * Generates a unique task ID.
	 * @returns {string} A unique task ID.
	 */
	private generateTaskId(): string {
		return `task-${Date.now()}-${++this._taskIdCounter}`;
	}

	/**
	 * Enqueues a task to a specific queue.
	 * Automatically assigns ID and timestamp to the task.
	 * @param {string} queue - The queue name to enqueue to.
	 * @param {EnqueueTask} taskData - The task data to enqueue.
	 * @returns {Promise<string>} The ID of the enqueued task.
	 */
	public async enqueue(queue: string, taskData: EnqueueTask): Promise<string> {
		if (!this._active) {
			throw new Error("TaskProvider has been disconnected");
		}

		const task: Task = {
			id: this.generateTaskId(),
			timestamp: Date.now(),
			...taskData,
		};

		const queuedTask: QueuedTask = {
			task,
			attempt: 0,
			deadlineAt: 0,
			processing: false,
		};

		if (!this._queues.has(queue)) {
			this._queues.set(queue, []);
		}

		this._queues.get(queue)?.push(queuedTask);

		// Process immediately if handlers are registered
		await this.processQueue(queue);

		return task.id;
	}

	/**
	 * Registers a handler to process tasks from a queue.
	 * Starts processing any pending tasks in the queue.
	 * @param {string} queue - The queue name to dequeue from.
	 * @param {TaskHandler} handler - The handler configuration.
	 * @returns {Promise<void>}
	 */
	public async dequeue(queue: string, handler: TaskHandler): Promise<void> {
		if (!this._active) {
			throw new Error("TaskProvider has been disconnected");
		}

		if (!this._taskHandlers.has(queue)) {
			this._taskHandlers.set(queue, []);
		}

		this._taskHandlers.get(queue)?.push(handler);

		// Start processing the queue
		await this.processQueue(queue);
	}

	/**
	 * Processes tasks in a queue by delivering them to registered handlers.
	 * @param {string} queue - The queue name to process.
	 */
	private async processQueue(queue: string): Promise<void> {
		/* v8 ignore next -- @preserve */
		if (!this._active) {
			return;
		}

		const handlers = this._taskHandlers.get(queue);
		if (!handlers || handlers.length === 0) {
			return;
		}

		const queuedTasks = this._queues.get(queue);
		if (!queuedTasks || queuedTasks.length === 0) {
			return;
		}

		const processingSet = this._processing.get(queue) ?? new Set();
		this._processing.set(queue, processingSet);

		// Find tasks that are ready to process
		for (const queuedTask of queuedTasks) {
			if (queuedTask.processing || processingSet.has(queuedTask.task.id)) {
				continue;
			}

			// Check if task is scheduled for later
			if (
				queuedTask.task.scheduledAt &&
				queuedTask.task.scheduledAt > Date.now()
			) {
				continue;
			}

			// Mark as processing
			queuedTask.processing = true;
			processingSet.add(queuedTask.task.id);

			// Process with each handler (fire and forget to allow concurrent processing)
			for (const handler of handlers) {
				void this.processTask(queue, queuedTask, handler);
			}
		}
	}

	/**
	 * Processes a single task with a handler.
	 * @param {string} queue - The queue name.
	 * @param {QueuedTask} queuedTask - The queued task to process.
	 * @param {TaskHandler} handler - The handler to process the task.
	 */
	private async processTask(
		queue: string,
		queuedTask: QueuedTask,
		handler: TaskHandler,
	): Promise<void> {
		const { task } = queuedTask;
		const maxRetries = task.maxRetries ?? this._retries;
		const timeout = task.timeout ?? this._timeout;

		queuedTask.attempt++;
		queuedTask.deadlineAt = Date.now() + timeout;

		let acknowledged = false;
		let rejected = false;

		// Create task context
		const context: TaskContext = {
			ack: async () => {
				if (acknowledged || rejected) {
					return;
				}
				acknowledged = true;
				await this.removeTask(queue, task.id);
			},
			reject: async (requeue = true) => {
				if (acknowledged || rejected) {
					return;
				}
				rejected = true;

				if (requeue && queuedTask.attempt < maxRetries) {
					// Requeue for retry
					queuedTask.processing = false;
					this._processing.get(queue)?.delete(task.id);
					// Re-process the queue after a short delay
					setTimeout(() => {
						void this.processQueue(queue);
					}, 100);
				} else {
					// Move to dead-letter queue
					await this.moveToDeadLetter(queue, task);
					await this.removeTask(queue, task.id);
				}
			},
			extend: async (ttl: number) => {
				if (acknowledged || rejected) {
					return;
				}
				queuedTask.deadlineAt = Date.now() + ttl;
				if (queuedTask.timeoutHandle) {
					clearTimeout(queuedTask.timeoutHandle);
				}
				// Set a new timeout
				/* v8 ignore next -- @preserve */
				queuedTask.timeoutHandle = setTimeout(() => {
					if (!acknowledged && !rejected) {
						void context.reject(true);
					}
				}, ttl);
			},
			metadata: {
				attempt: queuedTask.attempt,
				maxRetries,
			},
		};

		// Set timeout handler
		queuedTask.timeoutHandle = setTimeout(() => {
			if (!acknowledged && !rejected) {
				void context.reject(true);
			}
		}, timeout);

		try {
			await handler.handler(task, context);

			// Auto-ack if handler completes without explicit ack/reject
			if (!acknowledged && !rejected) {
				await context.ack();
			}
		} catch (_error) {
			// Auto-reject on error
			if (!acknowledged && !rejected) {
				await context.reject(true);
			}
		} finally {
			if (queuedTask.timeoutHandle) {
				clearTimeout(queuedTask.timeoutHandle);
			}
		}
	}

	/**
	 * Removes a task from the queue.
	 * @param {string} queue - The queue name.
	 * @param {string} taskId - The task ID to remove.
	 */
	private async removeTask(queue: string, taskId: string): Promise<void> {
		const queuedTasks = this._queues.get(queue);
		if (queuedTasks) {
			const index = queuedTasks.findIndex((qt) => qt.task.id === taskId);
			if (index !== -1) {
				queuedTasks.splice(index, 1);
			}
		}

		this._processing.get(queue)?.delete(taskId);
	}

	/**
	 * Moves a task to the dead-letter queue.
	 * @param {string} queue - The original queue name.
	 * @param {Task} task - The task to move.
	 */
	private async moveToDeadLetter(queue: string, task: Task): Promise<void> {
		const dlqKey = `${queue}:dead-letter`;
		if (!this._deadLetterQueue.has(dlqKey)) {
			this._deadLetterQueue.set(dlqKey, []);
		}
		this._deadLetterQueue.get(dlqKey)?.push(task);
	}

	/**
	 * Unsubscribes a handler from a queue.
	 * @param {string} queue - The queue name to unsubscribe from.
	 * @param {string} [id] - Optional handler ID. If not provided, removes all handlers.
	 * @returns {Promise<void>}
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
	}

	/**
	 * Disconnects and clears all queues and handlers.
	 * Stops all task processing.
	 * @returns {Promise<void>}
	 */
	public async disconnect(): Promise<void> {
		this._active = false;

		// Clear all timeout handles
		for (const queuedTasks of this._queues.values()) {
			for (const queuedTask of queuedTasks) {
				if (queuedTask.timeoutHandle) {
					clearTimeout(queuedTask.timeoutHandle);
				}
			}
		}

		this._taskHandlers.clear();
		this._queues.clear();
		this._processing.clear();
		this._deadLetterQueue.clear();
	}

	/**
	 * Gets all tasks in the dead-letter queue for a specific queue.
	 * Useful for debugging and monitoring failed tasks.
	 * @param {string} queue - The queue name.
	 * @returns {Task[]} Array of tasks in the dead-letter queue.
	 */
	public getDeadLetterTasks(queue: string): Task[] {
		const dlqKey = `${queue}:dead-letter`;
		return this._deadLetterQueue.get(dlqKey) ?? [];
	}

	/**
	 * Gets the current state of a queue.
	 * Useful for monitoring and debugging.
	 * @param {string} queue - The queue name.
	 * @returns {Object} Queue statistics.
	 */
	public getQueueStats(queue: string): {
		waiting: number;
		processing: number;
		deadLetter: number;
	} {
		const queuedTasks = this._queues.get(queue) ?? [];
		const processing = this._processing.get(queue)?.size ?? 0;
		const waiting = queuedTasks.filter((qt) => !qt.processing).length;
		const dlqKey = `${queue}:dead-letter`;
		const deadLetter = this._deadLetterQueue.get(dlqKey)?.length ?? 0;

		return {
			waiting,
			processing,
			deadLetter,
		};
	}
}
