import {
	type Message,
	type MessageProvider,
	Qified,
	type TopicHandler,
} from "qified";
import { createClient, type RedisClientType } from "redis";

/**
 * Configuration options for the Redis message provider.
 */
export type RedisMessageProviderOptions = {
	/** Redis connection URI. Defaults to "redis://localhost:6379" */
	uri?: string;
	/** Unique identifier for this provider instance. Defaults to "@qified/reddis" */
	id?: string;
};

/** Default Redis connection URI */
export const defaultRedisUri = "redis://localhost:6379";

/** Default Redis provider identifier */
export const defaultRedisId = "@qified/reddis";

/**
 * Redis-based message provider for Qified.
 * Uses Redis pub/sub to enable message distribution across multiple instances.
 */
export class RedisMessageProvider implements MessageProvider {
	/** Map of topic names to their registered handlers */
	public subscriptions = new Map<string, TopicHandler[]>();

	/** Redis client used for publishing messages */
	private readonly pub: RedisClientType;

	/** Redis client used for subscribing to messages */
	private readonly sub: RedisClientType;

	private _id: string;

	/**
	 * Creates a new Redis message provider instance.
	 * @param options Configuration options for the provider
	 */
	constructor(options: RedisMessageProviderOptions = {}) {
		const uri = options.uri ?? defaultRedisUri;
		this._id = options.id ?? defaultRedisId;
		this.pub = createClient({ url: uri });
		this.sub = this.pub.duplicate();
		void this.pub.connect();
		void this.sub.connect();
	}

	/**
	 * Gets the unique identifier for this provider instance.
	 */
	public get id(): string {
		return this._id;
	}

	/**
	 * Sets the unique identifier for this provider instance.
	 */
	public set id(id: string) {
		this._id = id;
	}

	/**
	 * Publishes a message to a specific topic.
	 * @param topic The topic to publish to
	 * @param message The message to publish
	 */
	async publish(topic: string, message: Message): Promise<void> {
		await this.pub.publish(topic, JSON.stringify(message));
	}

	/**
	 * Subscribes to a topic with a handler function.
	 * @param topic The topic to subscribe to
	 * @param handler The handler function to call when messages are received
	 */
	async subscribe(topic: string, handler: TopicHandler): Promise<void> {
		if (!this.subscriptions.has(topic)) {
			this.subscriptions.set(topic, []);
			await this.sub.subscribe(topic, async (raw) => {
				const message = JSON.parse(raw) as Message;
				const handlers = this.subscriptions.get(topic) ?? [];
				await Promise.all(handlers.map(async (sub) => sub.handler(message)));
			});
		}

		this.subscriptions.get(topic)?.push(handler);
	}

	/**
	 * Unsubscribes from a topic, either for a specific handler or all handlers.
	 * @param topic The topic to unsubscribe from
	 * @param id Optional handler ID. If provided, only that handler is removed. Otherwise, all handlers are removed.
	 */
	async unsubscribe(topic: string, id?: string): Promise<void> {
		if (id) {
			const current = this.subscriptions.get(topic);
			if (current) {
				this.subscriptions.set(
					topic,
					current.filter((sub) => sub.id !== id),
				);
			}
		} else {
			this.subscriptions.delete(topic);
			await this.sub.unsubscribe(topic);
		}
	}

	/**
	 * Disconnects from Redis, unsubscribing from all topics and closing connections.
	 */
	async disconnect(): Promise<void> {
		const topics = [...this.subscriptions.keys()];
		if (topics.length > 0) {
			await this.sub.unsubscribe(topics);
		}

		this.subscriptions.clear();
		await this.pub.quit();
		await this.sub.quit();
	}
}

/**
 * Creates a new instance of Qified with a Redis message provider.
 * @param {RedisMessageProviderOptions} options Optional configuration for the Redis message provider.
 * @returns A new instance of Qified.
 */
export function createQified(options?: RedisMessageProviderOptions): Qified {
	const provider = new RedisMessageProvider(options);
	return new Qified({ messageProviders: [provider] });
}
