
import {describe, test, expect} from 'vitest';
import {Qified, MemoryMessageProvider} from '../src/index.js';

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
