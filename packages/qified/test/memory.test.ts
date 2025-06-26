
import {describe, expect, test} from 'vitest';
import {MemoryMessageProvider} from '../src/memory/message.js';
import type {Message} from '../src/types.js';

describe('MemoryMessageProvider', () => {
	test('should initialize with empty subscriptions', () => {
		const provider = new MemoryMessageProvider();
		expect(provider.subscriptions).toEqual([]);
	});

	test('should be able to set subscriptions', () => {
		const provider = new MemoryMessageProvider();
		const subscriptions = [
			// eslint-disable-next-line @typescript-eslint/no-empty-function
			{topic: 'test/topic1', async handler(message: any) {}},
			// eslint-disable-next-line @typescript-eslint/no-empty-function
			{topic: 'test/topic2', async handler(message: any) {}},
		];
		provider.subscriptions = subscriptions;
		expect(provider.subscriptions).toEqual(subscriptions);
	});

	test('should add a subscription', async () => {
		const provider = new MemoryMessageProvider();
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		const handler = async (message: any) => {};
		await provider.subscribe({topic: 'test/topic', handler});
		expect(provider.subscriptions.length).toBe(1);
		expect(provider.subscriptions[0].topic).toBe('test/topic');
	});

	test('should remove a subscription', async () => {
		const provider = new MemoryMessageProvider();
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		const handler = async (message: any) => {};
		await provider.subscribe({topic: 'test/topic', handler});
		expect(provider.subscriptions.length).toBe(1);
		await provider.unsubscribe('test/topic');
		expect(provider.subscriptions.length).toBe(0);
	});

	test('should publish a message to the correct topic', async () => {
		const provider = new MemoryMessageProvider();
		const message: Message = {id: 'foo', channel: 'test/topic', data: {test: 'message'}};
		let handlerMessage = '';
		const handler = async (message: any) => {
			expect(message).toEqual(message);
			handlerMessage = message as string;
		};

		await provider.subscribe({topic: 'test/topic', handler});

		await provider.publish('test/topic', message);

		expect(handlerMessage).toEqual(message);
	});

	test('should disconnect and clear subscriptions', async () => {
		const provider = new MemoryMessageProvider();
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		const handler = async (message: any) => {};
		await provider.subscribe({topic: 'test/topic', handler});
		expect(provider.subscriptions.length).toBe(1);
		await provider.disconnect();
		expect(provider.subscriptions.length).toBe(0);
	});
});
