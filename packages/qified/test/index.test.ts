
import {describe, test, expect} from 'vitest';
import {Qified} from '../src/index.js';

describe('Qified', () => {
	test('constructor', () => {
		const qified = new Qified();
		expect(qified).toBeInstanceOf(Qified);
	});

	test('constructor with options', () => {
		const qified = new Qified({
			defaultChannel: 'new',
			uris: ['redis://localhost:6379'],
		});
		expect(qified.defaultChannel).toBe('new');
		expect(qified.uris).toEqual(['redis://localhost:6379']);
	});

	test('defaultChannel', () => {
		const qified = new Qified();
		expect(qified.defaultChannel).toBe('default');
		qified.defaultChannel = 'new';
		expect(qified.defaultChannel).toBe('new');
	});

	test('uris', () => {
		const qified = new Qified();
		expect(qified.uris).toEqual([]);
		qified.uris = ['redis://localhost:6379'];
		expect(qified.uris).toEqual(['redis://localhost:6379']);
	});
});
