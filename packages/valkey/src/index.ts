import { Redis } from "iovalkey";
import {
	type Message,
	type MessageProvider,
	Qified,
	type TopicHandler,
} from "qified";

export {
	defaultPollInterval,
	defaultRetries as defaultTaskRetries,
	defaultTimeout as defaultTaskTimeout,
	defaultValkeyTaskId,
	ValkeyTaskProvider,
	type ValkeyTaskProviderOptions,
} from "./task.js";

/**
 * Configuration options for the Valkey message provider.
 */
export type ValkeyMessageProviderOptions = {
	/** Valkey connection URI. Defaults to "redis://localhost:6380" */
	uri?: string;
	/** Unique identifier for this provider instance. Defaults to "@qified/valkey" */
	id?: string;
};

/** Default Valkey connection URI */
export const defaultValkeyUri = "redis://localhost:6380";

/** Default Valkey provider identifier */
export const defaultValkeyId = "@qified/valkey";

/**
 * Valkey-based message provider for Qified.
 * Uses Valkey pub/sub to enable message distribution across multiple instances.
 */
export class ValkeyMessageProvider implements MessageProvider {
	/** Map of topic names to their registered handlers */
	public subscriptions = new Map<string, TopicHandler[]>();

	/** Valkey client used for publishing messages */
	private readonly pub: Redis;

	/** Valkey client used for subscribing to messages */
	private readonly sub: Redis;

	/** Connection promise to ensure connect is only called once */
	private connectionPromise: Promise<void> | null = null;

	private _id: string;

	/**
	 * Creates a new Valkey message provider instance.
	 * @param options Configuration options for the provider
	 */
	constructor(options: ValkeyMessageProviderOptions = {}) {
		const uri = options.uri ?? defaultValkeyUri;
		this._id = options.id ?? defaultValkeyId;
		this.pub = new Redis(uri, { lazyConnect: true });
		this.sub = this.pub.duplicate();
		// The subscriber connection delivers every channel's messages through a
		// single "message" event, so wire the listener once and route by channel.
		this.sub.on("message", (channel: string, raw: string) => {
			try {
				const message = JSON.parse(raw) as Message;
				/* v8 ignore next -- @preserve */
				const handlers = this.subscriptions.get(channel) ?? [];
				void Promise.all(
					handlers.map(async (sub) => sub.handler(message)),
				).catch(() => {
					// Ignore handler failures to prevent unhandled rejections.
				});
			} catch {
				// Ignore malformed messages to prevent process crashes.
			}
		});
	}

	/**
	 * Connects to Valkey. Can be called explicitly or will be called automatically on first use.
	 * @throws Error if connection fails
	 */
	async connect(): Promise<void> {
		if (!this.connectionPromise) {
			this.connectionPromise = (async () => {
				try {
					await this.pub.connect();
					await this.sub.connect();
				} catch (error) {
					this.connectionPromise = null;
					// Stop the default reconnect loop so a failed connection does not
					// leave background retry timers running.
					this.pub.disconnect();
					this.sub.disconnect();
					throw error;
				}
			})();
		}
		return this.connectionPromise;
	}

	/**
	 * Returns the connected publish client, connecting if necessary.
	 * @private
	 */
	private async getPubClient(): Promise<Redis> {
		await this.connect();
		return this.pub;
	}

	/**
	 * Returns the connected subscribe client, connecting if necessary.
	 * @private
	 */
	private async getSubClient(): Promise<Redis> {
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
			try {
				const subClient = await this.getSubClient();
				await subClient.subscribe(topic);
			} catch (error) {
				// Roll back the topic entry so a later retry re-subscribes
				// instead of only appending a handler locally.
				this.subscriptions.delete(topic);
				throw error;
			}
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
			/* v8 ignore next -- @preserve */
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
	 * Disconnects from Valkey, unsubscribing from all topics and closing connections.
	 * @param force If true, forcefully terminates the connection without sending a quit command. Defaults to false.
	 */
	async disconnect(force = false): Promise<void> {
		// Only disconnect if we've connected
		/* v8 ignore next -- @preserve */
		if (this.connectionPromise) {
			await this.connectionPromise;

			const topics = [...this.subscriptions.keys()];
			if (topics.length > 0) {
				await this.sub.unsubscribe(...topics);
			}

			this.subscriptions.clear();

			/* v8 ignore start -- @preserve */
			if (force) {
				if (this.pub.status !== "end") {
					this.pub.disconnect();
				}

				if (this.sub.status !== "end") {
					this.sub.disconnect();
				}
			} else {
				if (this.pub.status === "ready") {
					await this.pub.quit();
				}

				if (this.sub.status === "ready") {
					await this.sub.quit();
				}
			}
			/* v8 ignore stop */

			this.connectionPromise = null;
		}
	}
}

/**
 * Creates a new instance of Qified with a Valkey message provider.
 * @param {ValkeyMessageProviderOptions} options Optional configuration for the Valkey message provider.
 * @returns A new instance of Qified.
 */
export function createQified(options?: ValkeyMessageProviderOptions): Qified {
	const provider = new ValkeyMessageProvider(options);
	return new Qified({ messageProviders: [provider] });
}
