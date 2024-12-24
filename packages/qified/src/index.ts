
export type QifiedOptions = {
	/**
	 * The base uri to use for all services.
	 */
	uris: string[];
	/**
	 * The default channel to send messages to.
	 */
	defaultChannel: string;
};

export class Qified {
	private _defaultChannel: string;
	private _uris: string[];
	constructor(options?: QifiedOptions) {
		this._defaultChannel = options?.defaultChannel ?? 'default';
		this._uris = options?.uris ?? [];
	}

	get defaultChannel() {
		return this._defaultChannel;
	}

	set defaultChannel(channel: string) {
		this._defaultChannel = channel;
	}

	get uris() {
		return this._uris;
	}

	set uris(uris: string[]) {
		this._uris = uris;
	}
}
