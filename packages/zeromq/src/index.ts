import { Buffer } from "node:buffer";
import {
	type Message,
	type MessageProvider,
	Qified,
	type TopicHandler,
} from "qified";
import { Publisher, Subscriber } from "zeromq";

export type ZmqMessageProviderOptions = {
	uri?: string;
	mode?: "broker" | "standalone";
};

export const defaultZmqUri = "tcp://localhost:5555";

export class ZmqMessageProvider implements MessageProvider {
	public subscriptions = new Map<string, TopicHandler[]>();

	private _subscriber: Subscriber | undefined;
	private _publisher: Publisher | undefined;
	private _uri: string;
	private _mode: "broker" | "standalone";
	private _awaitingMessages: boolean;

	constructor(options: ZmqMessageProviderOptions = {}) {
		this._uri = options.uri ?? defaultZmqUri;
		this._mode = options.mode ?? "standalone";
		this._awaitingMessages = false;
	}

	private async _createConnection(): Promise<void> {
		if (this._mode === "broker") {
			// In broker mode, connect to external proxy
			// Publisher connects to frontend (port 5555), subscriber to backend (port 5556)
			if (!this._publisher) {
				this._publisher = new Publisher();
				this._publisher.connect(this._uri); // Connect to frontend
			}

			if (!this._subscriber) {
				this._subscriber = new Subscriber();
				// Replace port 5555 with 5556 for subscriber
				const subscriberUri = this._uri.replace(":5555", ":5556");
				this._subscriber.connect(subscriberUri); // Connect to backend
			}
		} else {
			// In standalone mode, publisher binds and subscriber connects (peer-to-peer)
			if (!this._publisher) {
				this._publisher = new Publisher();
				await this._publisher.bind(this._uri);
			}

			if (!this._subscriber) {
				this._subscriber = new Subscriber();
				this._subscriber.connect(this._uri);
			}
		}
	}

	/**
	 * Publishes a message to a specified topic.
	 * @param {string} topic The topic to publish the message to.
	 * @param {Message} message The message to publish.
	 * @returns {Promise<void>} A promise that resolves when the message is published.
	 */
	public async publish(topic: string, message: Message): Promise<void> {
		await this._createConnection();
		await this._publisher?.send([topic, Buffer.from(JSON.stringify(message))]);
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
