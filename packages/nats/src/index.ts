import { connect } from "@nats-io/transport-node";
import type { NatsConnection, Subscription } from "nats";
import {
	type Message,
	type MessageProvider,
	Qified,
	type TopicHandler,
} from "qified";

export type NatsMessageProviderOptions = {
	uri?: string;
};

export const defaultNatsUri = "localhost:4222";

export class NatsMessageProvider implements MessageProvider {
	public subscriptions = new Map<string, TopicHandler[]>();
	private readonly _subscriptions = new Map<string, Subscription>();
	private _connection: NatsConnection | undefined;
	private _uri: string;

	constructor(options: NatsMessageProviderOptions = {}) {
		this._uri = options.uri ?? defaultNatsUri;
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
	}

	/**
	 * Creates the NATS client connection.
	 * @returns {Promise<void>} A promise that resolves when the connection is made.
	 */
	public async createConnection(): Promise<void> {
		this._connection ??= await connect({ servers: this._uri });
	}

	/**
	 * Publishes a message to a specified topic.
	 * @param {string} topic The topic to publish the message to.
	 * @param {Message} message The message to publish.
	 * @returns {Promise<void>} A promise that resolves when the message is published.
	 */
	public async publish(topic: string, message: Message): Promise<void> {
		await this.createConnection();
		// biome-ignore lint/style/noNonNullAssertion: this is safe as we ensure the connection is created before use
		this._connection!.publish(topic, JSON.stringify(message));
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
		this.subscriptions.clear();

		await this._connection?.close();
		this._connection = undefined;
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
