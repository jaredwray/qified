import { Buffer } from "node:buffer";
import {
	type Message,
	type MessageProvider,
	Qified,
	type TopicHandler,
} from "qified";
import { Publisher, Subscriber } from "zeromq";

/**
 * Configuration options for the ZeroMQ message provider.
 */
export type ZmqMessageProviderOptions = {
	/** ZeroMQ connection URI. Defaults to "tcp://localhost:5555" */
	uri?: string;
	/** Unique identifier for this provider instance. Defaults to "@qified/zeromq" */
	id?: string;
};

/** Default ZeroMQ connection URI */
export const defaultZmqUri = "tcp://localhost:5555";

/** Default ZeroMQ provider identifier */
export const defaultZmqId = "@qified/zeromq";

/**
 * ZeroMQ-based message provider for Qified.
 * Uses ZeroMQ pub/sub pattern to enable message distribution across multiple instances.
 */
export class ZmqMessageProvider implements MessageProvider {
	/** Map of topic names to their registered handlers */
	public subscriptions = new Map<string, TopicHandler[]>();

	/** ZeroMQ subscriber socket */
	private _subscriber: Subscriber | undefined;

	/** ZeroMQ publisher socket */
	private _publisher: Publisher | undefined;

	/** Connection URI for ZeroMQ */
	private _uri: string;

	/** Flag indicating if the subscriber is actively listening for messages */
	private _awaitingMessages: boolean;

	private _id: string;

	/**
	 * Creates a new ZeroMQ message provider instance.
	 * @param options Configuration options for the provider
	 */
	constructor(options: ZmqMessageProviderOptions = {}) {
		this._uri = options.uri ?? defaultZmqUri;
		this._id = options.id ?? defaultZmqId;
		this._awaitingMessages = false;
	}

	/**
	 * Gets the unique identifier for this provider instance.
	 */
	public get id(): string {
		return this._id;
	}

	/**
	 * Sets the unique identifier for this provider instance.
	 */
	public set id(id: string) {
		this._id = id;
	}

	/**
	 * Creates ZeroMQ publisher and subscriber connections.
	 * Publisher binds to the URI, subscriber connects to it.
	 * @private
	 */
	private async _createConnection(): Promise<void> {
		// Publisher `binds` and subscriber `connects`

		if (!this._publisher) {
			this._publisher = new Publisher();
			await this._publisher.bind(this._uri);
		}

		if (!this._subscriber) {
			this._subscriber = new Subscriber();
			this._subscriber.connect(this._uri);
		}
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
		await this._createConnection();
		const messageWithProvider: Message = {
			...message,
			providerId: this._id,
		};
		await this._publisher?.send([
			topic,
			Buffer.from(JSON.stringify(messageWithProvider)),
		]);
	}

	/**
	 * Subscribes to a specified topic.
	 * @param {string} topic The topic to subscribe to.
	 * @param {TopicHandler} handler The handler to process incoming messages.
	 */
	public async subscribe(topic: string, handler: TopicHandler): Promise<void> {
		await this._createConnection();

		if (!this.subscriptions.has(topic)) {
			this.subscriptions.set(topic, []);
			this._subscriber?.subscribe(topic);
		}

		this.subscriptions.get(topic)?.push(handler);

		if (!this._awaitingMessages) {
			(async () => {
				for await (const [tpc, msg] of this._subscriber as Subscriber) {
					if (msg) {
						const message = JSON.parse(msg.toString());
						const handlers = this.subscriptions.get(tpc.toString()) ?? [];
						await Promise.all(
							handlers.map(async (sub) => sub.handler(message)),
						);
					}
				}
			})();

			this._awaitingMessages = true;
		}
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
			this.subscriptions.delete(topic);
		}
	}

	/**
	 * Disconnects from the ZeroMQ server and cancels all subscriptions.
	 * @returns {Promise<void>} A promise that resolves when the disconnection is complete.
	 */
	public async disconnect(): Promise<void> {
		const topics = this.subscriptions.keys();
		for (const topic of topics) {
			this._subscriber?.unsubscribe(topic);
		}

		this.subscriptions.clear();

		this._subscriber?.close();
		this._publisher?.close();

		this._subscriber = undefined;
		this._publisher = undefined;
	}
}

/**
 * Creates a new instance of Qified with a ZeroMQ message provider.
 * @param {ZmqMessageProviderOptions} options Optional configuration for the ZeroMQ message provider.
 * @returns A new instance of Qified.
 */
export function createQified(options?: ZmqMessageProviderOptions): Qified {
	const provider = new ZmqMessageProvider(options);
	return new Qified({ messageProviders: [provider] });
}
