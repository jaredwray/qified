import { randomUUID } from "node:crypto";
import { AckPolicy, jetstream, jetstreamManager } from "@nats-io/jetstream";
import { connect } from "@nats-io/transport-node";
import { Hookified } from "hookified";
import type { NatsConnection } from "nats";
import type {
	EnqueueTask,
	Task,
	TaskContext,
	TaskHandler,
	TaskProvider,
	TaskProviderOptions,
} from "qified";

/**
 * Configuration options for the NATS task provider.
 */
export type NatsTaskProviderOptions = TaskProviderOptions & {
	/** NATS server URI. Defaults to "localhost:4222" */
	uri?: string;
	/** Unique identifier for this provider instance. Defaults to "@qified/nats-task" */
	id?: string;
};

/** Default NATS server URI */
export const defaultNatsTaskUri = "localhost:4222";

/** Default NATS task provider identifier */
export const defaultNatsTaskId = "@qified/nats-task";

/** Default timeout for task processing (30 seconds) */
export const defaultTimeout = 30_000;

/** Default maximum retry attempts */
export const defaultRetries = 3;

/**
 * Converts a queue name to a valid JetStream stream name.
 * JetStream stream names must be alphanumeric, dash, or underscore.
 * Uses hex-encoding for special characters to prevent collisions
 * (e.g. "orders.us" and "orders_us" produce different stream names).
 */
function toStreamName(queue: string): string {
	const encoded = queue.replace(/[^a-zA-Z0-9_-]/g, (c) => {
		const hex = c.charCodeAt(0).toString(16).padStart(2, "0");
		return `x${hex}`;
	});
	return `TASKS_${encoded}`;
}

/**
 * Converts a queue name to a valid JetStream durable consumer name.
 * Uses the same hex-encoding as stream names to avoid invalid characters.
 */
function toConsumerName(queue: string): string {
	const encoded = queue.replace(/[^a-zA-Z0-9_-]/g, (c) => {
		const hex = c.charCodeAt(0).toString(16).padStart(2, "0");
		return `x${hex}`;
	});
	return `${encoded}-worker`;
}

/**
 * NATS JetStream-based task provider for Qified.
 * Uses JetStream streams and consumers for reliable task queue processing
 * with acknowledgment, retries, and dead-letter queues.
 * Leverages JetStream's native delivery tracking for attempt counting,
 * making retry semantics correct across multiple provider instances.
 * Extends Hookified to emit events for errors and other lifecycle events.
 */
export class NatsTaskProvider extends Hookified implements TaskProvider {
	private _id: string;
	private _timeout: number;
	private _retries: number;
	private _taskHandlers: Map<string, TaskHandler[]>;

	private _connection: NatsConnection | undefined;
	private _uri: string;
	private _connectionPromise: Promise<void> | null = null;

	private _active = true;
	private _closing = false;

	// Track currently processing tasks: queue -> set of taskIds
	private readonly _processingTasks: Map<string, Set<string>> = new Map();

	// Track active consume iterators for cleanup
	private readonly _consumeAbortControllers: Map<string, AbortController> =
		new Map();

	// Track streams that have been initialized
	private readonly _initializedStreams: Set<string> = new Set();

	/**
	 * Creates a new NATS task provider instance.
	 * @param options Configuration options for the provider
	 */
	constructor(options: NatsTaskProviderOptions = {}) {
		super();
		this._uri = options.uri ?? defaultNatsTaskUri;
		this._id = options.id ?? defaultNatsTaskId;
		this._timeout = options.timeout ?? defaultTimeout;
		this._retries = options.retries ?? defaultRetries;
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
	 * Connects to NATS. Can be called explicitly or will be called automatically on first use.
	 */
	async connect(): Promise<void> {
		if (!this._connectionPromise) {
			this._connectionPromise = (async () => {
				try {
					this._connection = (await connect({
						servers: this._uri,
					})) as unknown as NatsConnection;
				} catch (error) {
					this._connectionPromise = null;
					throw error;
				}
			})();
		}

		return this._connectionPromise;
	}

	/**
	 * Returns the NATS connection, connecting if necessary.
	 */
	private async getConnection(): Promise<NatsConnection> {
		if (!this._connection) {
			await this.connect();
		}

		// biome-ignore lint/style/noNonNullAssertion: connection is set by connect
		return this._connection!;
	}

	/**
	 * Ensures a JetStream stream and its dead-letter counterpart exist for the given queue.
	 */
	private async ensureStream(queue: string): Promise<void> {
		const streamName = toStreamName(queue);
		if (this._initializedStreams.has(streamName)) {
			return;
		}

		const nc = await this.getConnection();
		const jsm = await jetstreamManager(nc);

		// Main task stream
		const subject = `tasks.${queue}`;
		try {
			await jsm.streams.info(streamName);
		} catch {
			await jsm.streams.add({
				name: streamName,
				subjects: [subject],
				retention: "workqueue" as never,
			});
		}

		// Dead-letter stream
		const dlqStreamName = `${streamName}_DLQ`;
		const dlqSubject = `tasks.${queue}.dlq`;
		try {
			await jsm.streams.info(dlqStreamName);
		} catch {
			await jsm.streams.add({
				name: dlqStreamName,
				subjects: [dlqSubject],
			});
		}

		this._initializedStreams.add(streamName);
	}

	/**
	 * Ensures a durable consumer exists for the given queue.
	 */
	private async ensureConsumer(queue: string): Promise<void> {
		const nc = await this.getConnection();
		const jsm = await jetstreamManager(nc);
		const streamName = toStreamName(queue);
		const consumerName = toConsumerName(queue);

		try {
			await jsm.consumers.info(streamName, consumerName);
		} catch {
			await jsm.consumers.add(streamName, {
				durable_name: consumerName,
				ack_policy: AckPolicy.Explicit,
				filter_subject: `tasks.${queue}`,
				max_ack_pending: 1,
				ack_wait: this._timeout * 1_000_000, // nanoseconds
			});
		}
	}

	/**
	 * Generates a globally unique task ID.
	 */
	private generateTaskId(): string {
		return `task-${randomUUID()}`;
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

		await this.ensureStream(queue);

		const nc = await this.getConnection();
		const js = jetstream(nc);
		const subject = `tasks.${queue}`;

		await js.publish(subject, JSON.stringify(task));

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
		if (!this._consumeAbortControllers.has(queue)) {
			await this.ensureStream(queue);
			await this.ensureConsumer(queue);
			await this._startConsuming(queue);
		}
	}

	/**
	 * Starts consuming messages from a JetStream consumer for the given queue.
	 */
	private async _startConsuming(queue: string): Promise<void> {
		const nc = await this.getConnection();
		const js = jetstream(nc);
		const streamName = toStreamName(queue);
		const consumerName = toConsumerName(queue);

		const consumer = await js.consumers.get(streamName, consumerName);

		const abortController = new AbortController();
		this._consumeAbortControllers.set(queue, abortController);

		const messages = await consumer.consume();

		(async () => {
			for await (const msg of messages) {
				/* v8 ignore next 4 -- @preserve */
				if (!this._active || abortController.signal.aborted) {
					msg.nak();
					break;
				}

				let task: Task;
				try {
					task = JSON.parse(msg.string()) as Task;
					/* v8 ignore start -- @preserve */
				} catch {
					msg.term();
					continue;
				}
				/* v8 ignore stop */

				const handlers = this._taskHandlers.get(queue);

				/* v8 ignore next 4 -- @preserve */
				if (!handlers || handlers.length === 0) {
					msg.nak();
					continue;
				}

				// Track as processing
				if (!this._processingTasks.has(queue)) {
					this._processingTasks.set(queue, new Set());
				}

				this._processingTasks.get(queue)?.add(task.id);

				// Use JetStream's native delivery count for attempt tracking.
				// This works correctly across multiple provider instances.
				// deliveryCount starts at 1 for the first delivery.
				const currentAttempt = msg.info.deliveryCount;

				// Shared state to prevent double ack/nak
				let jsHandled = false;
				const ackJs = () => {
					if (!jsHandled) {
						jsHandled = true;
						msg.ack();
					}
				};

				const nakJs = (millis?: number) => {
					if (!jsHandled) {
						jsHandled = true;
						msg.nak(millis);
					}
				};

				const termJs = () => {
					if (!jsHandled) {
						jsHandled = true;
						msg.term();
					}
				};

				for (const handler of handlers) {
					await this.processTask(
						queue,
						task,
						handler,
						currentAttempt,
						ackJs,
						nakJs,
						termJs,
						msg,
					);
				}

				// Remove from processing
				this._processingTasks.get(queue)?.delete(task.id);
			}
			/* v8 ignore start -- @preserve */
		})().catch((error) => {
			if (this._active && !this._closing) {
				this.emit("error", error);
			}
		});
		/* v8 ignore stop */
	}

	/**
	 * Processes a single task with a handler.
	 */
	private async processTask(
		queue: string,
		task: Task,
		handler: TaskHandler,
		currentAttempt: number,
		ackJs: () => void,
		nakJs: (millis?: number) => void,
		termJs: () => void,
		msg: { working: () => void },
	): Promise<void> {
		const maxRetries = task.maxRetries ?? this._retries;
		const timeout = task.timeout ?? this._timeout;

		let acknowledged = false;
		let rejected = false;
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

		const context: TaskContext = {
			ack: async () => {
				if (acknowledged || rejected || !this._active) {
					return;
				}

				acknowledged = true;
				try {
					ackJs();
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
					if (requeue && currentAttempt < maxRetries) {
						// Nak with short delay for prompt redelivery by JetStream
						nakJs(100);
					} else {
						// Move to dead-letter queue and terminate the message
						await this.moveToDeadLetter(queue, task);
						termJs();
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
					// Notify JetStream server that we're still working
					msg.working();

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
	 * Moves a task to the dead-letter queue.
	 */
	private async moveToDeadLetter(queue: string, task: Task): Promise<void> {
		const nc = await this.getConnection();
		const js = jetstream(nc);
		const dlqSubject = `tasks.${queue}.dlq`;

		await js.publish(dlqSubject, JSON.stringify(task));
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

		// Stop consuming if no handlers left for this queue
		if (
			!this._taskHandlers.has(queue) ||
			this._taskHandlers.get(queue)?.length === 0
		) {
			const abortController = this._consumeAbortControllers.get(queue);
			if (abortController) {
				abortController.abort();
				this._consumeAbortControllers.delete(queue);
			}
		}
	}

	/**
	 * Disconnects and cleans up the provider.
	 */
	public async disconnect(): Promise<void> {
		this._active = false;
		this._closing = true;

		// Abort all consumers
		for (const ac of this._consumeAbortControllers.values()) {
			ac.abort();
		}

		this._consumeAbortControllers.clear();

		// Clear handlers and in-memory state
		this._taskHandlers.clear();
		this._processingTasks.clear();
		this._initializedStreams.clear();

		// Close NATS connection
		if (this._connection) {
			await this._connection.close();
			this._connection = undefined;
		}

		this._connectionPromise = null;
		this._closing = false;
	}

	/**
	 * Gets all tasks in the dead-letter queue for a specific queue.
	 * Uses a transient pull consumer to efficiently read messages without
	 * iterating over potentially large sequence ranges.
	 * @param queue The queue name
	 * @returns Array of tasks in the dead-letter queue
	 */
	public async getDeadLetterTasks(queue: string): Promise<Task[]> {
		const nc = await this.getConnection();
		const jsm = await jetstreamManager(nc);
		const dlqStreamName = `${toStreamName(queue)}_DLQ`;

		let info: Awaited<ReturnType<typeof jsm.streams.info>>;
		try {
			info = await jsm.streams.info(dlqStreamName);
		} catch {
			return [];
		}

		const messageCount = info.state.messages;
		if (messageCount === 0) {
			return [];
		}

		// Use a transient consumer to fetch DLQ messages efficiently
		const js = jetstream(nc);
		const consumer = await js.consumers.get(dlqStreamName);
		const tasks: Task[] = [];

		try {
			const batch = await consumer.fetch({
				max_messages: messageCount,
				expires: 5000,
			});
			for await (const msg of batch) {
				try {
					const task = JSON.parse(msg.string()) as Task;
					tasks.push(task);
				} catch {
					// Skip malformed messages
				}

				// Nak so messages stay in the DLQ for future inspection
				msg.nak();
			}
		} catch {
			// Consumer or fetch failed
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
	}> {
		const nc = await this.getConnection();
		const jsm = await jetstreamManager(nc);

		let waiting = 0;
		try {
			const streamName = toStreamName(queue);
			const info = await jsm.streams.info(streamName);
			waiting = info.state.messages;
		} catch {
			// Stream doesn't exist
		}

		let deadLetter = 0;
		try {
			const dlqStreamName = `${toStreamName(queue)}_DLQ`;
			const dlqInfo = await jsm.streams.info(dlqStreamName);
			deadLetter = dlqInfo.state.messages;
		} catch {
			// DLQ stream doesn't exist
		}

		const processing = this._processingTasks.get(queue)?.size ?? 0;

		return {
			waiting,
			processing,
			deadLetter,
		};
	}

	/**
	 * Clears all data for a queue. Useful for testing.
	 * @param queue The queue name to clear
	 */
	public async clearQueue(queue: string): Promise<void> {
		const nc = await this.getConnection();
		const jsm = await jetstreamManager(nc);
		const streamName = toStreamName(queue);
		const dlqStreamName = `${streamName}_DLQ`;

		// Purge main stream
		try {
			await jsm.streams.purge(streamName);
		} catch {
			// Stream doesn't exist
		}

		// Purge DLQ stream
		try {
			await jsm.streams.purge(dlqStreamName);
		} catch {
			// DLQ stream doesn't exist
		}

		this._processingTasks.delete(queue);
	}
}
