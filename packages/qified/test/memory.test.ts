import {describe, expect, test} from 'vitest';
import {MemoryMessageProvider} from '../src/memory.js';
import type {Message} from '../src/types.js';

describe('MemoryMessageProvider', () => {
	test('should initialize with empty subscriptions', () => {
		const provider = new MemoryMessageProvider();
		expect(provider.subscriptions).toEqual([]);
	});

	test('should add a subscription', async () => {
		const provider = new MemoryMessageProvider();
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		const handler = async (message: any) => {};
		await provider.subscribe('test/topic', handler);
		expect(provider.subscriptions.length).toBe(1);
		expect(provider.subscriptions[0].topic).toBe('test/topic');
	});

	test('should publish a message to the correct topic', async () => {
		const provider = new MemoryMessageProvider();
		const message: Message = {id: 'foo', channel: 'test/topic', data: {test: 'message'}};
		const handler = async (message: any) => {
			expect(message).toEqual(message);
		};

		await provider.subscribe('test/topic', handler);

		await provider.publish('test/topic', message);
	});
});
