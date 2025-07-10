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
	private readonly connectionPromise: Promise<ChannelModel>;
	private readonly channelPromise: Promise<Channel>;
	private readonly consumerTags = new Map<string, string>();

	constructor(options: RabbitMqMessageProviderOptions = {}) {
		const uri = options.uri ?? defaultRabbitMqUri;
		this.connectionPromise = connect(uri);
		this.channelPromise = (async () => {
			const connection = await this.connectionPromise;
			return connection.createChannel();
		})();
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
			this.consumerTags.set(topic, consumerTag);
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
			const tag = this.consumerTags.get(topic);
			if (tag) {
				await channel.cancel(tag);
				this.consumerTags.delete(topic);
			}

			this.subscriptions.delete(topic);
		}
	}

	async disconnect(): Promise<void> {
		const channel = await this.getChannel();
		for (const tag of this.consumerTags.values()) {
			// eslint-disable-next-line no-await-in-loop
			await channel.cancel(tag);
		}

		this.consumerTags.clear();
		this.subscriptions.clear();
		await channel.close();
		const connection = await this.connectionPromise;
		await connection.close();
	}

	private async getChannel(): Promise<Channel> {
		return this.channelPromise;
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
