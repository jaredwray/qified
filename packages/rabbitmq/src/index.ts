import {Buffer} from 'node:buffer';
import {connect, type ChannelModel, type Channel} from 'amqplib';
import {
	Qified, type Message, type MessageProvider, type TopicHandler,
} from 'qified';

export type RabbitMqMessageProviderOptions = {
	uri?: string;
};

export const defaultRabbitMqUri = 'amqp://localhost:5672';

export class RabbitMqMessageProvider implements MessageProvider {
	public subscriptions = new Map<string, TopicHandler[]>();
	private _connection: Promise<ChannelModel> | undefined;
	private _channel: Promise<Channel> | undefined;
	private readonly _consumerTags = new Map<string, string>();
	private _uri: string;

	constructor(options: RabbitMqMessageProviderOptions = {}) {
		this._uri = options.uri ?? defaultRabbitMqUri;
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
		this._connection ??= connect(this._uri);
		// eslint-disable-next-line promise/prefer-await-to-then
		this._channel ??= this._connection.then(async conn => conn.createChannel());
		return this._channel;
	}

	/**
	 * Gets the RabbitMQ channel.
	 * @returns {Promise<Channel>} A promise that resolves to the RabbitMQ channel.
	 */
	public async getChannel(): Promise<Channel> {
		if (!this._channel) {
			await this.getClient();
		}

		return this._channel!;
	}

	/**
	 * Publishes a message to a specified topic.
	 * @param {string} topic The topic to publish the message to.
	 * @param {Message} message The message to publish.
	 * @returns {Promise<void>} A promise that resolves when the message is published.
	 */
	public async publish(topic: string, message: Message): Promise<void> {
		const channel = await this.getChannel();
		await channel.assertQueue(topic);
		channel.sendToQueue(topic, Buffer.from(JSON.stringify(message)));
	}

	/**
	 * Subscribes to a specified topic.
	 * @param {string} topic The topic to subscribe to.
	 * @param {TopicHandler} handler The handler to process incoming messages.
	 */
	public async subscribe(topic: string, handler: TopicHandler): Promise<void> {
		const channel = await this.getChannel();
		if (!this.subscriptions.has(topic)) {
			this.subscriptions.set(topic, []);
			await channel.assertQueue(topic);
			const {consumerTag} = await channel.consume(topic, async message_ => {
				if (message_) {
					const message = JSON.parse(message_.content.toString()) as Message;
					const handlers = this.subscriptions.get(topic) ?? [];
					await Promise.all(handlers.map(async sub => sub.handler(message)));
					channel.ack(message_);
				}
			});
			this._consumerTags.set(topic, consumerTag);
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
		const channel = await this.getChannel();
		if (id) {
			const current = this.subscriptions.get(topic);
			if (current) {
				this.subscriptions.set(topic, current.filter(sub => sub.id !== id));
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
	 * @returns {Promise<void>} A promise that resolves when the disconnection is complete.
	 */
	public async disconnect(): Promise<void> {
		const channel = await this.getChannel();
		for (const tag of this._consumerTags.values()) {
			// eslint-disable-next-line no-await-in-loop
			await channel.cancel(tag);
		}

		this._consumerTags.clear();
		this.subscriptions.clear();
		await channel.close();
		this._channel = undefined;
		this._connection = undefined;
	}
}

/**
 * Creates a new instance of Qified with a RabbitMQ message provider.
 * @param {RabbitMqMessageProviderOptions} options Optional configuration for the RabbitMQ message provider.
 * @returns A new instance of Qified.
 */
export function createQified(options?: RabbitMqMessageProviderOptions): Qified {
	const provider = new RabbitMqMessageProvider(options);
	return new Qified({messageProviders: [provider]});
}
