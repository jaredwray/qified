export type Message = {
	id: string; // Unique identifier for the message
	data: any; // The payload of the message
	timestamp?: number; // Optional timestamp of when the message was created
	headers?: Record<string, string>; // Optional headers for additional metadata
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
	data: any; // The data required to process the task
	priority?: number; // Optional priority level of the task
	retries?: number; // Optional number of retries for the task
};

export type TaskProvider = {
	/**
	 * Array of handlers for task processing
	 */
	taskHandlers: Array<{taskName: string; handler: (payload: Task) => Promise<void>}>;

	// Initialize the provider
	initialize(config: Record<string, any>): Promise<void>;

	// Enqueue a task to be processed
	enqueueTask(taskName: string, payload: Task): Promise<void>;

	addTaskHandler(taskName: string, handler: (payload: Task) => Promise<void>): Promise<void>;

	// Gracefully shutdown the provider
	disconnect(): Promise<void>;
};
