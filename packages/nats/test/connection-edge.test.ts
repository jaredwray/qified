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
