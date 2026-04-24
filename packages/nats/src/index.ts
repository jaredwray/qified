import { connect, type NatsConnection } from "@nats-io/transport-node";
import {
	type Message,
	type MessageProvider,
	Qified,
	type TopicHandler,
} from "qified";

export {
	defaultNatsTaskId,
	defaultRetries as defaultTaskRetries,
	defaultTimeout as defaultTaskTimeout,
	NatsTaskProvider,
	type NatsTaskProviderOptions,
} from "./task.js";

/**
 * Configuration options for the NATS message provider.
 */
export type NatsMessageProviderOptions = {
	/**
	 * The URI of the NATS server to connect to.
	 * @default "localhost:4222"
	 */
	uri?: string;
	/**
	 * The unique identifier for this provider instance.
	 * @default "@qified/nats"
	 */
	id?: string;
	/**
	 * Wait time in seconds between reconnection attempts after a connection loss.
	 * Set to 0 to disable automatic reconnection entirely.
	 * The underlying NATS client retries indefinitely while reconnect is enabled.
	 * @default 5
	 */
	reconnectTimeInSeconds?: number;
};

export const defaultNatsUri = "localhost:4222";
export const defaultNatsId = "@qified/nats";
export const defaultReconnectTimeInSeconds = 5;

export class NatsMessageProvider implements MessageProvider {
	public subscriptions = new Map<string, TopicHandler[]>();
	private readonly _subscriptions = new Map<
		string,
		ReturnType<NatsConnection["subscribe"]>
	>();
	private _connection: NatsConnection | undefined;
	private _uri: string;
	private _id: string;
	private _reconnectTimeInSeconds: number;
	private _connectionPromise: Promise<void> | null = null;
	private _closing = false;

	constructor(options: NatsMessageProviderOptions = {}) {
		this._uri = options.uri ?? defaultNatsUri;
		this._id = options.id ?? defaultNatsId;
		this._reconnectTimeInSeconds =
			options.reconnectTimeInSeconds ?? defaultReconnectTimeInSeconds;
	}

	/**
	 * Gets the provider ID for the NATS message provider.
	 * @returns {string} The provider ID.
	 */
	public get id(): string {
		return this._id;
	}

	/**
	 * Sets the provider ID for the NATS message provider.
	 * @param {string} id The new provider ID.
	 */
	public set id(id: string) {
		this._id = id;
	}

	/**
	 * Gets or sets the URI for the NATS server.
	 * @returns {string} The URI of the NATS server.
	 */
	public get uri(): string {
		return this._uri;
	}

	/**
	 * Sets the URI for the NATS server and resets the connection.
	 * @param {string} value The new URI for the NATS server.
	 */
	public set uri(value: string) {
		this._uri = value;
		this._connection = undefined;
		// Drop the cached connect promise so the next createConnection() opens
		// a fresh connection against the new URI instead of resolving against
		// the old one.
		this._connectionPromise = null;
	}

	/**
	 * Gets the reconnect time in seconds.
	 * @returns {number} The reconnect time in seconds. 0 means reconnection is disabled.
	 */
	public get reconnectTimeInSeconds(): number {
		return this._reconnectTimeInSeconds;
	}

	/**
	 * Sets the reconnect time in seconds.
	 * @param {number} value The reconnect time in seconds. Set to 0 to disable.
	 */
	public set reconnectTimeInSeconds(value: number) {
		this._reconnectTimeInSeconds = value;
	}

	/**
	 * Creates the NATS client connection. The NATS client handles reconnection
	 * natively — {@link reconnectTimeInSeconds} controls the wait between
	 * attempts (0 disables it). Concurrent callers are gated by
	 * {@link _connectionPromise} so only one underlying connection is opened
	 * per lifecycle, even under high concurrency.
	 * @returns {Promise<void>} A promise that resolves when the connection is made.
	 */
	public async createConnection(): Promise<void> {
		if (this._closing) {
			// Refuse to start a new connection while disconnect() is in progress;
			// otherwise it would resolve after disconnect returns and leak.
			throw new Error("Provider is disconnecting");
		}

		if (!this._connectionPromise) {
			this._connectionPromise = (async () => {
				try {
					this._connection = await connect({
						servers: this._uri,
						reconnect: this._reconnectTimeInSeconds > 0,
						reconnectTimeWait: this._reconnectTimeInSeconds * 1000,
						maxReconnectAttempts: -1,
					});
				} catch (error) {
					this._connectionPromise = null;
					throw error;
				}
			})();
		}

		return this._connectionPromise;
	}

	/**
	 * Publishes a message to a specified topic.
	 * Resolves once the NATS server has received the message (via flush).
	 * @param {string} topic The topic to publish the message to.
	 * @param {Message} message The message to publish.
	 * @returns {Promise<void>} A promise that resolves when the server has received the message.
	 */
	public async publish(
		topic: string,
		message: Omit<Message, "providerId">,
	): Promise<void> {
		await this.createConnection();
		const messageWithProvider: Message = {
			...message,
			providerId: this._id,
		};
		// biome-ignore lint/style/noNonNullAssertion: this is safe as we ensure the connection is created before use
		this._connection!.publish(topic, JSON.stringify(messageWithProvider));
		// biome-ignore lint/style/noNonNullAssertion: connection is still valid after publish
		await this._connection!.flush();
	}

	/**
	 * Subscribes to a specified topic.
	 * @param {string} topic The topic to subscribe to.
	 * @param {TopicHandler} handler The handler to process incoming messages.
	 */
	public async subscribe(topic: string, handler: TopicHandler): Promise<void> {
		await this.createConnection();

		if (!this.subscriptions.has(topic)) {
			this.subscriptions.set(topic, []);

			// biome-ignore lint/style/noNonNullAssertion: this is safe as we ensure the connection is created before use
			const sub = this._connection!.subscribe(topic);

			this._subscriptions.set(topic, sub);

			(async () => {
				for await (const m of sub) {
					const message = JSON.parse(m.string()) as Message;
					const handlers = this.subscriptions.get(topic) ?? [];
					await Promise.all(handlers.map(async (sub) => sub.handler(message)));
				}
			})();
		}

		this.subscriptions.get(topic)?.push(handler);
	}

	/**
	 * Unsubscribes from a specified topic.
	 * @param {string} topic The topic to unsubscribe from.
	 * @param {string} [id] Optional identifier for the subscription to remove.
	 * @returns {Promise<void>} A promise that resolves when the unsubscription is complete.
	 */
	public async unsubscribe(topic: string, id?: string): Promise<void> {
		if (id) {
			const current = this.subscriptions.get(topic);
			if (current) {
				this.subscriptions.set(
					topic,
					current.filter((sub) => sub.id !== id),
				);
			}
		} else {
			this._subscriptions.get(topic)?.unsubscribe();
			this._subscriptions.delete(topic);

			this.subscriptions.delete(topic);
		}
	}

	/**
	 * Disconnects from the NATS server and cancels all subscriptions.
	 * @returns {Promise<void>} A promise that resolves when the disconnection is complete.
	 */
	public async disconnect(): Promise<void> {
		this._closing = true;
		this.subscriptions.clear();

		// If a connection attempt is in flight, wait for it so we can close the
		// connection it opens — otherwise it would complete after disconnect()
		// returns and leak a live connection.
		if (this._connectionPromise) {
			try {
				await this._connectionPromise;
			} catch {
				// Connect rejected — nothing to close.
			}
		}

		await this._connection?.close();
		this._connection = undefined;
		this._connectionPromise = null;
		this._closing = false;
	}
}

/**
 * Creates a new instance of Qified with a Redis message provider.
 * @param {NatsMessageProviderOptions} options Optional configuration for the Redis message provider.
 * @returns A new instance of Qified.
 */
export function createQified(options?: NatsMessageProviderOptions): Qified {
	const provider = new NatsMessageProvider(options);
	return new Qified({ messageProviders: [provider] });
}
