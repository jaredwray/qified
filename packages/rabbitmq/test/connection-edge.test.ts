import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import type { ChannelModel, ConfirmChannel } from "amqplib";
import type { Message } from "qified";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	type Mock,
	test,
	vi,
} from "vitest";
import { RabbitMqMessageProvider } from "../src/index.js";

// Mock amqplib
vi.mock("amqplib", () => ({
	connect: vi.fn(),
}));

function createMockChannel(): ConfirmChannel {
	return {
		assertQueue: vi.fn().mockResolvedValue({}),
		sendToQueue: vi
			.fn()
			.mockImplementation(
				(
					_queue: string,
					_content: Buffer,
					_options: unknown,
					callback?: (error: Error | null) => void,
				) => {
					callback?.(null);
					return true;
				},
			),
		waitForConfirms: vi.fn().mockResolvedValue(undefined),
		consume: vi.fn().mockResolvedValue({ consumerTag: `ctag-${Date.now()}` }),
		cancel: vi.fn().mockResolvedValue({}),
		ack: vi.fn(),
		close: vi.fn().mockResolvedValue(undefined),
	} as unknown as ConfirmChannel;
}

function createMockConnection(
	channel: ConfirmChannel,
): ChannelModel & EventEmitter {
	const emitter = new EventEmitter();
	return Object.assign(emitter, {
		createConfirmChannel: vi.fn().mockResolvedValue(channel),
		close: vi.fn().mockResolvedValue(undefined),
	}) as unknown as ChannelModel & EventEmitter;
}

let mockConnect: Mock;

beforeEach(async () => {
	const amqplib = await import("amqplib");
	mockConnect = amqplib.connect as unknown as Mock;
	mockConnect.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("RabbitMqMessageProvider (edge cases requiring mocks)", () => {
	test("should re-open a fresh connection after the previous one closes", async () => {
		const channel1 = createMockChannel();
		const connection1 = createMockConnection(channel1);
		const channel2 = createMockChannel();
		const connection2 = createMockConnection(channel2);

		mockConnect
			.mockResolvedValueOnce(connection1)
			.mockResolvedValueOnce(connection2);

		const provider = new RabbitMqMessageProvider({
			reconnectTimeInSeconds: 0,
		});
		const first = await provider.getClient();
		expect(first).toBe(channel1);

		// Simulate the connection closing spontaneously. The close handler
		// should clear the cached _connectionPromise so the next getClient()
		// opens a fresh connection instead of resolving against the dead one.
		connection1.emit("close");

		const second = await provider.getClient();
		expect(second).toBe(channel2);
		expect(mockConnect).toHaveBeenCalledTimes(2);

		await provider.disconnect();
	});

	test("should gate concurrent getClient() calls through a single connect", async () => {
		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		const provider = new RabbitMqMessageProvider({
			reconnectTimeInSeconds: 0,
		});

		// Fire many concurrent calls before any have resolved — all must
		// resolve against the same underlying connect() call.
		const results = await Promise.all([
			provider.getClient(),
			provider.getClient(),
			provider.getClient(),
			provider.getClient(),
			provider.getClient(),
		]);

		expect(mockConnect).toHaveBeenCalledTimes(1);
		for (const result of results) {
			expect(result).toBe(channel);
		}

		await provider.disconnect();
	});

	test("should reject publish when broker returns confirm error", async () => {
		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		(channel.sendToQueue as Mock).mockImplementation(
			(
				_queue: string,
				_content: Buffer,
				_options: unknown,
				callback?: (error: Error | null) => void,
			) => {
				callback?.(new Error("broker nack"));
				return true;
			},
		);

		const provider = new RabbitMqMessageProvider({
			reconnectTimeInSeconds: 0,
		});

		await expect(
			provider.publish("test-topic", {
				id: "msg-1",
				data: { hello: "world" },
			}),
		).rejects.toThrow("broker nack");

		await provider.disconnect();
	});

	test("should handle null message in consumer callback", async () => {
		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		let consumerCallback: (msg: unknown) => Promise<void>;
		(channel.consume as Mock).mockImplementation(
			async (_queue: string, cb: (msg: unknown) => Promise<void>) => {
				consumerCallback = cb;
				return { consumerTag: "ctag-test" };
			},
		);

		const received: Message[] = [];
		const provider = new RabbitMqMessageProvider();
		await provider.subscribe("topic", {
			id: "h1",
			handler: async (msg) => {
				received.push(msg);
			},
		});

		// Valid message
		const testMessage: Message = {
			id: "1",
			data: "test",
			providerId: "@qified/rabbitmq",
		};
		// biome-ignore lint/style/noNonNullAssertion: set by mock
		await consumerCallback!({
			content: Buffer.from(JSON.stringify(testMessage)),
		});
		expect(received).toHaveLength(1);
		expect(channel.ack).toHaveBeenCalledTimes(1);

		// Null message should be ignored
		// biome-ignore lint/style/noNonNullAssertion: set by mock
		await consumerCallback!(null);
		expect(received).toHaveLength(1);

		await provider.disconnect();
	});

	test("should handle message when subscriptions map is cleared", async () => {
		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		let consumerCallback: (msg: unknown) => Promise<void>;
		(channel.consume as Mock).mockImplementation(
			async (_queue: string, cb: (msg: unknown) => Promise<void>) => {
				consumerCallback = cb;
				return { consumerTag: "ctag-test" };
			},
		);

		const provider = new RabbitMqMessageProvider();
		await provider.subscribe("topic", {
			id: "h1",
			handler: async () => {},
		});

		// Clear subscriptions to hit the ?? [] fallback
		provider.subscriptions.delete("topic");

		const fakeMsg = {
			content: Buffer.from(
				JSON.stringify({ id: "1", data: "x", providerId: "test" }),
			),
		};

		// Should not throw — falls back to empty handlers array
		// biome-ignore lint/style/noNonNullAssertion: set by mock
		await consumerCallback!(fakeMsg);
		expect(channel.ack).toHaveBeenCalledWith(fakeMsg);

		await provider.disconnect();
	});

	test("should retry reconnection on failure then succeed", async () => {
		vi.useFakeTimers();

		const channel1 = createMockChannel();
		const connection1 = createMockConnection(channel1);
		const channel3 = createMockChannel();
		const connection3 = createMockConnection(channel3);

		mockConnect
			.mockResolvedValueOnce(connection1)
			.mockRejectedValueOnce(new Error("Connection refused"))
			.mockResolvedValueOnce(connection3);

		const provider = new RabbitMqMessageProvider({
			reconnectTimeInSeconds: 1,
		});
		await provider.getClient();
		expect(mockConnect).toHaveBeenCalledTimes(1);

		// Simulate connection loss
		connection1.emit("close");

		// First reconnect attempt — fails
		await vi.advanceTimersByTimeAsync(1100);
		expect(mockConnect).toHaveBeenCalledTimes(2);

		// Second reconnect attempt — succeeds
		await vi.advanceTimersByTimeAsync(1100);
		expect(mockConnect).toHaveBeenCalledTimes(3);

		await provider.disconnect();
	});

	test("should not reconnect if closing flag set when timer fires", async () => {
		vi.useFakeTimers();

		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		const provider = new RabbitMqMessageProvider({
			reconnectTimeInSeconds: 1,
		});
		await provider.getClient();

		// Simulate connection loss — schedules reconnect timer
		connection.emit("close");

		// Set _closing before the timer fires
		(provider as unknown as { _closing: boolean })._closing = true;

		try {
			mockConnect.mockClear();
			await vi.advanceTimersByTimeAsync(1500);
			expect(mockConnect).not.toHaveBeenCalled();
		} finally {
			// Reset _closing so cleanup works even if assertion fails
			(provider as unknown as { _closing: boolean })._closing = false;
		}
	});

	test("should reconnect against the new URI after the uri setter is used", async () => {
		const channel1 = createMockChannel();
		const connection1 = createMockConnection(channel1);
		const channel2 = createMockChannel();
		const connection2 = createMockConnection(channel2);

		mockConnect
			.mockResolvedValueOnce(connection1)
			.mockResolvedValueOnce(connection2);

		const provider = new RabbitMqMessageProvider({
			reconnectTimeInSeconds: 0,
		});
		const first = await provider.getClient();
		expect(first).toBe(channel1);
		expect(mockConnect).toHaveBeenCalledWith("amqp://localhost:5672");

		// Change the URI. The setter clears _connection/_channel; it must also
		// drop the cached _connectionPromise so the next getClient() opens a
		// fresh connection against the new URI instead of short-circuiting to
		// the already-resolved promise (which would return undefined channel).
		provider.uri = "amqp://new-host:5672";

		const second = await provider.getClient();
		expect(second).toBe(channel2);
		expect(mockConnect).toHaveBeenCalledTimes(2);
		expect(mockConnect).toHaveBeenLastCalledWith("amqp://new-host:5672");

		await provider.disconnect();
	});

	test("getClient rejects while a disconnect is in flight", async () => {
		let resolveConnect!: (value: unknown) => void;
		const pending = new Promise((resolve) => {
			resolveConnect = resolve;
		});
		mockConnect.mockReturnValue(pending);

		const provider = new RabbitMqMessageProvider({
			reconnectTimeInSeconds: 0,
		});

		// Kick off a connect that won't resolve until we say so.
		const firstGet = provider.getClient();

		// disconnect() sets _closing synchronously, then awaits the pending
		// connect. While it's parked on that await, a concurrent getClient must
		// fail fast — otherwise it would race past disconnect's cleanup and leak
		// a live connection the caller assumes ownership of.
		const disconnectPromise = provider.disconnect();

		await expect(provider.getClient()).rejects.toThrow(
			"Provider is disconnecting",
		);

		const channel = createMockChannel();
		resolveConnect(createMockConnection(channel));
		await firstGet;
		await disconnectPromise;
	});

	test("should handle connection error event gracefully", async () => {
		vi.useFakeTimers();

		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		const channel2 = createMockChannel();
		const connection2 = createMockConnection(channel2);

		mockConnect
			.mockResolvedValueOnce(connection)
			.mockResolvedValueOnce(connection2);

		const provider = new RabbitMqMessageProvider({
			reconnectTimeInSeconds: 1,
		});
		await provider.getClient();

		expect(connection.listenerCount("error")).toBe(1);
		expect(connection.listenerCount("close")).toBe(1);

		// Emit error — handler is a no-op but should not throw
		connection.emit("error", new Error("Socket closed"));

		// Close event triggers reconnection
		connection.emit("close");

		await vi.advanceTimersByTimeAsync(1500);
		expect(mockConnect).toHaveBeenCalledTimes(2);

		await provider.disconnect();
	});
});
