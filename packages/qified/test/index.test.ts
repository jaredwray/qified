
import {describe, test, expect} from 'vitest';
import {Qified, MemoryMessageProvider} from '../src/index.js';
import {type Message} from '../src/types.js';

describe('Qified', () => {
	test('constructor', () => {
		const qified = new Qified();
		expect(qified).toBeInstanceOf(Qified);
	});

	test('should access the MemoryMessageProvider', () => {
		const qified = new Qified();
		expect(qified.messageProviders).toEqual([]);
		const memoryProvider = new MemoryMessageProvider();
		qified.messageProviders.push(memoryProvider);
		expect(qified.messageProviders).toContain(memoryProvider);
		expect(qified.messageProviders[0]).toBeInstanceOf(MemoryMessageProvider);
	});

	test('should set message providers via options', () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({messageProviders: [memoryProvider]});
		expect(qified.messageProviders).toContain(memoryProvider);
		expect(qified.messageProviders[0]).toBeInstanceOf(MemoryMessageProvider);
	});

	test('should set message providers via messageProviders', () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({messageProviders: [memoryProvider]});
		expect(qified.messageProviders).toContain(memoryProvider);
		const providers = qified.messageProviders;
		providers.push(new MemoryMessageProvider());
		qified.messageProviders = providers;
		expect(qified.messageProviders).toEqual(providers);
		expect(qified.messageProviders.length).toBe(2);
	});

	test('should disconnect all message providers', async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({messageProviders: [memoryProvider]});
		expect(qified.messageProviders.length).toBe(1);
		await qified.disconnect();
		expect(qified.messageProviders.length).toBe(0);
		expect(memoryProvider.subscriptions.size).toBe(0);
	});
});

describe('Qified Messaging', () => {
	test('should be able to subscribe to a topic', async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({messageProviders: [memoryProvider]});
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		const handler = async (message: any) => {};
		await qified.subscribe('test/topic', {id: 'testHandler', handler});
		expect(memoryProvider.subscriptions.size).toBe(1);
		expect(memoryProvider.subscriptions.get('test/topic')?.length).toBe(1);
	});

	test('should be able to subscribe with multiple providers to a topic', async () => {
		const memoryProvider = new MemoryMessageProvider();
		const anotherProvider = new MemoryMessageProvider();
		const qified = new Qified({messageProviders: [memoryProvider, anotherProvider]});
		// eslint-disable-next-line @typescript-eslint/no-empty-function
		const handler = async (message: any) => {};
		await qified.subscribe('test/topic', {id: 'testHandler', handler});
		expect(memoryProvider.subscriptions.size).toBe(1);
		expect(memoryProvider.subscriptions.get('test/topic')?.length).toBe(1);
	});

	test('should publish a message to a topic', async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({messageProviders: [memoryProvider]});
		let handlerCalled = false;
		const handler = async (message: Message) => {
			handlerCalled = true;
			expect(message.data.content).toBe('Hello, World!');
		};

		await qified.subscribe('test/topic', {id: 'testHandler', handler});
		await qified.publish('test/topic', {id: 'testMessage', data: {content: 'Hello, World!'}});
		expect(memoryProvider.subscriptions.get('test/topic')?.length).toBe(1);
		expect(handlerCalled).toBe(true);
	});

	test('should unsubscribe from a topic', async () => {
		const memoryProvider = new MemoryMessageProvider();
		const qified = new Qified({messageProviders: [memoryProvider]});
		let handlerCalled = false;
		const handler = async (message: Message) => {
			handlerCalled = true;
			expect(message.data.content).toBe('Hello, World!');
		};

		await qified.subscribe('test/topic', {id: 'testHandler', handler});
		await qified.publish('test/topic', {id: 'testMessage', data: {content: 'Hello, World!'}});
		expect(handlerCalled).toBe(true);

		await qified.unsubscribe('test/topic', 'testHandler');
		expect(memoryProvider.subscriptions.get('test/topic')?.length).toBe(0);
	});
});
