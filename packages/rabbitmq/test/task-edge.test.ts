import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import type { ChannelModel, ConfirmChannel } from "amqplib";
import type { Task } from "qified";
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

function createMockChannel(): ConfirmChannel {
	return {
		assertQueue: vi
			.fn()
			.mockResolvedValue({ queue: "test", messageCount: 0, consumerCount: 0 }),
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
		nack: vi.fn(),
		prefetch: vi.fn().mockResolvedValue(undefined),
		close: vi.fn().mockResolvedValue(undefined),
		purgeQueue: vi.fn().mockResolvedValue({ messageCount: 0 }),
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

		const ch = (provider as unknown as { _channel: ConfirmChannel })._channel;
		// Manually call _setupConsumer
		await (
			provider as unknown as {
				_setupConsumer(ch: ConfirmChannel, q: string): Promise<void>;
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

	test("extend's inner timeout callback skips reject when already acknowledged", async () => {
		vi.useFakeTimers();

		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		let consumerCallback!: (msg: unknown) => Promise<void>;
		(channel.consume as Mock).mockImplementation(
			async (_queue: string, cb: (msg: unknown) => Promise<void>) => {
				consumerCallback = cb;
				return { consumerTag: "ctag-test" };
			},
		);

		const provider = new RabbitMqTaskProvider({ reconnectTimeInSeconds: 0 });
		await provider.connect();

		let released!: () => void;
		const handlerDone = new Promise<void>((resolve) => {
			released = resolve;
		});

		// Handler extends, acks, then lingers — the extended timer must fire
		// while acknowledged=true so the callback takes its else branch.
		await provider.dequeue("q-extend-ack", {
			id: "h1",
			handler: async (_task, ctx) => {
				await ctx.extend(100);
				await ctx.ack();
				await handlerDone;
			},
		});

		const task = { id: "t1", data: { message: "hi" } };
		const message = {
			content: Buffer.from(JSON.stringify(task)),
			properties: {},
			fields: {},
		};

		const processing = consumerCallback(message);

		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(150);

		released();
		await processing;

		expect(channel.ack).toHaveBeenCalledTimes(1);
		expect(channel.nack).not.toHaveBeenCalled();

		await provider.disconnect(true);
	});

	test("connect() is idempotent and reuses the in-flight promise", async () => {
		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		const provider = new RabbitMqTaskProvider({ reconnectTimeInSeconds: 0 });

		// Two overlapping calls — second must take the else branch and reuse the
		// same promise rather than calling amqplib.connect again.
		await Promise.all([provider.connect(), provider.connect()]);
		// And a third after the first resolved — still reuses the cached promise.
		await provider.connect();

		expect(mockConnect).toHaveBeenCalledTimes(1);

		await provider.disconnect(true);
	});

	test("second nackAmqp call is a no-op when multiple handlers both reject", async () => {
		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		let consumerCallback!: (msg: unknown) => Promise<void>;
		(channel.consume as Mock).mockImplementation(
			async (_queue: string, cb: (msg: unknown) => Promise<void>) => {
				consumerCallback = cb;
				return { consumerTag: "ctag-test" };
			},
		);

		const provider = new RabbitMqTaskProvider({
			reconnectTimeInSeconds: 0,
			retries: 0,
		});
		await provider.connect();

		// Two handlers on the same queue — both reject. The first reject triggers
		// nackAmqp (amqpHandled=true); the second must take the guard's else
		// branch and skip the channel.nack call.
		await provider.dequeue("q-double-reject", {
			id: "h1",
			handler: async (_task, ctx) => {
				await ctx.reject(false);
			},
		});
		await provider.dequeue("q-double-reject", {
			id: "h2",
			handler: async (_task, ctx) => {
				await ctx.reject(false);
			},
		});

		const task = { id: "t1", data: { message: "hi" } };
		const message = {
			content: Buffer.from(JSON.stringify(task)),
			properties: {},
			fields: {},
		};

		await consumerCallback(message);

		// Both handlers rejected, but the shared amqpHandled flag means
		// channel.nack fires exactly once — and moveToDeadLetter's sendToQueue
		// must also fire exactly once so the task isn't duplicated in the DLQ.
		expect(channel.nack).toHaveBeenCalledTimes(1);
		expect(channel.sendToQueue).toHaveBeenCalledTimes(1);

		await provider.disconnect(true);
	});

	test("outer timeout callback skips reject when handler already acked", async () => {
		vi.useFakeTimers();

		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		let consumerCallback!: (msg: unknown) => Promise<void>;
		(channel.consume as Mock).mockImplementation(
			async (_queue: string, cb: (msg: unknown) => Promise<void>) => {
				consumerCallback = cb;
				return { consumerTag: "ctag-test" };
			},
		);

		// Short outer timeout; handler acks then lingers past the timeout
		const provider = new RabbitMqTaskProvider({
			reconnectTimeInSeconds: 0,
			timeout: 50,
		});
		await provider.connect();

		let released!: () => void;
		const handlerDone = new Promise<void>((resolve) => {
			released = resolve;
		});

		await provider.dequeue("q-outer-timeout", {
			id: "h1",
			handler: async (_task, ctx) => {
				await ctx.ack();
				await handlerDone;
			},
		});

		const task = { id: "t1", data: { message: "hi" } };
		const message = {
			content: Buffer.from(JSON.stringify(task)),
			properties: {},
			fields: {},
		};

		const processing = consumerCallback(message);

		// Let the handler run and call ack, then fire the outer timeout
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(100);

		// Release the handler so it can finish
		released();
		await processing;

		// Outer timeout fired while acknowledged=true → should NOT nack
		expect(channel.ack).toHaveBeenCalledTimes(1);
		expect(channel.nack).not.toHaveBeenCalled();

		await provider.disconnect(true);
	});

	test("enqueue rejects when broker returns confirm error", async () => {
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

		const provider = new RabbitMqTaskProvider({
			reconnectTimeInSeconds: 0,
		});

		await expect(
			provider.enqueue("q-nack", { data: { hello: "world" } }),
		).rejects.toThrow("broker nack");

		await provider.disconnect(true);
	});

	test("moveToDeadLetter rejects when broker returns confirm error", async () => {
		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		const provider = new RabbitMqTaskProvider({
			reconnectTimeInSeconds: 0,
		});

		// Only fail sendToQueue when writing to the DLQ; initial enqueue must succeed.
		(channel.sendToQueue as Mock).mockImplementation(
			(
				queue: string,
				_content: Buffer,
				_options: unknown,
				callback?: (error: Error | null) => void,
			) => {
				if (queue.endsWith(":dead-letter")) {
					callback?.(new Error("dlq nack"));
				} else {
					callback?.(null);
				}

				return true;
			},
		);

		await expect(
			(
				provider as unknown as {
					moveToDeadLetter(q: string, t: Task): Promise<void>;
				}
			).moveToDeadLetter("q-dlq", { id: "t1", data: {} }),
		).rejects.toThrow("dlq nack");

		await provider.disconnect(true);
	});

	test("ctx.reject still nacks the original delivery when republish fails", async () => {
		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		let consumerCallback!: (message: unknown) => Promise<void>;
		(channel.consume as Mock).mockImplementation(
			async (_queue: string, cb: (message: unknown) => Promise<void>) => {
				consumerCallback = cb;
				return { consumerTag: "ctag-test" };
			},
		);

		// Fail every sendToQueue — both the retry republish and any DLQ write.
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

		const errors: unknown[] = [];
		const provider = new RabbitMqTaskProvider({
			reconnectTimeInSeconds: 0,
			retries: 3,
		});
		provider.on("error", (error: unknown) => {
			errors.push(error);
		});

		await provider.dequeue("q-republish-fail", {
			id: "h1",
			handler: async (_task, ctx) => {
				await ctx.reject(true);
			},
		});

		const task = { id: "t1", data: { hello: "world" } };
		const message = {
			content: Buffer.from(JSON.stringify(task)),
			properties: {},
			fields: {},
		};

		await consumerCallback(message);

		// Broker confirm failed, but the consumer must still nack so prefetch
		// doesn't stall. The emitted error gives observability.
		expect(channel.nack).toHaveBeenCalledTimes(1);
		expect(errors).toHaveLength(1);
		expect((errors[0] as Error).message).toBe("broker nack");

		await provider.disconnect(true);
	});

	test("connect() gates concurrent callers through a single connection", async () => {
		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		const provider = new RabbitMqTaskProvider({
			reconnectTimeInSeconds: 0,
		});

		await Promise.all([
			provider.connect(),
			provider.connect(),
			provider.connect(),
			provider.connect(),
		]);

		expect(mockConnect).toHaveBeenCalledTimes(1);

		await provider.disconnect(true);
	});

	test("close handler clears _connectionPromise so the next connect reconnects", async () => {
		const channel1 = createMockChannel();
		const connection1 = createMockConnection(channel1);
		const channel2 = createMockChannel();
		const connection2 = createMockConnection(channel2);

		mockConnect
			.mockResolvedValueOnce(connection1)
			.mockResolvedValueOnce(connection2);

		const provider = new RabbitMqTaskProvider({
			reconnectTimeInSeconds: 0,
		});
		await provider.connect();
		expect(mockConnect).toHaveBeenCalledTimes(1);

		// Simulate the connection closing. With reconnectTimeInSeconds=0 there
		// is no auto-reconnect, so the next connect() must open a fresh one.
		connection1.emit("close");

		await provider.connect();
		expect(mockConnect).toHaveBeenCalledTimes(2);

		await provider.disconnect(true);
	});
});
