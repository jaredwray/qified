import type { Message, MessageProvider, TopicHandler } from "../types.js";

/**
 * Configuration options for the memory message provider.
 */
export type MemoryMessageProviderOptions = {
	/**
	 * The unique identifier for this provider instance.
	 * @default "@qified/memory"
	 */
	id?: string;
};

export const defaultMemoryId = "@qified/memory";

/**
 * In-memory message provider for testing and simple use cases.
 * Messages are stored and delivered synchronously in memory without persistence.
 */
export class MemoryMessageProvider implements MessageProvider {
	private _subscriptions: Map<string, TopicHandler[]>;
	private _id;

	/**
	 * Creates an instance of MemoryMessageProvider.
	 * @param {MemoryMessageProviderOptions} options - Optional configuration for the provider.
	 */
	constructor(options?: MemoryMessageProviderOptions) {
		this._subscriptions = new Map();
		this._id = options?.id ?? defaultMemoryId;
	}

	/**
	 * Gets the provider ID for the memory message provider.
	 * @returns {string} The provider ID.
	 */
	public get id(): string {
		return this._id;
	}

	/**
	 * Sets the provider ID for the memory message provider.
	 * @param {string} id The new provider ID.
	 */
	public set id(id: string) {
		this._id = id;
	}

	/**
	 * Gets the subscriptions map for all topics.
	 * @returns {Map<string, TopicHandler[]>} The subscriptions map.
	 */
	public get subscriptions(): Map<string, TopicHandler[]> {
		return this._subscriptions;
	}

	/**
	 * Sets the subscriptions map.
	 * @param {Map<string, TopicHandler[]>} value The new subscriptions map.
	 */
	public set subscriptions(value: Map<string, TopicHandler[]>) {
		this._subscriptions = value;
	}

	/**
	 * Publishes a message to a specified topic.
	 * All handlers subscribed to the topic will be called synchronously in order.
	 * @param {string} topic The topic to publish the message to.
	 * @param {Message} message The message to publish.
	 * @returns {Promise<void>} A promise that resolves when all handlers have been called.
	 */
	public async publish(
		topic: string,
		message: Omit<Message, "providerId">,
	): Promise<void> {
		const messageWithProvider: Message = {
			...message,
			providerId: this._id,
		};
		const subscriptions = this._subscriptions.get(topic) ?? [];
		for (const subscription of subscriptions) {
			await subscription.handler(messageWithProvider);
		}
	}

	/**
	 * Subscribes to a specified topic.
	 * @param {string} topic The topic to subscribe to.
	 * @param {TopicHandler} handler The handler to process incoming messages.
	 * @returns {Promise<void>} A promise that resolves when the subscription is complete.
	 */
	public async subscribe(topic: string, handler: TopicHandler): Promise<void> {
		if (!this._subscriptions.has(topic)) {
			this._subscriptions.set(topic, []);
		}

		this._subscriptions.get(topic)?.push(handler);
	}

	/**
	 * Unsubscribes from a specified topic.
	 * If an ID is provided, only the handler with that ID is removed.
	 * If no ID is provided, all handlers for the topic are removed.
	 * @param {string} topic The topic to unsubscribe from.
	 * @param {string} [id] Optional identifier for the subscription to remove.
	 * @returns {Promise<void>} A promise that resolves when the unsubscription is complete.
	 */
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

	/**
	 * Disconnects and clears all subscriptions.
	 * @returns {Promise<void>} A promise that resolves when the disconnection is complete.
	 */
	public async disconnect(): Promise<void> {
		this._subscriptions.clear();
	}
}
