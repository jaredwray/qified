import {type MessageProvider, type TaskProvider} from './types.js';

export type QifiedOptions = {
	/**
	 * The default channel to send messages to.
	 */
	defaultChannel: string;

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
	private _defaultChannel = 'default';
	private _messageProviders: MessageProvider[] = [];
	constructor(options?: QifiedOptions) {
		if (options) {
			if (options.messageProviders) {
				this._messageProviders = options.messageProviders;
			}

			this._defaultChannel = options?.defaultChannel ?? 'default';
		}
	}

	get defaultChannel() {
		return this._defaultChannel;
	}

	set defaultChannel(channel: string) {
		this._defaultChannel = channel;
	}

	public get messageProviders(): MessageProvider[] {
		return this._messageProviders;
	}

	public set messageProviders(providers: MessageProvider[]) {
		this._messageProviders = providers;
	}
}

export {MemoryMessageProvider} from './memory/message.js';
