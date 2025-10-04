import type { Message, MessageProvider, TopicHandler } from "../types.js";

export type MemoryMessageProviderOptions = {
	id?: string;
};

export const defaultMemoryId = "@qified/memory";

export class MemoryMessageProvider implements MessageProvider {
	private _subscriptions: Map<string, TopicHandler[]>;
	private _id;

	constructor(options?: MemoryMessageProviderOptions) {
		this._subscriptions = new Map();
		this._id = options?.id ?? defaultMemoryId;
	}

	public get id(): string {
		return this._id;
	}

	public set id(id: string) {
		this._id = id;
	}

	public get subscriptions(): Map<string, TopicHandler[]> {
		return this._subscriptions;
	}

	public set subscriptions(value: Map<string, TopicHandler[]>) {
		this._subscriptions = value;
	}

	public async publish(topic: string, message: Message): Promise<void> {
		const subscriptions = this._subscriptions.get(topic) ?? [];
		for (const subscription of subscriptions) {
			await subscription.handler(message);
		}
	}

	public async subscribe(topic: string, handler: TopicHandler): Promise<void> {
		if (!this._subscriptions.has(topic)) {
			this._subscriptions.set(topic, []);
		}

		this._subscriptions.get(topic)?.push(handler);
	}

	public async unsubscribe(topic: string, id?: string): Promise<void> {
		if (id) {
			const subscriptions = this._subscriptions.get(topic);
			if (subscriptions) {
				this._subscriptions.set(
					topic,
					subscriptions.filter((sub) => sub.id !== id),
				);
			}
		} else {
			this._subscriptions.delete(topic);
		}
	}

	public async disconnect(): Promise<void> {
		this._subscriptions.clear();
	}
}
