import {createClient, type RedisClientType} from 'redis';
import {
	Qified, type Message, type MessageProvider, type TopicHandler,
} from 'qified';

export type RedisMessageProviderOptions = {
	uri?: string;
};

export class RedisMessageProvider implements MessageProvider {
	public subscriptions = new Map<string, TopicHandler[]>();
	private readonly pub: RedisClientType;
	private readonly sub: RedisClientType;

	constructor(options: RedisMessageProviderOptions = {}) {
		const uri = options.uri ?? 'redis://localhost:6379';
		this.pub = createClient({url: uri});
		this.sub = this.pub.duplicate();
		void this.pub.connect();
		void this.sub.connect();
	}

	async publish(topic: string, message: Message): Promise<void> {
		await this.pub.publish(topic, JSON.stringify(message));
	}

	async subscribe(topic: string, handler: TopicHandler): Promise<void> {
		if (!this.subscriptions.has(topic)) {
			this.subscriptions.set(topic, []);
			await this.sub.subscribe(topic, async raw => {
				const message = JSON.parse(raw) as Message;
				const handlers = this.subscriptions.get(topic) ?? [];
				await Promise.all(handlers.map(async sub => sub.handler(message)));
			});
		}

		this.subscriptions.get(topic)?.push(handler);
	}

	async unsubscribe(topic: string, id?: string): Promise<void> {
		if (id) {
			const current = this.subscriptions.get(topic);
			if (current) {
				this.subscriptions.set(
					topic,
					current.filter(sub => sub.id !== id),
				);
			}
		} else {
			this.subscriptions.delete(topic);
			await this.sub.unsubscribe(topic);
		}
	}

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
	return new Qified({messageProviders: [provider]});
}
