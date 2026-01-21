import {
	type Message,
	type MessageProvider,
	Qified,
	type TopicHandler,
} from "qified";
import { createClient, type RedisClientType } from "redis";

export {
	defaultPollInterval,
	defaultRedisTaskId,
	defaultRetries as defaultTaskRetries,
	defaultTimeout as defaultTaskTimeout,
	RedisTaskProvider,
	type RedisTaskProviderOptions,
} from "./task.js";

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

	/** Connection promise to ensure connect is only called once */
	private connectionPromise: Promise<void> | null = null;

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
	}

	/**
	 * Connects to Redis. Can be called explicitly or will be called automatically on first use.
	 * @throws Error if connection fails
	 */
	async connect(): Promise<void> {
		if (!this.connectionPromise) {
			this.connectionPromise = (async () => {
				await this.pub.connect();
				await this.sub.connect();
			})();
		}
		return this.connectionPromise;
	}

	/**
	 * Returns the connected publish client, connecting if necessary.
	 * @private
	 */
	private async getPubClient(): Promise<RedisClientType> {
		await this.connect();
		return this.pub;
	}

	/**
	 * Returns the connected subscribe client, connecting if necessary.
	 * @private
	 */
	private async getSubClient(): Promise<RedisClientType> {
		await this.connect();
		return this.sub;
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
	async publish(
		topic: string,
		message: Omit<Message, "providerId">,
	): Promise<void> {
		const messageWithProvider: Message = {
			...message,
			providerId: this._id,
		};
		const pubClient = await this.getPubClient();
		await pubClient.publish(topic, JSON.stringify(messageWithProvider));
	}

	/**
	 * Subscribes to a topic with a handler function.
	 * @param topic The topic to subscribe to
	 * @param handler The handler function to call when messages are received
	 */
	async subscribe(topic: string, handler: TopicHandler): Promise<void> {
		if (!this.subscriptions.has(topic)) {
			this.subscriptions.set(topic, []);
			const subClient = await this.getSubClient();
			await subClient.subscribe(topic, async (raw) => {
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
			const subClient = await this.getSubClient();
			await subClient.unsubscribe(topic);
		}
	}

	/**
	 * Disconnects from Redis, unsubscribing from all topics and closing connections.
	 * @param force If true, forcefully terminates the connection without sending a quit command. Defaults to false.
	 */
	async disconnect(force = false): Promise<void> {
		// Only disconnect if we've connected
		if (this.connectionPromise) {
			await this.connectionPromise;

			const topics = [...this.subscriptions.keys()];
			if (topics.length > 0) {
				await this.sub.unsubscribe(topics);
			}

			this.subscriptions.clear();

			if (force) {
				if (this.pub.isOpen) {
					this.pub.destroy();
				}

				if (this.sub.isOpen) {
					this.sub.destroy();
				}
			} else {
				if (this.pub.isOpen) {
					await this.pub.close();
				}

				if (this.sub.isOpen) {
					await this.sub.close();
				}
			}

			this.connectionPromise = null;
		}
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
