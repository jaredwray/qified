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
	constructor(options?: QifiedOptions) {
		if (options?.messageProviders) {
			this._messageProviders = options.messageProviders;
		}
	}

	public get messageProviders(): MessageProvider[] {
		return this._messageProviders;
	}

	public set messageProviders(providers: MessageProvider[]) {
		this._messageProviders = providers;
	}
}

export {MemoryMessageProvider} from './memory/message.js';
