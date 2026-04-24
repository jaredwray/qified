import {
	afterEach,
	beforeEach,
	describe,
	expect,
	type Mock,
	test,
	vi,
} from "vitest";
import { NatsMessageProvider } from "../src/index.js";

vi.mock("@nats-io/transport-node", () => ({
	connect: vi.fn(),
}));

function createMockConnection() {
	return {
		publish: vi.fn(),
		flush: vi.fn().mockResolvedValue(undefined),
		subscribe: vi.fn().mockReturnValue({
			[Symbol.asyncIterator]() {
				return { next: async () => ({ value: undefined, done: true }) };
			},
			unsubscribe: vi.fn(),
		}),
		close: vi.fn().mockResolvedValue(undefined),
	};
}

let mockConnect: Mock;

beforeEach(async () => {
	const transport = await import("@nats-io/transport-node");
	mockConnect = transport.connect as unknown as Mock;
	mockConnect.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("NatsMessageProvider (edge cases requiring mocks)", () => {
	test("concurrent createConnection calls share a single underlying connect", async () => {
		let resolveConnect!: (value: unknown) => void;
		const pending = new Promise((resolve) => {
			resolveConnect = resolve;
		});
		mockConnect.mockReturnValue(pending);

		const provider = new NatsMessageProvider({ reconnectTimeInSeconds: 0 });

		// Kick off many concurrent callers before the first resolves. They must
		// all be gated by the shared _connectionPromise so only one underlying
		// connect() call happens — opening multiple NATS connections would leak.
		const pendings = [
			provider.createConnection(),
			provider.createConnection(),
			provider.createConnection(),
			provider.createConnection(),
		];

		resolveConnect(createMockConnection());
		await Promise.all(pendings);

		expect(mockConnect).toHaveBeenCalledTimes(1);

		await provider.disconnect();
	});

	test("failed connect clears the cached promise so the next call retries", async () => {
		mockConnect
			.mockRejectedValueOnce(new Error("connect refused"))
			.mockResolvedValueOnce(createMockConnection());

		const provider = new NatsMessageProvider({ reconnectTimeInSeconds: 0 });

		await expect(provider.createConnection()).rejects.toThrow(
			"connect refused",
		);

		// After a failed attempt, a retry should open a fresh connect — not
		// resolve immediately against the cached rejected promise.
		await provider.createConnection();
		expect(mockConnect).toHaveBeenCalledTimes(2);

		await provider.disconnect();
	});

	test("uri setter resets the cached connection promise", async () => {
		const connection1 = createMockConnection();
		const connection2 = createMockConnection();
		mockConnect
			.mockResolvedValueOnce(connection1)
			.mockResolvedValueOnce(connection2);

		const provider = new NatsMessageProvider({
			uri: "localhost:4222",
			reconnectTimeInSeconds: 0,
		});
		await provider.createConnection();
		expect(mockConnect).toHaveBeenCalledWith(
			expect.objectContaining({ servers: "localhost:4222" }),
		);

		// Changing URI must drop the cached promise so the next createConnection
		// opens a fresh connection against the new URI — otherwise publish/
		// subscribe would keep using the old connection.
		provider.uri = "localhost:5555";

		await provider.createConnection();
		expect(mockConnect).toHaveBeenCalledTimes(2);
		expect(mockConnect).toHaveBeenLastCalledWith(
			expect.objectContaining({ servers: "localhost:5555" }),
		);

		await provider.disconnect();
	});

	test("createConnection rejects while a disconnect is in flight", async () => {
		let resolveConnect!: (value: unknown) => void;
		const pending = new Promise((resolve) => {
			resolveConnect = resolve;
		});
		mockConnect.mockReturnValue(pending);

		const provider = new NatsMessageProvider({ reconnectTimeInSeconds: 0 });

		// Kick off a connect that won't resolve until we say so.
		const firstConnect = provider.createConnection();

		// disconnect() sets _closing synchronously, then awaits the pending
		// connect. While it's parked on that await, a concurrent createConnection
		// must fail fast — otherwise it would race past disconnect's cleanup and
		// leak a live connection the caller assumes ownership of.
		const disconnectPromise = provider.disconnect();

		await expect(provider.createConnection()).rejects.toThrow(
			"Provider is disconnecting",
		);

		resolveConnect(createMockConnection());
		await firstConnect;
		await disconnectPromise;
	});

	test("subscribe racing a disconnect bails out and leaves no stale entries", async () => {
		let resolveConnect!: (value: unknown) => void;
		const pending = new Promise((resolve) => {
			resolveConnect = resolve;
		});
		const connection1 = createMockConnection();
		const connection2 = createMockConnection();
		mockConnect.mockReturnValueOnce(pending).mockResolvedValueOnce(connection2);

		const provider = new NatsMessageProvider({ reconnectTimeInSeconds: 0 });

		// subscribe() is parked on createConnection()'s await.
		const subscribePromise = provider.subscribe("topic-a", {
			id: "h1",
			handler: async () => {},
		});

		// disconnect() sets _closing, then awaits the same connection promise.
		const disconnectPromise = provider.disconnect();

		// When the connect resolves, both awaits resume. subscribe() must see
		// _closing=true and refuse to touch subscription state — otherwise it
		// would leave stale map entries that cause a later subscribe() on the
		// same topic to skip the real NATS subscription.
		resolveConnect(connection1);
		await expect(subscribePromise).rejects.toThrow("Provider is disconnecting");
		await disconnectPromise;

		expect(provider.subscriptions.size).toBe(0);
		expect(connection1.subscribe).not.toHaveBeenCalled();

		// Prove the hazard is gone: a new subscribe on the same topic must open
		// a real NATS subscription on the new connection.
		await provider.subscribe("topic-a", { id: "h2", handler: async () => {} });
		expect(connection2.subscribe).toHaveBeenCalledWith("topic-a");

		await provider.disconnect();
	});

	test("disconnect clears the cached connection promise", async () => {
		const connection1 = createMockConnection();
		const connection2 = createMockConnection();
		mockConnect
			.mockResolvedValueOnce(connection1)
			.mockResolvedValueOnce(connection2);

		const provider = new NatsMessageProvider({ reconnectTimeInSeconds: 0 });
		await provider.createConnection();
		await provider.disconnect();

		// After disconnect(), a fresh createConnection() must open a new
		// underlying connection rather than resolving against the cached promise.
		await provider.createConnection();
		expect(mockConnect).toHaveBeenCalledTimes(2);

		await provider.disconnect();
	});
});
