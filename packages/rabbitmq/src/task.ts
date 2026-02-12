import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import {
	type Channel,
	type ChannelModel,
	type ConsumeMessage,
	connect,
} from "amqplib";
import { Hookified } from "hookified";
import type {
	EnqueueTask,
	Task,
	TaskContext,
	TaskHandler,
	TaskProvider,
	TaskProviderOptions,
} from "qified";

/**
 * Configuration options for the RabbitMQ task provider.
 */
export type RabbitMqTaskProviderOptions = TaskProviderOptions & {
	/** RabbitMQ connection URI. Defaults to "amqp://localhost:5672" */
	uri?: string;
	/** Unique identifier for this provider instance. Defaults to "@qified/rabbitmq-task" */
	id?: string;
	/** Poll interval in milliseconds for checking scheduled tasks. Defaults to 1000 */
	pollInterval?: number;
	/** Time in seconds to wait before reconnecting. Set to 0 to disable. Defaults to 5 */
	reconnectTimeInSeconds?: number;
};

/** Default RabbitMQ connection URI */
export const defaultRabbitMqTaskUri = "amqp://localhost:5672";

/** Default RabbitMQ task provider identifier */
export const defaultRabbitMqTaskId = "@qified/rabbitmq-task";

/** Default timeout for task processing (30 seconds) */
export const defaultTimeout = 30_000;

/** Default maximum retry attempts */
export const defaultRetries = 3;

/** Default poll interval (1 second) */
export const defaultPollInterval = 1000;

/** Default reconnect time in seconds */
export const defaultReconnectTimeInSeconds = 5;

/**
 * RabbitMQ-based task provider for Qified.
 * Uses RabbitMQ queues for reliable task queue processing
 * with visibility timeout, retries, and dead-letter queues.
 * Extends Hookified to emit events for errors and other lifecycle events.
 */
export class RabbitMqTaskProvider extends Hookified implements TaskProvider {
	private _id: string;
	private _timeout: number;
	private _retries: number;
	private _taskHandlers: Map<string, TaskHandler[]>;

	private _connection: ChannelModel | undefined;
	private _channel: Channel | undefined;
	private _uri: string;
	private _reconnectTimeInSeconds: number;
	private _reconnecting = false;
	private _closing = false;
	private _reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	private _connectionPromise: Promise<void> | null = null;

	private _active = true;
	private _pollInterval: number;
	private readonly _pollTimers: Map<string, ReturnType<typeof setTimeout>> =
		new Map();
	private readonly _consumerTags: Map<string, string> = new Map();

	// In-memory tracking for attempt counts: taskId -> count
	private readonly _attemptCounts: Map<string, number> = new Map();

	// Scheduled tasks: queue -> ScheduledEntry[]
	private readonly _scheduledTasks: Map<
		string,
		Array<{ task: Task; scheduledAt: number }>
	> = new Map();

	// Dead letter tasks for stats: queue -> Task[]
	private readonly _deadLetterTasks: Map<string, Task[]> = new Map();

	// Track queue -> set of taskIds for cleanup
	private readonly _queueTaskIds: Map<string, Set<string>> = new Map();

	/**
	 * Creates a new RabbitMQ task provider instance.
	 * @param options Configuration options for the provider
	 */
	constructor(options: RabbitMqTaskProviderOptions = {}) {
		super();
		this._uri = options.uri ?? defaultRabbitMqTaskUri;
		this._id = options.id ?? defaultRabbitMqTaskId;
		this._timeout = options.timeout ?? defaultTimeout;
		this._retries = options.retries ?? defaultRetries;
		this._pollInterval = options.pollInterval ?? defaultPollInterval;
		this._reconnectTimeInSeconds =
			options.reconnectTimeInSeconds ?? defaultReconnectTimeInSeconds;
		this._taskHandlers = new Map();
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
	 * Connects to RabbitMQ. Can be called explicitly or will be called automatically on first use.
	 */
	async connect(): Promise<void> {
		if (!this._connectionPromise) {
			this._connectionPromise = (async () => {
				const connection = await connect(this._uri);
				this._connection = connection;
				this._channel = await connection.createChannel();

				connection.on("error", () => {
					// Connection error emitted — connection is already closing/closed.
					// The 'close' handler will trigger reconnection.
				});

				connection.on("close", () => {
					this._channel = undefined;
					this._connection = undefined;
					if (!this._closing) {
						this._scheduleReconnect();
					}
				});
			})();
		}

		return this._connectionPromise;
	}

	/**
	 * Returns the connected channel, connecting if necessary.
	 */
	private async getChannel(): Promise<Channel> {
		if (!this._connection || !this._channel) {
			await this.connect();
		}

		// biome-ignore lint/style/noNonNullAssertion: channel is set by connect
		return this._channel!;
	}

	/**
	 * Schedules a reconnection attempt after the configured delay.
	 */
	private _scheduleReconnect(): void {
		if (
			this._reconnectTimeInSeconds <= 0 ||
			this._reconnecting ||
			this._closing
		) {
			return;
		}

		this._reconnectTimer = setTimeout(async () => {
			this._reconnectTimer = undefined;
			await this._attemptReconnect();
		}, this._reconnectTimeInSeconds * 1000);
	}

	/**
	 * Attempts to reconnect to RabbitMQ and re-establish all consumers.
	 */
	private async _attemptReconnect(): Promise<void> {
		if (this._reconnecting || this._closing) {
			return;
		}

		this._reconnecting = true;
		let failed = false;
		try {
			// Reset connection promise so connect() creates a new one
			this._connectionPromise = null;
			await this.connect();

			// biome-ignore lint/style/noNonNullAssertion: channel is set by connect
			const channel = this._channel!;

			// Re-establish consumers for all queues with handlers
			const queues = [...this._taskHandlers.keys()];
			for (const queue of queues) {
				this._consumerTags.delete(queue);
				await this._setupConsumer(channel, queue);
			}
		} catch {
			this._channel = undefined;
			this._connection = undefined;
			this._connectionPromise = null;
			failed = true;
		} finally {
			this._reconnecting = false;
		}

		if (failed) {
			this._scheduleReconnect();
		}
	}

	/**
	 * Generates a globally unique task ID.
	 */
	private generateTaskId(): string {
		return `task-${randomUUID()}`;
	}

	/**
	 * Publishes a task to a RabbitMQ queue.
	 */
	private async publishTask(queue: string, task: Task): Promise<void> {
		const channel = await this.getChannel();
		await channel.assertQueue(queue, { durable: true });

		// Track task in memory
		if (!this._queueTaskIds.has(queue)) {
			this._queueTaskIds.set(queue, new Set());
		}

		this._queueTaskIds.get(queue)?.add(task.id);

		channel.sendToQueue(queue, Buffer.from(JSON.stringify(task)), {
			persistent: true,
		});
	}

	/**
	 * Moves a task to the dead-letter queue.
	 */
	private async moveToDeadLetter(queue: string, task: Task): Promise<void> {
		const channel = await this.getChannel();
		const dlqName = `${queue}:dead-letter`;
		await channel.assertQueue(dlqName, { durable: true });
		channel.sendToQueue(dlqName, Buffer.from(JSON.stringify(task)), {
			persistent: true,
		});

		if (!this._deadLetterTasks.has(queue)) {
			this._deadLetterTasks.set(queue, []);
		}

		this._deadLetterTasks.get(queue)?.push(task);

		// Clean up in-memory tracking
		this._attemptCounts.delete(task.id);
		this._queueTaskIds.get(queue)?.delete(task.id);
	}

	/**
	 * Cleans up in-memory tracking for a task after acknowledgment.
	 */
	private cleanupTask(queue: string, taskId: string): void {
		this._attemptCounts.delete(taskId);
		this._queueTaskIds.get(queue)?.delete(taskId);
	}

	/**
	 * Sets up a RabbitMQ consumer for a task queue.
	 */
	private async _setupConsumer(channel: Channel, queue: string): Promise<void> {
		await channel.assertQueue(queue, { durable: true });
		await channel.assertQueue(`${queue}:dead-letter`, { durable: true });
		await channel.prefetch(1);

		const { consumerTag } = await channel.consume(
			queue,
			async (message_) => {
				if (!message_) {
					return;
				}

				/* v8 ignore next 4 -- @preserve */
				if (!this._active) {
					channel.nack(message_, false, true);
					return;
				}

				const task = JSON.parse(message_.content.toString()) as Task;
				const handlers = this._taskHandlers.get(queue);
				/* v8 ignore next 4 -- @preserve */
				if (!handlers || handlers.length === 0) {
					channel.nack(message_, false, true);
					return;
				}

				for (const handler of handlers) {
					await this.processTask(queue, task, message_, handler);
				}
			},
			{ noAck: false },
		);

		this._consumerTags.set(queue, consumerTag);
	}

	/**
	 * Processes a single task with a handler.
	 */
	private async processTask(
		queue: string,
		task: Task,
		amqpMessage: ConsumeMessage,
		handler: TaskHandler,
	): Promise<void> {
		const maxRetries = task.maxRetries ?? this._retries;
		const timeout = task.timeout ?? this._timeout;

		// Increment attempt count
		const currentAttempt = (this._attemptCounts.get(task.id) ?? 0) + 1;
		this._attemptCounts.set(task.id, currentAttempt);

		let acknowledged = false;
		let rejected = false;
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

		const channel = await this.getChannel();

		const context: TaskContext = {
			ack: async () => {
				if (acknowledged || rejected || !this._active) {
					return;
				}

				acknowledged = true;
				try {
					channel.ack(amqpMessage);
					this.cleanupTask(queue, task.id);
				} catch (error) {
					/* v8 ignore next -- @preserve */
					this.emit("error", error);
				}
			},
			reject: async (requeue = true) => {
				if (acknowledged || rejected || !this._active) {
					return;
				}

				rejected = true;
				try {
					channel.nack(amqpMessage, false, false);

					if (requeue && currentAttempt < maxRetries) {
						await this.publishTask(queue, task);
					} else {
						await this.moveToDeadLetter(queue, task);
					}
				} catch (error) {
					/* v8 ignore next -- @preserve */
					this.emit("error", error);
				}
			},
			extend: async (ttl: number) => {
				if (acknowledged || rejected || !this._active) {
					return;
				}

				try {
					if (timeoutHandle) {
						clearTimeout(timeoutHandle);
					}

					timeoutHandle = setTimeout(() => {
						if (!acknowledged && !rejected && this._active) {
							void context.reject(true);
						}
					}, ttl);
				} catch (error) {
					/* v8 ignore next -- @preserve */
					this.emit("error", error);
				}
			},
			metadata: {
				attempt: currentAttempt,
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
	 * Checks for scheduled tasks that are ready to execute.
	 */
	private async checkScheduledTasks(queue: string): Promise<void> {
		/* v8 ignore next -- @preserve */
		if (!this._active) {
			return;
		}

		const scheduled = this._scheduledTasks.get(queue);
		if (!scheduled || scheduled.length === 0) {
			return;
		}

		const now = Date.now();
		const ready: Array<{ task: Task; scheduledAt: number }> = [];
		const remaining: Array<{ task: Task; scheduledAt: number }> = [];

		for (const entry of scheduled) {
			/* v8 ignore next -- @preserve */
			if (!this._active) {
				return;
			}

			if (entry.scheduledAt <= now) {
				ready.push(entry);
			} else {
				remaining.push(entry);
			}
		}

		this._scheduledTasks.set(queue, remaining);

		for (const entry of ready) {
			/* v8 ignore next -- @preserve */
			if (!this._active) {
				return;
			}

			await this.publishTask(queue, entry.task);
		}
	}

	/**
	 * Starts the polling loop for a queue.
	 */
	private startPolling(queue: string): void {
		const poll = async () => {
			/* v8 ignore next -- @preserve */
			if (!this._active) {
				return;
			}

			try {
				await this.checkScheduledTasks(queue);
			} catch (error) {
				/* v8 ignore next -- @preserve */
				this.emit("error", error);
			}

			if (this._active && this._taskHandlers.has(queue)) {
				this._pollTimers.set(queue, setTimeout(poll, this._pollInterval));
			}
		};

		this._pollTimers.set(queue, setTimeout(poll, this._pollInterval));
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

		const task: Task = {
			id: this.generateTaskId(),
			timestamp: Date.now(),
			...taskData,
		};

		// If scheduled for the future, hold in memory
		if (task.scheduledAt && task.scheduledAt > Date.now()) {
			if (!this._scheduledTasks.has(queue)) {
				this._scheduledTasks.set(queue, []);
			}

			this._scheduledTasks.get(queue)?.push({
				task,
				scheduledAt: task.scheduledAt,
			});
			return task.id;
		}

		// Publish to RabbitMQ queue immediately
		await this.publishTask(queue, task);
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

		// Set up consumer if not already
		if (!this._consumerTags.has(queue)) {
			const channel = await this.getChannel();
			await this._setupConsumer(channel, queue);
		}

		// Start polling for scheduled tasks if not already
		if (!this._pollTimers.has(queue)) {
			this.startPolling(queue);
		}
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

		// Stop polling and cancel consumer if no handlers left for this queue
		if (
			!this._taskHandlers.has(queue) ||
			this._taskHandlers.get(queue)?.length === 0
		) {
			const consumerTag = this._consumerTags.get(queue);
			if (consumerTag && this._channel) {
				try {
					await this._channel.cancel(consumerTag);
				} catch {
					/* ignore if channel closed */
				}

				this._consumerTags.delete(queue);
			}

			const timer = this._pollTimers.get(queue);
			if (timer) {
				clearTimeout(timer);
				this._pollTimers.delete(queue);
			}
		}
	}

	/**
	 * Disconnects and cleans up the provider.
	 * @param force If true, skips graceful close. Defaults to false.
	 */
	public async disconnect(force = false): Promise<void> {
		this._active = false;
		this._closing = true;

		// Clear reconnect timer
		if (this._reconnectTimer) {
			clearTimeout(this._reconnectTimer);
			this._reconnectTimer = undefined;
		}

		// Clear all poll timers
		for (const timer of this._pollTimers.values()) {
			clearTimeout(timer);
		}

		this._pollTimers.clear();

		// Clear handlers and in-memory state
		this._taskHandlers.clear();
		this._scheduledTasks.clear();
		this._attemptCounts.clear();
		this._queueTaskIds.clear();

		// Cancel consumers and close channel/connection
		if (this._channel) {
			if (!force) {
				for (const tag of this._consumerTags.values()) {
					try {
						await this._channel.cancel(tag);
					} catch {
						/* ignore */
					}
				}
			}

			this._consumerTags.clear();

			if (!force) {
				try {
					await this._channel.close();
				} catch {
					/* ignore */
				}
			}

			this._channel = undefined;
		}

		if (this._connection) {
			if (!force) {
				try {
					await this._connection.close();
				} catch {
					/* ignore */
				}
			}

			this._connection = undefined;
		}

		this._connectionPromise = null;
		this._closing = false;
	}

	/**
	 * Gets all tasks in the dead-letter queue for a specific queue.
	 * @param queue The queue name
	 * @returns Array of tasks in the dead-letter queue
	 */
	public async getDeadLetterTasks(queue: string): Promise<Task[]> {
		return this._deadLetterTasks.get(queue) ?? [];
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
		let waiting = 0;
		try {
			const channel = await this.getChannel();
			const queueInfo = await channel.checkQueue(queue);
			waiting = queueInfo.messageCount;
		} catch {
			// Queue may not exist yet
		}

		const deadLetter = this._deadLetterTasks.get(queue)?.length ?? 0;
		const scheduled = this._scheduledTasks.get(queue)?.length ?? 0;

		return {
			waiting,
			processing: 0,
			deadLetter,
			scheduled,
		};
	}

	/**
	 * Clears all data for a queue. Useful for testing.
	 * @param queue The queue name to clear
	 */
	public async clearQueue(queue: string): Promise<void> {
		const channel = await this.getChannel();
		try {
			await channel.purgeQueue(queue);
		} catch {
			/* queue may not exist */
		}

		try {
			await channel.purgeQueue(`${queue}:dead-letter`);
		} catch {
			/* queue may not exist */
		}

		this._deadLetterTasks.delete(queue);
		this._scheduledTasks.delete(queue);

		// Clear task data for this queue
		const taskIds = this._queueTaskIds.get(queue);
		if (taskIds) {
			for (const taskId of taskIds) {
				this._attemptCounts.delete(taskId);
			}

			this._queueTaskIds.delete(queue);
		}
	}
}
