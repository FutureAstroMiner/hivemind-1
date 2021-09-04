declare global {
	interface Memory {
		operations: any,
	}

	interface CreepMemory {
		operation?: string,
	}

	interface Game {
		operations: {
			[key: string]: Operation,
		},
		operationsByType: {
			mining: {
				[key: string]: RemoteMiningOperation,
			},
			room: {
				[key: string]: RoomOperation,
			},
			[key: string]: {
				[key: string]: Operation,
			},
		},
	}
}

import RemoteMiningOperation from 'operation.remote-mining';
import RoomOperation from 'operation.room';

export default class Operation {
	name: string;
	roomName?: string;
	memory: any;

	constructor(name) {
		if (!Memory.operations) Memory.operations = {};
		if (!Memory.operations[name]) Memory.operations[name] = {};

		this.name = name;
		this.memory = Memory.operations[name];
		this.memory.type = 'default';
		this.memory.lastActive = Game.time;

		if (this.memory.roomName) {
			this.roomName = this.memory.roomName;
		}

		if (!this.memory.stats) this.memory.stats = {};
	}

	getType() {
		return this.memory.type || 'default';
	}

	setRoom(roomName) {
		this.memory.roomName = roomName;
		this.roomName = roomName;
	}

	getRoom() {
		return this.roomName;
	}

	terminate() {
		this.memory.shouldTerminate = true;
		this.onTerminate();
	}

	onTerminate() {
		// This space intentionally left blank.
	}

	addCpuCost(amount) {
		this.recordStatChange(amount, 'cpu');
	}

	addResourceCost(amount, resourceType) {
		this.recordStatChange(-amount, resourceType);
	}

	addResourceGain(amount, resourceType) {
		this.recordStatChange(amount, resourceType);
	}

	recordStatChange(amount, resourceType) {
		if (this.memory.currentTick !== Game.time) {
			this.memory.currentTick = Game.time;
			this.memory.statTicks = (this.memory.statTicks || 0) + 1;

			// @todo reset stats every n ticks.
		}

		this.memory.stats[resourceType] = (this.memory.stats[resourceType] || 0) + amount;
	}
};
