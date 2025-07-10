import {describe, test, expect} from 'vitest';
import {Qified, type Message} from 'qified';
import {RabbitMqMessageProvider, createQified} from '../src/index.js';

describe('RabbitMqMessageProvider', () => {
	test('should publish and receive a message', async () => {
		const provider = new RabbitMqMessageProvider();
		const message: Message = {id: '1', data: 'test'};
		let received: Message | undefined;
		const id = 'test-handler';
		await provider.subscribe('test-topic', {
			id,
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

		await provider.unsubscribe('test-topic', id);
		await provider.disconnect();
	});

	test('should unsubscribe all handlers with no id', async () => {
		const provider = new RabbitMqMessageProvider();
		const message: Message = {id: '1', data: 'test'};
		let received1: Message | undefined;
		let received2: Message | undefined;
		await provider.subscribe('test-topic', {
			async handler(message) {
				received1 = message;
			},
		});

		await provider.subscribe('test-topic', {
			async handler(message) {
				received2 = message;
			},
		});

		await provider.publish('test-topic', message);

		const firstSubscriptions = provider.subscriptions.get('test-topic');
		expect(firstSubscriptions?.length).toBe(2);

		// Wait a moment for async delivery
		await new Promise<void>(resolve => {
			setTimeout(resolve, 100);
		});
		expect(received1).toEqual(message);
		expect(received2).toEqual(message);

		await provider.unsubscribe('test-topic');

		const subscriptions = provider.subscriptions.get('test-topic');
		expect(subscriptions).toBeUndefined();

		await provider.disconnect();
	});

	test('should be able to use with Qified', async () => {
		const provider = new RabbitMqMessageProvider();
		const qified = new Qified({messageProviders: [provider]});
		const message: Message = {id: '1', data: 'test'};
		let received: Message | undefined;
		const id = 'test-handler';
		await qified.subscribe('test-topic', {
			id,
			async handler(message) {
				received = message;
			},
		});
		await qified.publish('test-topic', message);
		// Wait a moment for async delivery
		await new Promise<void>(resolve => {
			setTimeout(resolve, 100);
		});
		expect(received).toEqual(message);

		await qified.unsubscribe('test-topic', id);
		await qified.disconnect();
	});

	test('should create Qified instance with RabbitMQ provider', () => {
		const qified = createQified();
		expect(qified).toBeInstanceOf(Qified);
		expect(qified.messageProviders.length).toBe(1);
		expect(qified.messageProviders[0]).toBeInstanceOf(RabbitMqMessageProvider);
	});
});
