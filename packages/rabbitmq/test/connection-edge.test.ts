import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import type { Channel, ChannelModel } from "amqplib";
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

function createMockChannel(): Channel {
	return {
		assertQueue: vi.fn().mockResolvedValue({}),
		sendToQueue: vi.fn().mockReturnValue(true),
		consume: vi.fn().mockResolvedValue({ consumerTag: `ctag-${Date.now()}` }),
		cancel: vi.fn().mockResolvedValue({}),
		ack: vi.fn(),
		close: vi.fn().mockResolvedValue(undefined),
	} as unknown as Channel;
}

function createMockConnection(channel: Channel): ChannelModel & EventEmitter {
	const emitter = new EventEmitter();
	return Object.assign(emitter, {
		createChannel: vi.fn().mockResolvedValue(channel),
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
	test("should reconnect when connection exists but channel is undefined", async () => {
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
		await provider.getClient();

		// Clear only the channel but keep the connection
		const internal = provider as unknown as {
			_connection: unknown;
			_channel: unknown;
		};
		internal._channel = undefined;
		expect(internal._connection).toBe(connection1);

		const result = await provider.getClient();
		expect(result).toBe(channel2);
		expect(mockConnect).toHaveBeenCalledTimes(2);

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
