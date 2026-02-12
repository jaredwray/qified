import { Buffer } from "node:buffer";
import { type Channel, type ChannelModel, connect } from "amqplib";
import {
	type Message,
	type MessageProvider,
	Qified,
	type TopicHandler,
} from "qified";

export {
	defaultRabbitMqTaskId,
	defaultRetries as defaultTaskRetries,
	defaultTimeout as defaultTaskTimeout,
	RabbitMqTaskProvider,
	type RabbitMqTaskProviderOptions,
} from "./task.js";

/**
 * Configuration options for the RabbitMQ message provider.
 */
export type RabbitMqMessageProviderOptions = {
	/**
	 * The URI of the RabbitMQ server to connect to.
	 * @default "amqp://localhost:5672"
	 */
	uri?: string;
	/**
	 * The unique identifier for this provider instance.
	 * @default "@qified/rabbitmq"
	 */
	id?: string;
	/**
	 * Time in seconds to wait before attempting to reconnect after a connection loss.
	 * Set to 0 to disable automatic reconnection.
	 * @default 5
	 */
	reconnectTimeInSeconds?: number;
};

export const defaultRabbitMqUri = "amqp://localhost:5672";
export const defaultRabbitMqId = "@qified/rabbitmq";
export const defaultReconnectTimeInSeconds = 5;

/**
 * RabbitMQ message provider for qified.
 * Provides pub/sub messaging using RabbitMQ as the message broker.
 * Includes automatic connection recovery — on connection loss, the provider
 * will reconnect and re-establish all active subscriptions.
 */
export class RabbitMqMessageProvider implements MessageProvider {
	public subscriptions = new Map<string, TopicHandler[]>();
	private _connection: ChannelModel | undefined;
	private _channel: Channel | undefined;
	private readonly _consumerTags = new Map<string, string>();
	private _uri: string;
	private _id: string;
	private _reconnectTimeInSeconds: number;
	private _reconnecting = false;
	private _closing = false;
	private _reconnectTimer: ReturnType<typeof setTimeout> | undefined;

	/**
	 * Creates an instance of RabbitMqMessageProvider.
	 * @param {RabbitMqMessageProviderOptions} options - Optional configuration for the provider.
	 */
	constructor(options: RabbitMqMessageProviderOptions = {}) {
		this._uri = options.uri ?? defaultRabbitMqUri;
		this._id = options.id ?? defaultRabbitMqId;
		this._reconnectTimeInSeconds =
			options.reconnectTimeInSeconds ?? defaultReconnectTimeInSeconds;
	}

	/**
	 * Gets the provider ID for the RabbitMQ message provider.
	 * @returns {string} The provider ID.
	 */
	public get id(): string {
		return this._id;
	}

	/**
	 * Sets the provider ID for the RabbitMQ message provider.
	 * @param {string} id The new provider ID.
	 */
	public set id(id: string) {
		this._id = id;
	}

	/**
	 * Gets or sets the URI for the RabbitMQ server.
	 * @returns {string} The URI of the RabbitMQ server.
	 */
	public get uri(): string {
		return this._uri;
	}

	/**
	 * Sets the URI for the RabbitMQ server and resets the connection and channel.
	 * @param {string} value The new URI for the RabbitMQ server.
	 */
	public set uri(value: string) {
		this._uri = value;
		this._connection = undefined;
		this._channel = undefined;
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
	 * Gets the consumer tags for the RabbitMQ subscriptions.
	 * @returns {Map<string, string>} A map of topic names to consumer tags.
	 */
	public get consumerTags(): Map<string, string> {
		return this._consumerTags;
	}

	/**
	 * Gets the RabbitMQ client connection.
	 * @returns {Promise<Channel>} A promise that resolves to the RabbitMQ channel.
	 */
	public async getClient(): Promise<Channel> {
		if (!this._connection || !this._channel) {
			await this._connect();
		}

		// biome-ignore lint/style/noNonNullAssertion: this is safe as we ensure the channel is created before use
		return this._channel!;
	}

	/**
	 * Gets the RabbitMQ channel.
	 * @returns {Promise<Channel>} A promise that resolves to the RabbitMQ channel.
	 */
	public async getChannel(): Promise<Channel> {
		if (!this._channel) {
			await this.getClient();
		}

		// biome-ignore lint/style/noNonNullAssertion: this is safe as we ensure the channel is created before use
		return this._channel!;
	}

	/**
	 * Publishes a message to a specified topic.
	 * @param {string} topic The topic to publish the message to.
	 * @param {Message} message The message to publish.
	 * @returns {Promise<void>} A promise that resolves when the message is published.
	 */
	public async publish(
		topic: string,
		message: Omit<Message, "providerId">,
	): Promise<void> {
		const channel = await this.getChannel();
		await channel.assertQueue(topic);
		const messageWithProvider: Message = {
			...message,
			providerId: this._id,
		};
		channel.sendToQueue(
			topic,
			Buffer.from(JSON.stringify(messageWithProvider)),
		);
	}

	/**
	 * Subscribes to a specified topic.
	 * Creates a queue for the topic if it doesn't exist and registers a consumer.
	 * @param {string} topic The topic to subscribe to.
	 * @param {TopicHandler} handler The handler to process incoming messages.
	 * @returns {Promise<void>} A promise that resolves when the subscription is complete.
	 */
	public async subscribe(topic: string, handler: TopicHandler): Promise<void> {
		const channel = await this.getChannel();
		if (!this.subscriptions.has(topic)) {
			this.subscriptions.set(topic, []);
			await this._setupConsumer(channel, topic);
		}

		this.subscriptions.get(topic)?.push(handler);
	}

	/**
	 * Unsubscribes from a specified topic.
	 * If an ID is provided, only the handler with that ID is removed.
	 * If no ID is provided, the consumer is cancelled and all handlers for the topic are removed.
	 * @param {string} topic The topic to unsubscribe from.
	 * @param {string} [id] Optional identifier for the subscription to remove.
	 * @returns {Promise<void>} A promise that resolves when the unsubscription is complete.
	 */
	public async unsubscribe(topic: string, id?: string): Promise<void> {
		const channel = await this.getChannel();
		if (id) {
			const current = this.subscriptions.get(topic);
			if (current) {
				this.subscriptions.set(
					topic,
					current.filter((sub) => sub.id !== id),
				);
			}
		} else {
			const tag = this._consumerTags.get(topic);
			if (tag) {
				await channel.cancel(tag);
				this._consumerTags.delete(topic);
			}

			this.subscriptions.delete(topic);
		}
	}

	/**
	 * Disconnects from the RabbitMQ server and cancels all subscriptions.
	 * Closes the channel and clears the connection.
	 * @returns {Promise<void>} A promise that resolves when the disconnection is complete.
	 */
	public async disconnect(): Promise<void> {
		this._closing = true;

		if (this._reconnectTimer) {
			clearTimeout(this._reconnectTimer);
			this._reconnectTimer = undefined;
		}

		if (this._channel) {
			const channel = this._channel;
			for (const tag of this._consumerTags.values()) {
				await channel.cancel(tag);
			}

			this._consumerTags.clear();
			this.subscriptions.clear();
			await channel.close();
			this._channel = undefined;
		}

		if (this._connection) {
			await this._connection.close();
			this._connection = undefined;
		}

		this._closing = false;
	}

	/**
	 * Establishes a connection to RabbitMQ and creates a channel.
	 * Attaches error and close listeners for automatic reconnection.
	 */
	private async _connect(): Promise<void> {
		const connection = await connect(this._uri);
		this._connection = connection;
		this._channel = await connection.createChannel();

		connection.on("error", () => {
			// Connection error emitted — connection is already closing/closed.
			// The 'close' handler will trigger reconnection.
		});

		connection.on("close", () => {
			this._channel = undefined;
			this._connection = undefined;
			if (!this._closing) {
				this._scheduleReconnect();
			}
		});
	}

	/**
	 * Schedules a reconnection attempt after the configured delay.
	 * Skips if reconnection is disabled or already in progress.
	 */
	private _scheduleReconnect(): void {
		if (
			this._reconnectTimeInSeconds <= 0 ||
			this._reconnecting ||
			this._closing
		) {
			return;
		}

		this._reconnectTimer = setTimeout(async () => {
			this._reconnectTimer = undefined;
			await this._attemptReconnect();
		}, this._reconnectTimeInSeconds * 1000);
	}

	/**
	 * Attempts to reconnect to RabbitMQ and re-establish all active subscriptions.
	 */
	private async _attemptReconnect(): Promise<void> {
		if (this._reconnecting || this._closing) {
			return;
		}

		this._reconnecting = true;
		let failed = false;
		try {
			await this._connect();

			// biome-ignore lint/style/noNonNullAssertion: channel is set by _connect
			const channel = this._channel!;

			// Re-establish all active consumers
			const topics = [...this.subscriptions.keys()];
			for (const topic of topics) {
				await this._setupConsumer(channel, topic);
			}
		} catch {
			// Reconnection failed — will retry after resetting state
			this._channel = undefined;
			this._connection = undefined;
			failed = true;
		} finally {
			this._reconnecting = false;
		}

		if (failed) {
			this._scheduleReconnect();
		}
	}

	/**
	 * Sets up a consumer for a topic on the given channel.
	 * Asserts the queue and registers a message consumer that dispatches to all handlers.
	 * @param {Channel} channel The channel to set up the consumer on.
	 * @param {string} topic The topic to consume from.
	 */
	private async _setupConsumer(channel: Channel, topic: string): Promise<void> {
		await channel.assertQueue(topic);
		const { consumerTag } = await channel.consume(topic, async (message_) => {
			if (message_) {
				const message = JSON.parse(message_.content.toString()) as Message;
				const handlers = this.subscriptions.get(topic) ?? [];
				await Promise.all(handlers.map(async (sub) => sub.handler(message)));
				channel.ack(message_);
			}
		});
		this._consumerTags.set(topic, consumerTag);
	}
}

/**
 * Creates a new instance of Qified with a RabbitMQ message provider.
 * This is a convenience function for quickly setting up a Qified instance with RabbitMQ.
 * @param {RabbitMqMessageProviderOptions} options Optional configuration for the RabbitMQ message provider.
 * @returns {Qified} A new instance of Qified configured with a RabbitMQ provider.
 * @example
 * ```typescript
 * const qified = createQified({ uri: 'amqp://localhost:5672' });
 * await qified.subscribe('my-topic', {
 *   id: 'myHandler',
 *   handler: async (message) => console.log(message)
 * });
 * ```
 */
export function createQified(options?: RabbitMqMessageProviderOptions): Qified {
	const provider = new RabbitMqMessageProvider(options);
	return new Qified({ messageProviders: [provider] });
}
