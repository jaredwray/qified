import {type MessageProvider, type TaskProvider} from './types.js';

export type QifiedOptions = {
	/**
	 * The message providers to use.
	 */
	messageProviders?: MessageProvider[];

	/**
	 * The task providers to use.
	 */
	taskProviders?: TaskProvider[];
};

export class Qified {
	private _messageProviders: MessageProvider[] = [];
	/**
	 * Creates an instance of Qified.
	 * @param {QifiedOptions} options - Optional configuration for Qified.
	 */
	constructor(options?: QifiedOptions) {
		if (options?.messageProviders) {
			this._messageProviders = options.messageProviders;
		}
	}

	/**
	 * Gets or sets the message providers.
	 * @returns {MessageProvider[]} The array of message providers.
	 */
	public get messageProviders(): MessageProvider[] {
		return this._messageProviders;
	}

	/**
	 * Sets the message providers.
	 * @param {MessageProvider[]} providers - The array of message providers to set.
	 */
	public set messageProviders(providers: MessageProvider[]) {
		this._messageProviders = providers;
	}
}

export {MemoryMessageProvider} from './memory/message.js';
