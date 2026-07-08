import { randomUUID } from "node:crypto";
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
	/** Poll interval in milliseconds for checking timed-out tasks. Defaults to 1000 */
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
 * Atomically claims the next ready task. Pops the tail of the ready list and, if
 * the task data still exists, records it in the processing set with a
 * server-derived deadline, increments the attempt counter, and bumps the
 * per-task fence token. Orphaned ids (task data already deleted) have their
 * counters cleaned up and are skipped.
 *
 * KEYS[1] ready list, KEYS[2] processing zset.
 * ARGV[1] per-task key prefix (`<queue>:task:`), ARGV[2] default timeout (ms).
 * Returns nil when nothing claimable, else [taskId, taskJson, attempt, fence].
 *
 * The per-task keys are built from ARGV[1] because the id is unknown until RPOP;
 * this is safe on standalone/Sentinel Redis/Valkey but not on Cluster.
 */
const CLAIM_SCRIPT = `
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
for _ = 1, 100 do
	local id = redis.call('RPOP', KEYS[1])
	if not id then
		return nil
	end
	local data = redis.call('GET', ARGV[1] .. id)
	if data then
		local timeout = tonumber(ARGV[2])
		local ok, task = pcall(cjson.decode, data)
		if ok and type(task) == 'table' and type(task.timeout) == 'number' then
			timeout = task.timeout
		end
		redis.call('ZADD', KEYS[2], now + timeout, id)
		local attempt = redis.call('INCR', ARGV[1] .. id .. ':attempt')
		local fence = redis.call('INCR', ARGV[1] .. id .. ':fence')
		return { id, data, attempt, tostring(fence) }
	end
	redis.call('DEL', ARGV[1] .. id .. ':attempt', ARGV[1] .. id .. ':fence')
end
return nil
`;

/**
 * Acknowledges (completes) a task, but only if this delivery still owns it.
 *
 * KEYS[1] processing zset, KEYS[2] task data, KEYS[3] attempt, KEYS[4] fence.
 * ARGV[1] fence token, ARGV[2] taskId. Returns 1 if removed, 0 if stale.
 */
const ACK_SCRIPT = `
if redis.call('GET', KEYS[4]) ~= ARGV[1] then
	return 0
end
redis.call('ZREM', KEYS[1], ARGV[2])
redis.call('DEL', KEYS[2], KEYS[3], KEYS[4])
return 1
`;

/**
 * Rejects a task, requeueing it for retry or moving it to the dead-letter queue,
 * but only if this delivery still owns it. The fence token is consumed either
 * way so no other holder of the token can act on the task afterwards.
 *
 * KEYS[1] processing, KEYS[2] ready, KEYS[3] dead-letter, KEYS[4] attempt,
 * KEYS[5] fence. ARGV[1] token, ARGV[2] taskId, ARGV[3] "1"|"0" requeue flag,
 * ARGV[4] maxRetries. Returns 1 if applied, 0 if stale.
 */
const REJECT_SCRIPT = `
if redis.call('GET', KEYS[5]) ~= ARGV[1] then
	return 0
end
redis.call('ZREM', KEYS[1], ARGV[2])
local attempt = tonumber(redis.call('GET', KEYS[4]) or '0')
if ARGV[3] == '1' and attempt < tonumber(ARGV[4]) then
	redis.call('INCR', KEYS[5])
	redis.call('LPUSH', KEYS[2], ARGV[2])
else
	redis.call('DEL', KEYS[5])
	redis.call('LPUSH', KEYS[3], ARGV[2])
end
return 1
`;

/**
 * Extends a task's visibility deadline, but only if this delivery still owns it.
 * Uses XX (not GT) so extend() may legally shorten the deadline.
 *
 * KEYS[1] processing zset, KEYS[2] fence.
 * ARGV[1] token, ARGV[2] taskId, ARGV[3] ttl (ms). Returns 1 if updated, 0 stale.
 */
const EXTEND_SCRIPT = `
if redis.call('GET', KEYS[2]) ~= ARGV[1] then
	return 0
end
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
redis.call('ZADD', KEYS[1], 'XX', now + tonumber(ARGV[3]), ARGV[2])
return 1
`;

/**
 * Recovers a timed-out task: re-checks expiry against the server clock, and if
 * still expired removes it from processing, invalidates the stale owner's fence
 * token, and requeues it (retries remaining) or dead-letters it. Mutates nothing
 * when the task is no longer expired (a fresh delivery re-claimed it) or gone.
 *
 * KEYS[1] processing, KEYS[2] ready, KEYS[3] dead-letter, KEYS[4] attempt,
 * KEYS[5] fence. ARGV[1] taskId, ARGV[2] maxRetries. Returns 1 if recovered.
 */
const RECOVER_SCRIPT = `
local score = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not score then
	return 0
end
local t = redis.call('TIME')
local now = t[1] * 1000 + math.floor(t[2] / 1000)
if tonumber(score) >= now then
	return 0
end
redis.call('ZREM', KEYS[1], ARGV[1])
local attempt = tonumber(redis.call('GET', KEYS[4]) or '0')
if attempt < tonumber(ARGV[2]) then
	redis.call('INCR', KEYS[5])
	redis.call('LPUSH', KEYS[2], ARGV[1])
else
	redis.call('DEL', KEYS[5])
	redis.call('LPUSH', KEYS[3], ARGV[1])
end
return 1
`;

/**
 * Redis-based task provider for Qified.
 * Uses Redis lists and sorted sets to enable reliable task queue processing
 * across multiple instances with visibility timeout, retries, and dead-letter queues.
 * Extends Hookified to emit events for errors and other lifecycle events.
 *
 * Distributed semantics:
 * - Delivery is at-least-once: a handler that finishes right at its visibility
 *   deadline can race recovery and run more than once, so handlers must be
 *   idempotent.
 * - Claim, acknowledge, reject, extend, and timeout-recovery run as atomic Lua
 *   scripts. Each delivery carries a monotonic per-task fence token; an operation
 *   from a delivery that has lost ownership (its token no longer matches) is a
 *   no-op, so a stale worker cannot corrupt a newer delivery.
 * - When several handlers are registered on one queue they share a single
 *   delivery and token; the first acknowledgement or rejection decides the
 *   outcome ("first finalizer wins").
 * - Standalone/Sentinel only: the claim script builds per-task keys from a prefix
 *   and the key schema is not Redis Cluster compatible.
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
				try {
					await this._client.connect();
				} catch (error) {
					this._connectionPromise = null;
					throw error;
				}
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
	 * Generates a globally unique task ID using UUID.
	 * This ensures uniqueness across multiple RedisTaskProvider instances.
	 */
	private generateTaskId(): string {
		return `task-${randomUUID()}`;
	}

	/**
	 * Gets the Redis key for the task queue list.
	 */
	private getQueueKey(queue: string): string {
		return `${queue}:tasks`;
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
	 * Gets the Redis key for the task fence token, used to detect stale
	 * operations from a delivery that has lost ownership of the task.
	 */
	private getTaskFenceKey(queue: string, taskId: string): string {
		return `${queue}:task:${taskId}:fence`;
	}

	/**
	 * Gets the shared per-task key prefix (`<queue>:task:`) that the claim script
	 * uses to build per-task keys from the popped task id.
	 */
	private getTaskKeyPrefix(queue: string): string {
		return `${queue}:task:`;
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

		// Add to queue list (LPUSH for FIFO with RPOP)
		await client.lPush(this.getQueueKey(queue), task.id);

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
			/* v8 ignore next -- @preserve */
			if (!this._active) {
				return;
			}

			try {
				await this.checkTimedOutTasks(queue);
				await this.processQueue(queue);
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
	 * Checks for tasks that have timed out during processing.
	 */
	private async checkTimedOutTasks(queue: string): Promise<void> {
		/* v8 ignore next -- @preserve */
		if (!this._active) {
			return;
		}

		const client = await this.getClient();
		const now = Date.now();

		// Advisory scan for tasks whose deadline has passed. RECOVER re-checks
		// expiry against the server clock before acting, so a fast/slow local
		// clock only affects recovery latency, never correctness.
		const timedOutTasks = await client.zRangeByScore(
			this.getProcessingKey(queue),
			0,
			now - 1,
		);

		for (const taskId of timedOutTasks) {
			/* v8 ignore next -- @preserve */
			if (!this._active) {
				return;
			}

			// Get task data to check maxRetries.
			const taskDataStr = await client.get(this.getTaskDataKey(queue, taskId));
			if (!taskDataStr) {
				// Task data missing; drop the orphaned processing entry and counters.
				await client.zRem(this.getProcessingKey(queue), taskId);
				await client.del(this.getTaskAttemptKey(queue, taskId));
				await client.del(this.getTaskFenceKey(queue, taskId));
				continue;
			}

			const task = JSON.parse(taskDataStr) as Task;
			const maxRetries = task.maxRetries ?? this._retries;

			// Atomically recover the task: re-verify expiry, invalidate the stale
			// owner's fence token, and requeue or dead-letter it.
			await client.eval(RECOVER_SCRIPT, {
				keys: [
					this.getProcessingKey(queue),
					this.getQueueKey(queue),
					this.getDeadLetterKey(queue),
					this.getTaskAttemptKey(queue, taskId),
					this.getTaskFenceKey(queue, taskId),
				],
				arguments: [taskId, String(maxRetries)],
			});
		}
	}

	/**
	 * Processes tasks in a queue by delivering them to registered handlers.
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

		const client = await this.getClient();

		// Check again after async operation
		if (!this._active) {
			return;
		}

		// Atomically claim the next task (RPOP ready + ZADD processing + bump
		// attempt and fence) so a crash can never leave it in neither structure.
		let reply: [string, string, number, string] | null;
		try {
			reply = (await client.eval(CLAIM_SCRIPT, {
				keys: [this.getQueueKey(queue), this.getProcessingKey(queue)],
				arguments: [this.getTaskKeyPrefix(queue), String(this._timeout)],
			})) as unknown as [string, string, number, string] | null;
		} catch (error) {
			/* v8 ignore start -- @preserve */
			this.emit("error", error);
			return;
			/* v8 ignore stop */
		}

		if (!reply) {
			return;
		}

		const [, taskDataStr, attempt, token] = reply;
		const task = JSON.parse(taskDataStr) as Task;

		// Process with each handler. They share one delivery and fence token;
		// the first ack/reject wins.
		for (const handler of handlers) {
			void this.processTask(queue, task, handler, attempt, token);
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
		attempt: number,
		token: string,
	): Promise<void> {
		const client = await this.getClient();
		const maxRetries = task.maxRetries ?? this._retries;
		const timeout = task.timeout ?? this._timeout;

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
					await this.removeTask(queue, task.id, token);
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
					// Remove from processing and requeue or dead-letter, but only
					// if this delivery still owns the task (fence token matches).
					await client.eval(REJECT_SCRIPT, {
						keys: [
							this.getProcessingKey(queue),
							this.getQueueKey(queue),
							this.getDeadLetterKey(queue),
							this.getTaskAttemptKey(queue, task.id),
							this.getTaskFenceKey(queue, task.id),
						],
						arguments: [
							token,
							task.id,
							requeue ? "1" : "0",
							String(maxRetries),
						],
					});
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
					// Extend the deadline only if this delivery still owns the task.
					await client.eval(EXTEND_SCRIPT, {
						keys: [
							this.getProcessingKey(queue),
							this.getTaskFenceKey(queue, task.id),
						],
						arguments: [token, task.id, String(ttl)],
					});
					// Reset timeout handle
					/* v8 ignore start -- @preserve */
					if (timeoutHandle) {
						clearTimeout(timeoutHandle);
					}
					timeoutHandle = setTimeout(async () => {
						if (!acknowledged && !rejected && this._active) {
							try {
								await context.reject(true);
							} catch (error) {
								/* v8 ignore next -- @preserve */
								this.emit("error", error);
							}
						}
					}, ttl);
					timeoutHandle.unref();
				} catch (error) {
					this.emit("error", error);
				}
			},
			metadata: {
				attempt,
				maxRetries,
			},
		};
		/* v8 ignore stop */

		// Set timeout handler
		timeoutHandle = setTimeout(async () => {
			if (!acknowledged && !rejected && this._active) {
				try {
					await context.reject(true);
				} catch (error) {
					/* v8 ignore next -- @preserve */
					this.emit("error", error);
				}
			}
		}, timeout);
		// Do not let a pending task timeout keep the process alive on its own.
		timeoutHandle.unref();

		try {
			await handler.handler(task, context);

			// Auto-ack if handler completes without explicit ack/reject
			if (!acknowledged && !rejected) {
				await context.ack();
			}
		} catch {
			// Auto-reject on error
			/* v8 ignore start -- @preserve */
			if (!acknowledged && !rejected) {
				await context.reject(true);
			}
		} finally {
			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
			}
			/* v8 ignore stop */
		}
	}

	/**
	 * Removes a task completely (on successful ack), if this delivery still owns
	 * it. A stale acknowledgement whose fence token no longer matches is a no-op.
	 */
	private async removeTask(
		queue: string,
		taskId: string,
		token: string,
	): Promise<void> {
		const client = await this.getClient();

		await client.eval(ACK_SCRIPT, {
			keys: [
				this.getProcessingKey(queue),
				this.getTaskDataKey(queue, taskId),
				this.getTaskAttemptKey(queue, taskId),
				this.getTaskFenceKey(queue, taskId),
			],
			arguments: [token, taskId],
		});
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
			/* v8 ignore next -- @preserve */
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
	}> {
		const client = await this.getClient();

		const [waiting, processing, deadLetter] = await Promise.all([
			client.lLen(this.getQueueKey(queue)),
			client.zCard(this.getProcessingKey(queue)),
			client.lLen(this.getDeadLetterKey(queue)),
		]);

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
		const client = await this.getClient();

		// Get all task IDs from all locations
		const [queueTasks, processingTasks, deadLetterTasks] = await Promise.all([
			client.lRange(this.getQueueKey(queue), 0, -1),
			client.zRange(this.getProcessingKey(queue), 0, -1),
			client.lRange(this.getDeadLetterKey(queue), 0, -1),
		]);

		const allTaskIds = [...queueTasks, ...processingTasks, ...deadLetterTasks];

		// Delete all task data, attempt, and fence keys
		for (const taskId of allTaskIds) {
			await client.del(this.getTaskDataKey(queue, taskId));
			await client.del(this.getTaskAttemptKey(queue, taskId));
			await client.del(this.getTaskFenceKey(queue, taskId));
		}

		// Clear all queue structures
		await client.del(this.getQueueKey(queue));
		await client.del(this.getProcessingKey(queue));
		await client.del(this.getDeadLetterKey(queue));
	}
}
