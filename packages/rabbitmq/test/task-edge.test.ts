import { EventEmitter } from "node:events";
import type { Channel, ChannelModel } from "amqplib";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	type Mock,
	test,
	vi,
} from "vitest";
import { RabbitMqTaskProvider } from "../src/index.js";

// Mock amqplib
vi.mock("amqplib", () => ({
	connect: vi.fn(),
}));

function createMockChannel(): Channel {
	return {
		assertQueue: vi
			.fn()
			.mockResolvedValue({ queue: "test", messageCount: 0, consumerCount: 0 }),
		sendToQueue: vi.fn().mockReturnValue(true),
		consume: vi.fn().mockResolvedValue({ consumerTag: `ctag-${Date.now()}` }),
		cancel: vi.fn().mockResolvedValue({}),
		ack: vi.fn(),
		nack: vi.fn(),
		prefetch: vi.fn().mockResolvedValue(undefined),
		close: vi.fn().mockResolvedValue(undefined),
		purgeQueue: vi.fn().mockResolvedValue({ messageCount: 0 }),
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

describe("RabbitMqTaskProvider (edge cases requiring mocks)", () => {
	test("should schedule reconnect when connection closes unexpectedly", async () => {
		vi.useFakeTimers();

		const channel1 = createMockChannel();
		const connection1 = createMockConnection(channel1);
		const channel2 = createMockChannel();
		const connection2 = createMockConnection(channel2);

		mockConnect
			.mockResolvedValueOnce(connection1)
			.mockResolvedValueOnce(connection2);

		const provider = new RabbitMqTaskProvider({
			reconnectTimeInSeconds: 1,
		});
		await provider.connect();
		expect(mockConnect).toHaveBeenCalledTimes(1);

		// Simulate unexpected connection loss — triggers _scheduleReconnect (line 179)
		connection1.emit("close");

		// Advance timer so reconnect fires (lines 212-215)
		await vi.advanceTimersByTimeAsync(1100);
		expect(mockConnect).toHaveBeenCalledTimes(2);

		await provider.disconnect(true);
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

		const provider = new RabbitMqTaskProvider({
			reconnectTimeInSeconds: 1,
		});
		await provider.connect();
		expect(mockConnect).toHaveBeenCalledTimes(1);

		// Simulate connection loss
		connection1.emit("close");

		// First reconnect attempt — fails (line 242-246)
		await vi.advanceTimersByTimeAsync(1100);
		expect(mockConnect).toHaveBeenCalledTimes(2);

		// Second reconnect attempt — succeeds (lines 228-241)
		await vi.advanceTimersByTimeAsync(1100);
		expect(mockConnect).toHaveBeenCalledTimes(3);

		await provider.disconnect(true);
	});

	test("should not reconnect if reconnectTimeInSeconds is 0", async () => {
		vi.useFakeTimers();

		const channel = createMockChannel();
		const connection = createMockConnection(channel);

		mockConnect.mockResolvedValueOnce(connection);

		const provider = new RabbitMqTaskProvider({
			reconnectTimeInSeconds: 0,
		});
		await provider.connect();

		// Simulate connection loss — _scheduleReconnect should bail out (line 205)
		connection.emit("close");

		mockConnect.mockClear();
		await vi.advanceTimersByTimeAsync(5000);
		expect(mockConnect).not.toHaveBeenCalled();

		await provider.disconnect(true);
	});

	test("should not reconnect if closing flag is set when timer fires", async () => {
		vi.useFakeTimers();

		const channel = createMockChannel();
		const connection = createMockConnection(channel);

		mockConnect.mockResolvedValue(connection);

		const provider = new RabbitMqTaskProvider({
			reconnectTimeInSeconds: 1,
		});
		await provider.connect();

		// Simulate connection loss — schedules reconnect
		connection.emit("close");

		// Set _closing before the timer fires (line 222-223)
		(provider as unknown as { _closing: boolean })._closing = true;

		try {
			mockConnect.mockClear();
			await vi.advanceTimersByTimeAsync(1500);
			expect(mockConnect).not.toHaveBeenCalled();
		} finally {
			(provider as unknown as { _closing: boolean })._closing = false;
		}
	});

	test("should not schedule reconnect if already reconnecting", async () => {
		vi.useFakeTimers();

		const channel = createMockChannel();
		const connection = createMockConnection(channel);

		mockConnect.mockResolvedValue(connection);

		const provider = new RabbitMqTaskProvider({
			reconnectTimeInSeconds: 1,
		});
		await provider.connect();

		// Set _reconnecting to true — _scheduleReconnect should bail out (line 206)
		(provider as unknown as { _reconnecting: boolean })._reconnecting = true;

		connection.emit("close");

		mockConnect.mockClear();
		await vi.advanceTimersByTimeAsync(5000);
		expect(mockConnect).not.toHaveBeenCalled();

		(provider as unknown as { _reconnecting: boolean })._reconnecting = false;
		await provider.disconnect(true);
	});

	test("should re-establish consumers on reconnect", async () => {
		vi.useFakeTimers();

		const channel1 = createMockChannel();
		const connection1 = createMockConnection(channel1);
		const channel2 = createMockChannel();
		const connection2 = createMockConnection(channel2);

		mockConnect
			.mockResolvedValueOnce(connection1)
			.mockResolvedValueOnce(connection2);

		const provider = new RabbitMqTaskProvider({
			reconnectTimeInSeconds: 1,
		});
		await provider.connect();

		// Register a handler so there's something to re-establish (lines 237-241)
		provider.taskHandlers.set("my-queue", [
			{ id: "h1", handler: async () => {} },
		]);

		// Simulate connection loss
		connection1.emit("close");

		// Reconnect fires and re-establishes consumers
		await vi.advanceTimersByTimeAsync(1100);
		expect(mockConnect).toHaveBeenCalledTimes(2);
		// Should have called consume on the new channel for the queue
		expect(channel2.consume).toHaveBeenCalledWith(
			"my-queue",
			expect.any(Function),
			{ noAck: false },
		);

		await provider.disconnect(true);
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

		const provider = new RabbitMqTaskProvider({
			reconnectTimeInSeconds: 0,
		});
		await provider.connect();

		// Register a handler and set up consumer
		const tasks: unknown[] = [];
		provider.taskHandlers.set("test-q", [
			{
				id: "h1",
				handler: async (task) => {
					tasks.push(task);
				},
			},
		]);

		const ch = (provider as unknown as { _channel: Channel })._channel;
		// Manually call _setupConsumer
		await (
			provider as unknown as {
				_setupConsumer(ch: Channel, q: string): Promise<void>;
			}
		)._setupConsumer(ch, "test-q");

		// Send null message — should return early (line 323-324)
		// biome-ignore lint/style/noNonNullAssertion: set by mock
		await consumerCallback!(null);
		expect(tasks).toHaveLength(0);
		expect(channel.ack).not.toHaveBeenCalled();
		expect(channel.nack).not.toHaveBeenCalled();

		await provider.disconnect(true);
	});

	test("should clear reconnect timer on disconnect", async () => {
		vi.useFakeTimers();

		const channel = createMockChannel();
		const connection = createMockConnection(channel);

		mockConnect.mockResolvedValue(connection);

		const provider = new RabbitMqTaskProvider({
			reconnectTimeInSeconds: 1,
		});
		await provider.connect();

		// Simulate connection loss — schedules reconnect timer
		connection.emit("close");

		// Verify the timer is set (lines 657-658)
		const internal = provider as unknown as {
			_reconnectTimer: ReturnType<typeof setTimeout> | undefined;
		};
		expect(internal._reconnectTimer).toBeDefined();

		// Disconnect should clear the timer
		await provider.disconnect(true);
		expect(internal._reconnectTimer).toBeUndefined();

		// No reconnect should have happened
		mockConnect.mockClear();
		await vi.advanceTimersByTimeAsync(5000);
		expect(mockConnect).not.toHaveBeenCalled();
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

		const provider = new RabbitMqTaskProvider({
			reconnectTimeInSeconds: 1,
		});
		await provider.connect();

		expect(connection.listenerCount("error")).toBe(1);
		expect(connection.listenerCount("close")).toBe(1);

		// Emit error — handler is a no-op but should not throw
		connection.emit("error", new Error("Socket closed"));

		// Close event triggers reconnection
		connection.emit("close");

		await vi.advanceTimersByTimeAsync(1500);
		expect(mockConnect).toHaveBeenCalledTimes(2);

		await provider.disconnect(true);
	});
});
