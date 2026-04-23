import { Hookified, type HookifiedOptions } from "hookified";
import type {
	EnqueueTask,
	Message,
	MessageProvider,
	TaskHandler,
	TaskProvider,
	TopicHandler,
} from "./types.js";

/**
 * Standard events emitted by Qified.
 */
export enum QifiedEvents {
	error = "error",
	info = "info",
	warn = "warn",
	publish = "publish",
	subscribe = "subscribe",
	unsubscribeMessage = "unsubscribeMessage",
	enqueue = "enqueue",
	dequeue = "dequeue",
	unsubscribeTask = "unsubscribeTask",
	disconnect = "disconnect",
}

/**
 * Hook event names for before/after lifecycle hooks.
 * Before hooks receive a mutable context object that can be modified.
 * After hooks receive the final context after the operation completes.
 */
export enum QifiedHooks {
	beforeSubscribe = "before:subscribe",
	afterSubscribe = "after:subscribe",
	beforePublish = "before:publish",
	afterPublish = "after:publish",
	beforeUnsubscribeMessage = "before:unsubscribeMessage",
	afterUnsubscribeMessage = "after:unsubscribeMessage",
	beforeEnqueue = "before:enqueue",
	afterEnqueue = "after:enqueue",
	beforeDequeue = "before:dequeue",
	afterDequeue = "after:dequeue",
	beforeUnsubscribeTask = "before:unsubscribeTask",
	afterUnsubscribeTask = "after:unsubscribeTask",
	beforeDisconnect = "before:disconnect",
	afterDisconnect = "after:disconnect",
}

export type QifiedOptions = {
	/**
	 * The message providers to use.
	 */
	messageProviders?: MessageProvider | MessageProvider[];

	/**
	 * The task providers to use.
	 */
	taskProviders?: TaskProvider | TaskProvider[];
} & HookifiedOptions;

export class Qified extends Hookified {
	private _messageProviders: MessageProvider[] = [];
	private _taskProviders: TaskProvider[] = [];
	/**
	 * Creates an instance of Qified.
	 * @param {QifiedOptions} options - Optional configuration for Qified.
	 */
	constructor(options?: QifiedOptions) {
		super(options);
		if (options?.messageProviders) {
			if (Array.isArray(options?.messageProviders)) {
				this._messageProviders = options.messageProviders;
			} else {
				this._messageProviders = [options?.messageProviders];
			}
		}

		if (options?.taskProviders) {
			if (Array.isArray(options?.taskProviders)) {
				this._taskProviders = options.taskProviders;
			} else {
				this._taskProviders = [options?.taskProviders];
			}
		}
	}

	/**
	 * Gets or sets the message providers.
	 * @returns {MessageProvider[]} The array of message providers.
	 */
	public get messageProviders(): MessageProvider[] {
		return this._messageProviders;
	}

	/**
	 * Sets the message providers.
	 * @param {MessageProvider[]} providers - The array of message providers to set.
	 */
	public set messageProviders(providers: MessageProvider[]) {
		this._messageProviders = providers;
	}

	/**
	 * Gets or sets the task providers.
	 * @returns {TaskProvider[]} The array of task providers.
	 */
	public get taskProviders(): TaskProvider[] {
		return this._taskProviders;
	}

	/**
	 * Sets the task providers.
	 * @param {TaskProvider[]} providers - The array of task providers to set.
	 */
	public set taskProviders(providers: TaskProvider[]) {
		this._taskProviders = providers;
	}

	/**
	 * Subscribes to a topic. If you have multiple message providers, it will subscribe to the topic on all of them.
	 * @param {string} topic - The topic to subscribe to.
	 * @param {TopicHandler} handler - The handler to call when a message is published to the topic.
	 */
	public async subscribe(topic: string, handler: TopicHandler): Promise<void> {
		try {
			// Before hook - context can be mutated by hook handlers
			const context = { topic, handler };
			await this.hook(QifiedHooks.beforeSubscribe, context);

			const promises = this._messageProviders.map(async (provider) =>
				provider.subscribe(context.topic, context.handler),
			);
			await Promise.all(promises);

			// After hook
			await this.hook(QifiedHooks.afterSubscribe, {
				topic: context.topic,
				handler: context.handler,
			});

			this.emit(QifiedEvents.subscribe, {
				topic: context.topic,
				handler: context.handler,
			});
		} catch (error) {
			/* v8 ignore next -- @preserve */
			this.emit(QifiedEvents.error, error);
		}
	}

	/**
	 * Publishes a message to a topic. If you have multiple message providers, it will publish the message to all of them.
	 * @param {string} topic - The topic to publish to.
	 * @param {Message} message - The message to publish.
	 */
	public async publish(
		topic: string,
		message: Omit<Message, "providerId">,
	): Promise<void> {
		try {
			// Before hook - context can be mutated by hook handlers
			const context = { topic, message };
			await this.hook(QifiedHooks.beforePublish, context);

			const promises = this._messageProviders.map(async (provider) =>
				provider.publish(context.topic, context.message),
			);
			await Promise.all(promises);

			// After hook
			await this.hook(QifiedHooks.afterPublish, {
				topic: context.topic,
				message: context.message,
			});

			this.emit(QifiedEvents.publish, {
				topic: context.topic,
				message: context.message,
			});
		} catch (error) {
			/* v8 ignore next -- @preserve */
			this.emit(QifiedEvents.error, error);
		}
	}

	/**
	 * Unsubscribes a message handler from a topic. If you have multiple message providers, it will unsubscribe from the topic on all of them.
	 * If an ID is provided, it will unsubscribe only that handler. If no ID is provided, it will unsubscribe all handlers for the topic.
	 * @param topic - The topic to unsubscribe from.
	 * @param id - The optional ID of the handler to unsubscribe. If not provided, all handlers for the topic will be unsubscribed.
	 */
	public async unsubscribeMessage(topic: string, id?: string): Promise<void> {
		try {
			// Before hook - context can be mutated by hook handlers
			const context = { topic, id };
			await this.hook(QifiedHooks.beforeUnsubscribeMessage, context);

			const promises = this._messageProviders.map(async (provider) =>
				provider.unsubscribe(context.topic, context.id),
			);
			await Promise.all(promises);

			// After hook
			await this.hook(QifiedHooks.afterUnsubscribeMessage, {
				topic: context.topic,
				id: context.id,
			});

			this.emit(QifiedEvents.unsubscribeMessage, {
				topic: context.topic,
				id: context.id,
			});
		} catch (error) {
			/* v8 ignore next -- @preserve */
			this.emit(QifiedEvents.error, error);
		}
	}

	/**
	 * Enqueues a task to a queue. If you have multiple task providers, it will enqueue the task on all of them.
	 * @param {string} queue - The queue to enqueue to.
	 * @param {EnqueueTask} task - The task to enqueue.
	 * @returns {Promise<string[]>} The ids assigned to the task by each provider, in provider order.
	 */
	public async enqueue(queue: string, task: EnqueueTask): Promise<string[]> {
		try {
			// Before hook - context can be mutated by hook handlers
			const context = { queue, task };
			await this.hook(QifiedHooks.beforeEnqueue, context);

			const promises = this._taskProviders.map(async (provider) =>
				provider.enqueue(context.queue, context.task),
			);
			const ids = await Promise.all(promises);

			// After hook
			await this.hook(QifiedHooks.afterEnqueue, {
				queue: context.queue,
				task: context.task,
				ids,
			});

			this.emit(QifiedEvents.enqueue, {
				queue: context.queue,
				task: context.task,
				ids,
			});

			return ids;
		} catch (error) {
			/* v8 ignore next -- @preserve */
			this.emit(QifiedEvents.error, error);
			/* v8 ignore next -- @preserve */
			return [];
		}
	}

	/**
	 * Registers a handler to dequeue tasks from a queue. If you have multiple task providers, it will register the handler on all of them.
	 * @param {string} queue - The queue to dequeue from.
	 * @param {TaskHandler} handler - The handler to call when a task is available.
	 */
	public async dequeue(queue: string, handler: TaskHandler): Promise<void> {
		try {
			// Before hook - context can be mutated by hook handlers
			const context = { queue, handler };
			await this.hook(QifiedHooks.beforeDequeue, context);

			const promises = this._taskProviders.map(async (provider) =>
				provider.dequeue(context.queue, context.handler),
			);
			await Promise.all(promises);

			// After hook
			await this.hook(QifiedHooks.afterDequeue, {
				queue: context.queue,
				handler: context.handler,
			});

			this.emit(QifiedEvents.dequeue, {
				queue: context.queue,
				handler: context.handler,
			});
		} catch (error) {
			/* v8 ignore next -- @preserve */
			this.emit(QifiedEvents.error, error);
		}
	}

	/**
	 * Unsubscribes a task handler from a queue. If you have multiple task providers, it will unsubscribe on all of them.
	 * If an ID is provided, it will unsubscribe only that handler. If no ID is provided, it will unsubscribe all handlers for the queue.
	 * @param queue - The queue to unsubscribe from.
	 * @param id - The optional ID of the handler to unsubscribe. If not provided, all handlers for the queue will be unsubscribed.
	 */
	public async unsubscribeTask(queue: string, id?: string): Promise<void> {
		try {
			// Before hook - context can be mutated by hook handlers
			const context = { queue, id };
			await this.hook(QifiedHooks.beforeUnsubscribeTask, context);

			const promises = this._taskProviders.map(async (provider) =>
				provider.unsubscribe(context.queue, context.id),
			);
			await Promise.all(promises);

			// After hook
			await this.hook(QifiedHooks.afterUnsubscribeTask, {
				queue: context.queue,
				id: context.id,
			});

			this.emit(QifiedEvents.unsubscribeTask, {
				queue: context.queue,
				id: context.id,
			});
		} catch (error) {
			/* v8 ignore next -- @preserve */
			this.emit(QifiedEvents.error, error);
		}
	}

	/**
	 * Disconnects from all providers.
	 * This method will call the `disconnect` method on each message provider.
	 */
	public async disconnect(): Promise<void> {
		try {
			// Before hook - context provides provider count info
			const context = { providerCount: this._messageProviders.length };
			await this.hook(QifiedHooks.beforeDisconnect, context);

			const promises = this._messageProviders.map(async (provider) =>
				provider.disconnect(),
			);
			await Promise.all(promises);
			this._messageProviders = [];

			// After hook
			await this.hook(QifiedHooks.afterDisconnect, {
				providerCount: context.providerCount,
			});

			this.emit(QifiedEvents.disconnect);
		} catch (error) {
			/* v8 ignore next -- @preserve */
			this.emit(QifiedEvents.error, error);
		}
	}
}

export { MemoryMessageProvider } from "./memory/message.js";
export { MemoryTaskProvider } from "./memory/task.js";
export type {
	EnqueueTask,
	Message,
	MessageProvider,
	Task,
	TaskContext,
	TaskHandler,
	TaskProvider,
	TaskProviderOptions,
	TopicHandler,
} from "./types.js";
