
import {describe, expect, test} from 'vitest';
import {MemoryMessageProvider} from '../src/memory/message.js';
import type {Message, TopicHandler} from '../src/types.js';

describe('MemoryMessageProvider', () => {
	test('should initialize with empty subscriptions', () => {
		const provider = new MemoryMessageProvider();
		expect(provider.subscriptions).toEqual(new Map());
	});

	test('should be able to set subscriptions', () => {
		const provider = new MemoryMessageProvider();
		const subscriptions = new Map<string, TopicHandler[]>();
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		subscriptions.set('test/topic1', [{async handler(message: any) {}}]);
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		subscriptions.set('test/topic2', [{async handler(message: any) {}}]);
		provider.subscriptions = subscriptions;
		expect(provider.subscriptions).toEqual(subscriptions);
	});

	test('should add a subscription', async () => {
		const provider = new MemoryMessageProvider();
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		const handler = async (message: any) => {};
		await provider.subscribe('test/topic', {id: 'test', handler});
		expect(provider.subscriptions.size).toBe(1);
		expect(provider.subscriptions.get('test/topic')?.[0].id).toBe('test');
	});

	test('should add multiple to a subscription', async () => {
		const provider = new MemoryMessageProvider();
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		const handler = async (message: any) => {};
		await provider.subscribe('test/topic', {id: 'test', handler});
		await provider.subscribe('test/topic', {id: 'test2', handler});
		expect(provider.subscriptions.size).toBe(1);
		expect(provider.subscriptions.get('test/topic')?.[0].id).toBe('test');
		expect(provider.subscriptions.get('test/topic')?.[1].id).toBe('test2');
		expect(provider.subscriptions.get('test/topic')?.length).toBe(2);
	});

	test('should remove a subscription', async () => {
		const provider = new MemoryMessageProvider();
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		const handler = async (message: any) => {};
		await provider.subscribe('test/topic', {id: 'test', handler});
		expect(provider.subscriptions.size).toBe(1);
		await provider.unsubscribe('test/topic', 'test');
		expect(provider.subscriptions.get('test/topic')?.length).toBe(0);
	});

	test('should remove a subscription without id', async () => {
		const provider = new MemoryMessageProvider();
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		const handler = async (message: any) => {};
		await provider.subscribe('test/topic', {id: 'test', handler});
		expect(provider.subscriptions.size).toBe(1);
		await provider.unsubscribe('test/topic');
		expect(provider.subscriptions.get('test/topic')).toBe(undefined);
	});

	test('should publish a message to the correct topic', async () => {
		const provider = new MemoryMessageProvider();
		const message: Message = {id: 'foo', channel: 'test/topic', data: {test: 'message'}};
		let handlerMessage = '';
		const handler = async (message: any) => {
			expect(message).toEqual(message);
			handlerMessage = message as string;
		};

		await provider.subscribe('test/topic', {id: 'test', handler});

		await provider.publish('test/topic', message);

		expect(handlerMessage).toEqual(message);
	});

	test('should disconnect and clear subscriptions', async () => {
		const provider = new MemoryMessageProvider();
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		const handler = async (message: any) => {};
		await provider.subscribe('test/topic', {id: 'test', handler});
		expect(provider.subscriptions.size).toBe(1);
		await provider.disconnect();
		expect(provider.subscriptions.size).toBe(0);
	});
});
