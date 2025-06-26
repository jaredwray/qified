
/**
 * Message interface for the message provider
 * @template T - The type of the message data
 */
export type Message<T = any> = {
	/**
	 * Unique identifier for the message
	 * @type {string}
	 */
	id: string;
	/**
	 * The channel that the message belongs to. This is used to route the message to the correct
	 * handler and is the same as the topic or queue in a pub/sub system.
	 * @type {string}
	 */
	channel: string;
	/**
	 * The data of the message
	 * @type {<T = any>}
	 */
	data: T;
	/**
	 * Timestamp of when the message was created
	 * @type {number}
	 */
	timestamp?: number;
	/**
	 * Headers for additional metadata
	 * @type {Record<string, string>}
	 */
	headers?: Record<string, string>;
};

export type TopicHandler = {id?: string; handler: (message: Message) => Promise<void>};

/**
 * MessageProvider interface for the message provider
 */
export type MessageProvider = {
	/**
	 * Array of handlers for message processing
	 * @type {Map<string, Array<TopicHandler>>}
	 */
	subscriptions: Map<string, TopicHandler[]>;

	/**
	 * Plublish a message to a topic / queue. This is used to send messages to subscribers.
	 * @param topic - The topic or queue to publish the message to
	 * @param message - The message to be published
	 * @returns {Promise<void>}
	 */
	publish(topic: string, message: Message): Promise<void>;

	/**
	 * Subscribe to a topic / queue. This is used to receive messages from the provider.
	 * @param {TopicHandler} subscription - The topic or queue to subscribe to
	 * @returns {Promise<void>}
	 */
	subscribe(topic: string, handler: TopicHandler): Promise<void>;

	/**
	 * Remove subscription to a topic / queue.
	 * @param topic - The topic or queue to unsubscribe from
	 * @param id - Optional unique identifier for the subscription to remove. If not provided, it will remove all subscriptions for the topic.
	 * @returns {Promise<void>}
	 */
	unsubscribe(topic: string, id?: string): Promise<void>;

	/**
	 * Unsubscribe from a topic / queue. This is used to stop receiving messages from the provider.
	 * @returns {Promise<void>}
	 */
	disconnect(): Promise<void>;
};

/**
 * Task interface for the task provider
 * @template T - The type of the task data
 */
export type Task<T = any> = {
	/**
	 * Unique identifier for the task
	 * @type {string}
	 */
	id: string;
	/**
	 * The data of the task
	 * @type {<T = any>}
	 */
	data: T;
	/**
	 * Timestamp of when the task was created
	 * @type {number}
	 */
	channel: string;
	/**
	 * Timestamp of when the task was created
	 * @type {number}
	 */
	priority?: number;
	/**
	 * Timestamp of when the task was created
	 * @type {number}
	 */
	retries?: number;
};

/**
 * TaskProvider interface for the task provider
 */
export type TaskProvider = {
	/**
	 * Array of handlers for task processing
	 * @type {Array<{taskName: string; handler: (payload: Task) => Promise<void>}>}
	 */
	taskHandlers: Array<{taskName: string; handler: (payload: Task) => Promise<void>}>;

	/**
	 * Array of handlers for task processing
	 * @param config - Configuration object for the provider
	 * @returns {Promise<void>}
	 */
	init(config: Record<string, any>): Promise<void>;

	/**
	 * Publish a task to a queue. This is used to send tasks to subscribers.
	 * @param taskName - The name of the task to publish
	 * @param payload - The task to be published
	 * @returns {Promise<void>}
	 */
	enqueue(taskName: string, payload: Task): Promise<void>;

	/**
	 * Subscribe to a task. This is used to receive tasks from the provider.
	 * @param taskName - The name of the task to subscribe to
	 * @param handler - The handler function to process the task
	 * @returns {Promise<void>}
	 */
	dequeue(taskName: string, handler: (payload: Task) => Promise<void>): Promise<void>;

	/**
	 * Disconnect and clean up the provider. This is used to stop receiving tasks from the provider.
	 * @returns {Promise<void>}
	 */
	disconnect(): Promise<void>;
};
