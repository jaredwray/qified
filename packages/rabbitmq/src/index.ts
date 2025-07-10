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

	public get uri(): string {
		return this._uri;
	}

	public set uri(value: string) {
		this._uri = value;
		this._connection = undefined;
		this._channel = undefined;
	}

	public get consumerTags(): Map<string, string> {
		return this._consumerTags;
	}

	public async getClient(): Promise<Channel> {
		this._connection ??= connect(this._uri);
		// eslint-disable-next-line promise/prefer-await-to-then
		this._channel ??= this._connection.then(async conn => conn.createChannel());
		return this._channel;
	}

	public async getChannel(): Promise<Channel> {
		if (!this._channel) {
			await this.getClient();
		}

		return this._channel!;
	}

	async publish(topic: string, message: Message): Promise<void> {
		const channel = await this.getChannel();
		await channel.assertQueue(topic);
		channel.sendToQueue(topic, Buffer.from(JSON.stringify(message)));
	}

	async subscribe(topic: string, handler: TopicHandler): Promise<void> {
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

	async unsubscribe(topic: string, id?: string): Promise<void> {
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

	async disconnect(): Promise<void> {
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
