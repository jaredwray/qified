export interface Message {
	id: string; // Unique identifier for the message
	data: any;  // The payload of the message
	timestamp?: number; // Optional timestamp of when the message was created
	headers?: Record<string, string>; // Optional headers for additional metadata
}

export interface MessageProvider {
	// Initialize the provider
	initialize(config: Record<string, any>): Promise<void>;

	// List of message subscribers
	subscribers: Array<{ topic: string; handler: (message: Message) => Promise<void> }>;

	// Publish a message to a given topic or queue
	publish(topic: string, message: Message): Promise<void>;

	// Subscribe to a topic or queue and handle incoming messages
	subscribe(topic: string, handler: (message: Message) => Promise<void>): Promise<void>;

	// Gracefully shutdown the provider
	disconnect(): Promise<void>;
}