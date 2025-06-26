import type {Message, MessageProvider, TopicHandler} from '../types.js';

export class MemoryMessageProvider implements MessageProvider {
	private _subscriptions: TopicHandler[];

	constructor() {
		this._subscriptions = [];
	}

	public get subscriptions(): TopicHandler[] {
		return this._subscriptions;
	}

	public set subscriptions(value: TopicHandler[]) {
		this._subscriptions = value;
	}

	// eslint-disable-next-line @typescript-eslint/no-empty-function
	public async init(): Promise<void> {}

	public async publish(topic: string, message: Message): Promise<void> {
		const subscriptions = this._subscriptions.filter(subscription => subscription.topic === topic);
		for (const subscription of subscriptions) {
			// eslint-disable-next-line no-await-in-loop
			await subscription.handler(message);
		}
	}

	public async subscribe(subscription: TopicHandler): Promise<void> {
		this._subscriptions.push(subscription);
	}

	public async unsubscribe(topic: string): Promise<void> {
		this._subscriptions = this._subscriptions.filter(subscription => subscription.topic !== topic);
	}

	public async disconnect(): Promise<void> {
		this._subscriptions = [];
	}
}
