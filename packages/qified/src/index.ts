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
	private _defaultChannel: string;
	constructor(options?: QifiedOptions) {
		this._defaultChannel = options?.defaultChannel ?? 'default';
	}

	get defaultChannel() {
		return this._defaultChannel;
	}

	set defaultChannel(channel: string) {
		this._defaultChannel = channel;
	}
}
