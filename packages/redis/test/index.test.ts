import {describe, test, expect} from 'vitest';
import {RedisMessageProvider} from '../src/index.js';
import type {Message} from '../src/types.js';

describe('RedisMessageProvider', () => {
	test('should publish and receive a message', async () => {
		const provider = new RedisMessageProvider();
		const message: Message = {id: '1', data: 'test'};
		let received: Message | undefined;
		await provider.subscribe('test-topic', {
			id: 'handler',
			async handler(message) {
				received = message;
			},
		});
		await provider.publish('test-topic', message);
		// Wait a moment for async delivery
		await new Promise<void>(resolve => {
			setTimeout(resolve, 100);
		});
		expect(received).toEqual(message);
		await provider.disconnect();
	});
});
