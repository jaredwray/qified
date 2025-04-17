import { Message, MessageProvider, Task, TaskProvider } from "types.js";


export class MemoryMessageProvider implements MessageProvider {
	public subscribers: Array<{topic: string; handler: (message: Message) => Promise<void>}> = [];

	public async init(config: Record<string, any>): Promise<void> {
		// No initialization needed for memory provider
	}

	public async publish(topic: string, message: Message): Promise<void> {
		for (const subscriber of this.subscribers) {
			if (subscriber.topic === topic) {
				await subscriber.handler(message);
			}
		}
	}

	public async subscribe(topic: string, handler: (message: Message) => Promise<void>): Promise<void> {
		this.subscribers.push({ topic, handler });
	}

	public async disconnect(): Promise<void> {
		this.subscribers = [];
	}
}

export class MemoryTaskProvider implements TaskProvider {
	public tasks: Array<Task> = [];
	public taskHandlers: Array<{ taskName: string; handler: (payload: Task) => Promise<void> }> = [];

	public async init(config: Record<string, any>): Promise<void> {
		// No initialization needed for memory provider
	}

	public async enqueue(task: Task): Promise<void> {
		this.tasks.push(task);
	}

	public async dequeue(taskName: string, handler: (payload: Task) => Promise<void>): Promise<void> {
		this.taskHandlers.push({ taskName, handler });
		const taskIndex = this.tasks.findIndex(task => task.id === taskName);
		if (taskIndex !== -1) {
			const task = this.tasks.splice(taskIndex, 1)[0];
			await handler(task.data);
		}
	}

	public async disconnect(): Promise<void> {
		this.tasks = [];
		this.taskHandlers = [];
	}
}