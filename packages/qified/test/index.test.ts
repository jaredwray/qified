
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
		});
		expect(qified.defaultChannel).toBe('new');
	});

	test('defaultChannel', () => {
		const qified = new Qified();
		expect(qified.defaultChannel).toBe('default');
		qified.defaultChannel = 'new';
		expect(qified.defaultChannel).toBe('new');
	});
});
