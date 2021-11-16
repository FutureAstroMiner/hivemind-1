declare global {
	interface Creep {
		operation?: Operation;
	}

	interface Memory {
		operations: {
			[name: string]: OperationMemory;
		};
	}

	interface CreepMemory {
		operation?: string;
	}

	interface Game {
		operations: {
			[key: string]: Operation;
		};
		operationsByType: {
			mining: {
				[key: string]: RemoteMiningOperation;
			};
			room: {
				[key: string]: RoomOperation;
			};
			[key: string]: {
				[key: string]: Operation;
			};
		};
	}

	interface OperationMemory {
		type: string;
		lastActive: number;
		roomName?: string;
		shouldTerminate?: boolean;
		currentTick: number;
		statTicks: number;
		stats: {
			[resourceType: string]: number,
		}
	}

	interface DefaultOperationMemory extends OperationMemory {
		type: 'default';
	}
}

import RemoteMiningOperation from 'operation/remote-mining';
import RoomOperation from 'operation/room';

export default class Operation {
	name: string;
	roomName?: string;
	memory: OperationMemory;

	constructor(name: string) {
		if (!Memory.operations) Memory.operations = {};
		if (!Memory.operations[name]) Memory.operations[name] = {} as OperationMemory;

		this.name = name;
		this.memory = Memory.operations[name];
		this.memory.type = 'default';
		this.memory.lastActive = Game.time;

		if (this.memory.roomName) {
			this.roomName = this.memory.roomName;
		}

		if (!this.memory.stats) this.memory.stats = {};
	}

	getType(): string {
		return this.memory.type || 'default';
	}

	setRoom(roomName: string) {
		this.memory.roomName = roomName;
		this.roomName = roomName;
	}

	getRoom(): string {
		return this.roomName;
	}

	terminate() {
		this.memory.shouldTerminate = true;
		this.onTerminate();
	}

	onTerminate() {
		// This space intentionally left blank.
	}

	addCpuCost(amount: number) {
		this.recordStatChange(amount, 'cpu');
	}

	addResourceCost(amount: number, resourceType: string) {
		this.recordStatChange(-amount, resourceType);
	}

	addResourceGain(amount: number, resourceType: string) {
		this.recordStatChange(amount, resourceType);
	}

	recordStatChange(amount: number, resourceType: string) {
		if (this.memory.currentTick !== Game.time) {
			this.memory.currentTick = Game.time;
			this.memory.statTicks = (this.memory.statTicks || 0) + 1;

			// @todo reset stats every n ticks.
		}

		this.memory.stats[resourceType] = (this.memory.stats[resourceType] || 0) + amount;
	}
}
