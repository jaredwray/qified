
/**
 * Message type / interface
 */
export type Message <T = any> = {
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

export type MessageProvider = {
	// List of message subscribers
	subscribers: Array<{topic: string; handler: (message: Message) => Promise<void>}>;

	// Initialize the provider
	init(config: Record<string, any>): Promise<void>;

	// Publish a message to a given topic or queue
	publish(topic: string, message: Message): Promise<void>;

	// Subscribe to a topic or queue and handle incoming messages
	subscribe(topic: string, handler: (message: Message) => Promise<void>): Promise<void>;

	// Gracefully shutdown the provider
	disconnect(): Promise<void>;
};

export type Task = {
	id: string; // Unique identifier for the task
	data: any; // The data required to process the task
	channel: string; // The channel that the task belongs to
	priority?: number; // Optional priority level of the task
	retries?: number; // Optional number of retries for the task
};

export type TaskProvider = {
	/**
	 * Array of handlers for task processing
	 */
	taskHandlers: Array<{taskName: string; handler: (payload: Task) => Promise<void>}>;

	// Initialize the provider
	init(config: Record<string, any>): Promise<void>;

	// Enqueue a task to be processed
	enqueueTask(taskName: string, payload: Task): Promise<void>;

	registerTaskHandler(taskName: string, handler: (payload: Task) => Promise<void>): Promise<void>;

	// Gracefully shutdown the provider
	disconnect(): Promise<void>;
};
