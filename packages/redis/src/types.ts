export type Message<T = any> = {
	id: string;
	data: T;
	timestamp?: number;
	headers?: Record<string, string>;
};

export type TopicHandler = {id?: string; handler: (message: Message) => Promise<void>};

export type MessageProvider = {
	subscriptions: Map<string, TopicHandler[]>;
	publish(topic: string, message: Message): Promise<void>;
	subscribe(topic: string, handler: TopicHandler): Promise<void>;
	unsubscribe(topic: string, id?: string): Promise<void>;
	disconnect(): Promise<void>;
};
