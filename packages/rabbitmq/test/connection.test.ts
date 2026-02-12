import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
import type { Channel, ChannelModel } from "amqplib";
import { type Message, Qified } from "qified";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	type Mock,
	test,
	vi,
} from "vitest";
import {
	createQified,
	defaultReconnectTimeInSeconds,
	RabbitMqMessageProvider,
} from "../src/index.js";

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

describe("RabbitMqMessageProvider (mocked connection)", () => {
	test("should get and set id", () => {
		const provider = new RabbitMqMessageProvider();
		expect(provider.id).toBe("@qified/rabbitmq");
		provider.id = "custom-id";
		expect(provider.id).toBe("custom-id");
	});

	test("should get and set uri", () => {
		const provider = new RabbitMqMessageProvider();
		expect(provider.uri).toBe("amqp://localhost:5672");
		provider.uri = "amqp://other:5672";
		expect(provider.uri).toBe("amqp://other:5672");
	});

	test("should get and set reconnectTimeInSeconds", () => {
		const provider = new RabbitMqMessageProvider();
		expect(provider.reconnectTimeInSeconds).toBe(defaultReconnectTimeInSeconds);
		provider.reconnectTimeInSeconds = 10;
		expect(provider.reconnectTimeInSeconds).toBe(10);
	});

	test("should create Qified instance via createQified", () => {
		const qified = createQified();
		expect(qified).toBeInstanceOf(Qified);
		expect(qified.messageProviders.length).toBe(1);
		expect(qified.messageProviders[0]).toBeInstanceOf(RabbitMqMessageProvider);
	});

	test("should reconnect if connection exists but channel is missing", async () => {
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

		// Verify connection is set
		const internal = provider as unknown as {
			_connection: unknown;
			_channel: unknown;
		};
		expect(internal._connection).toBe(connection1);

		// Clear only the channel but keep the connection
		// This tests the `|| !this._channel` branch on line 128
		internal._channel = undefined;
		expect(internal._connection).toBe(connection1);

		const result = await provider.getClient();
		expect(result).toBe(channel2);
		expect(mockConnect).toHaveBeenCalledTimes(2);

		await provider.disconnect();
	});

	test("should connect and return channel from getClient", async () => {
		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		const provider = new RabbitMqMessageProvider();
		const result = await provider.getClient();
		expect(result).toBe(channel);
		expect(mockConnect).toHaveBeenCalledWith("amqp://localhost:5672");

		await provider.disconnect();
	});

	test("should return existing channel on second getClient call", async () => {
		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		const provider = new RabbitMqMessageProvider();
		const first = await provider.getClient();
		const second = await provider.getClient();
		expect(first).toBe(second);
		expect(mockConnect).toHaveBeenCalledTimes(1);

		await provider.disconnect();
	});

	test("should return same channel from getChannel", async () => {
		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		const provider = new RabbitMqMessageProvider();
		const result = await provider.getChannel();
		expect(result).toBe(channel);

		await provider.disconnect();
	});

	test("should publish a message", async () => {
		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		const provider = new RabbitMqMessageProvider();
		const message: Message = { id: "1", data: "hello" };
		await provider.publish("test-topic", message);

		expect(channel.assertQueue).toHaveBeenCalledWith("test-topic");
		expect(channel.sendToQueue).toHaveBeenCalledWith(
			"test-topic",
			expect.any(Buffer),
		);

		const sentBuffer = (channel.sendToQueue as Mock).mock.calls[0][1];
		const parsed = JSON.parse(sentBuffer.toString());
		expect(parsed.providerId).toBe("@qified/rabbitmq");
		expect(parsed.data).toBe("hello");

		await provider.disconnect();
	});

	test("should subscribe and setup consumer", async () => {
		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		const provider = new RabbitMqMessageProvider();
		const handler = {
			id: "h1",
			handler: vi.fn().mockResolvedValue(undefined),
		};
		await provider.subscribe("my-topic", handler);

		expect(channel.assertQueue).toHaveBeenCalledWith("my-topic");
		expect(channel.consume).toHaveBeenCalledWith(
			"my-topic",
			expect.any(Function),
		);
		expect(provider.subscriptions.has("my-topic")).toBe(true);
		expect(provider.consumerTags.has("my-topic")).toBe(true);

		await provider.disconnect();
	});

	test("should dispatch messages to handlers via consumer callback", async () => {
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
		await provider.subscribe("my-topic", {
			id: "h1",
			handler: async (msg) => {
				received.push(msg);
			},
		});

		const testMessage: Message = {
			id: "1",
			data: "test",
			providerId: "@qified/rabbitmq",
		};
		const fakeMsg = {
			content: Buffer.from(JSON.stringify(testMessage)),
		};

		// biome-ignore lint/style/noNonNullAssertion: set by mock
		await consumerCallback!(fakeMsg);
		expect(received).toHaveLength(1);
		expect(received[0]).toEqual(testMessage);
		expect(channel.ack).toHaveBeenCalledWith(fakeMsg);

		// null message should be ignored
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
		await provider.subscribe("my-topic", {
			id: "h1",
			handler: async () => {},
		});

		// Clear subscriptions to simulate the ?? [] fallback path
		provider.subscriptions.delete("my-topic");

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

	test("should add second handler to same topic without re-consuming", async () => {
		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		const provider = new RabbitMqMessageProvider();
		await provider.subscribe("topic", {
			id: "h1",
			handler: async () => {},
		});
		await provider.subscribe("topic", {
			id: "h2",
			handler: async () => {},
		});

		// consume should only be called once per topic
		expect(channel.consume).toHaveBeenCalledTimes(1);
		expect(provider.subscriptions.get("topic")?.length).toBe(2);

		await provider.disconnect();
	});

	test("should unsubscribe by handler id", async () => {
		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		const provider = new RabbitMqMessageProvider();
		await provider.subscribe("topic", {
			id: "h1",
			handler: async () => {},
		});
		await provider.subscribe("topic", {
			id: "h2",
			handler: async () => {},
		});

		await provider.unsubscribe("topic", "h1");
		const remaining = provider.subscriptions.get("topic");
		expect(remaining?.length).toBe(1);
		expect(remaining?.[0].id).toBe("h2");

		// cancel should NOT have been called — only removed from handler list
		expect(channel.cancel).not.toHaveBeenCalled();

		await provider.disconnect();
	});

	test("should unsubscribe all handlers and cancel consumer", async () => {
		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		(channel.consume as Mock).mockResolvedValue({ consumerTag: "ctag-1" });

		const provider = new RabbitMqMessageProvider();
		await provider.subscribe("topic", {
			id: "h1",
			handler: async () => {},
		});

		await provider.unsubscribe("topic");
		expect(channel.cancel).toHaveBeenCalledWith("ctag-1");
		expect(provider.subscriptions.has("topic")).toBe(false);
		expect(provider.consumerTags.has("topic")).toBe(false);

		await provider.disconnect();
	});

	test("should unsubscribe with no matching topic gracefully", async () => {
		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		const provider = new RabbitMqMessageProvider();
		// Force connection so getChannel works
		await provider.getClient();

		// Unsubscribe by id on nonexistent topic
		await provider.unsubscribe("nonexistent", "h1");
		expect(provider.subscriptions.has("nonexistent")).toBe(false);

		// Unsubscribe all on topic with no consumer tag
		await provider.unsubscribe("nonexistent");
		expect(channel.cancel).not.toHaveBeenCalled();

		await provider.disconnect();
	});

	test("should disconnect and cancel all consumer tags", async () => {
		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		(channel.consume as Mock)
			.mockResolvedValueOnce({ consumerTag: "ctag-a" })
			.mockResolvedValueOnce({ consumerTag: "ctag-b" });

		const provider = new RabbitMqMessageProvider();
		await provider.subscribe("topic-a", {
			handler: async () => {},
		});
		await provider.subscribe("topic-b", {
			handler: async () => {},
		});

		await provider.disconnect();

		expect(channel.cancel).toHaveBeenCalledWith("ctag-a");
		expect(channel.cancel).toHaveBeenCalledWith("ctag-b");
		expect(channel.close).toHaveBeenCalled();
		expect(connection.close).toHaveBeenCalled();
		expect(provider.subscriptions.size).toBe(0);
		expect(provider.consumerTags.size).toBe(0);
	});

	test("should not schedule reconnect when close fires during disconnect", async () => {
		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		// Make connection.close() emit "close" event (simulates real amqplib behavior)
		(connection.close as Mock).mockImplementation(async () => {
			connection.emit("close");
		});

		const provider = new RabbitMqMessageProvider({
			reconnectTimeInSeconds: 1,
		});
		await provider.getClient();

		mockConnect.mockClear();
		// disconnect sets _closing = true, then calls connection.close()
		// which emits "close" — the handler should NOT schedule reconnect
		await provider.disconnect();

		// No reconnection should have been scheduled
		expect(mockConnect).not.toHaveBeenCalled();
	});

	test("should clear pending reconnect timer on disconnect", async () => {
		vi.useFakeTimers();

		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		const provider = new RabbitMqMessageProvider({
			reconnectTimeInSeconds: 1,
		});
		await provider.getClient();

		// Simulate connection close to trigger reconnect scheduling
		connection.emit("close");

		// Disconnect before the reconnect timer fires
		await provider.disconnect();

		// Advance timers — reconnect should NOT happen
		mockConnect.mockClear();
		await vi.advanceTimersByTimeAsync(2000);
		expect(mockConnect).not.toHaveBeenCalled();
	});

	test("should not schedule reconnect when reconnectTimeInSeconds is 0", async () => {
		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		const provider = new RabbitMqMessageProvider({
			reconnectTimeInSeconds: 0,
		});
		await provider.getClient();

		mockConnect.mockClear();
		// Simulate connection close
		connection.emit("close");

		// Wait a tick — no reconnect should be scheduled
		await new Promise<void>((resolve) => {
			setTimeout(resolve, 10);
		});
		expect(mockConnect).not.toHaveBeenCalled();
	});

	test("should reconnect and re-establish subscriptions after connection loss", async () => {
		vi.useFakeTimers();

		const channel1 = createMockChannel();
		const connection1 = createMockConnection(channel1);

		const channel2 = createMockChannel();
		const connection2 = createMockConnection(channel2);

		mockConnect
			.mockResolvedValueOnce(connection1)
			.mockResolvedValueOnce(connection2);

		const provider = new RabbitMqMessageProvider({
			reconnectTimeInSeconds: 1,
		});

		await provider.subscribe("my-topic", {
			id: "h1",
			handler: async () => {},
		});

		expect(channel1.assertQueue).toHaveBeenCalledWith("my-topic");
		expect(channel1.consume).toHaveBeenCalledTimes(1);

		// Simulate connection loss
		connection1.emit("close");

		// Advance past reconnect delay
		await vi.advanceTimersByTimeAsync(1500);

		// Should have reconnected and re-established the consumer
		expect(mockConnect).toHaveBeenCalledTimes(2);
		expect(channel2.assertQueue).toHaveBeenCalledWith("my-topic");
		expect(channel2.consume).toHaveBeenCalledTimes(1);

		await provider.disconnect();
	});

	test("should retry reconnection on failure", async () => {
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

	test("should not reconnect if closing flag is set when timer fires", async () => {
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

		// Set _closing before the timer fires to simulate the race condition
		// where disconnect starts between timer scheduling and execution
		(provider as unknown as { _closing: boolean })._closing = true;

		mockConnect.mockClear();
		// Advance past reconnect delay — timer fires but _attemptReconnect bails
		await vi.advanceTimersByTimeAsync(1500);
		expect(mockConnect).not.toHaveBeenCalled();

		// Reset _closing so cleanup works
		(provider as unknown as { _closing: boolean })._closing = false;
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

		// Verify that the error handler is registered
		expect(connection.listenerCount("error")).toBe(1);
		expect(connection.listenerCount("close")).toBe(1);

		// Emit error event — handler is a no-op but should not throw
		connection.emit("error", new Error("Socket closed"));

		// Close event triggers reconnection
		connection.emit("close");

		await vi.advanceTimersByTimeAsync(1500);
		// Should have reconnected once
		expect(mockConnect).toHaveBeenCalledTimes(2);

		await provider.disconnect();
	});

	test("should work with Qified through mocked connection", async () => {
		const channel = createMockChannel();
		const connection = createMockConnection(channel);
		mockConnect.mockResolvedValue(connection);

		let consumerCallback: ((msg: unknown) => Promise<void>) | undefined;
		(channel.consume as Mock).mockImplementation(
			async (_queue: string, cb: (msg: unknown) => Promise<void>) => {
				consumerCallback = cb;
				return { consumerTag: "ctag-qified" };
			},
		);

		const provider = new RabbitMqMessageProvider();
		const qified = new Qified({ messageProviders: [provider] });

		let received: Message | undefined;
		await qified.subscribe("topic", {
			id: "h1",
			handler: async (msg) => {
				received = msg;
			},
		});

		expect(consumerCallback).toBeDefined();

		// Simulate receiving a message
		const testMessage: Message = {
			id: "42",
			data: { foo: "bar" },
			providerId: "@qified/rabbitmq",
		};
		// biome-ignore lint/style/noNonNullAssertion: verified defined above
		await consumerCallback!({
			content: Buffer.from(JSON.stringify(testMessage)),
		});

		expect(received).toEqual(testMessage);

		await qified.disconnect();
	});
});
