/* global RoomPosition FIND_FLAGS LOOK_STRUCTURES OBSTACLE_OBJECT_TYPES
STRUCTURE_RAMPART */

declare global {
	interface DismantlerCreep extends Creep {
		memory: DismantlerCreepMemory;
		heapMemory: DismantlerCreepHeapMemory;
	}

	interface DismantlerCreepMemory extends CreepMemory {
		role: 'dismantler';
		sourceRoom: string;
		targetRoom: string;
		source: string;
	}

	interface DismantlerCreepHeapMemory extends CreepHeapMemory {
		finishedPositions: string[];
		disabledNotifications: Id<Structure>[];
	}
}

import RemoteMiningOperation from 'operation/remote-mining';
import Role from 'role/role';
import {encodePosition} from 'utils/serialization';

export default class DismantlerRole extends Role {
	/**
	 * Makes a creep behave like a dismantler.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: DismantlerCreep) {
		if (!creep.memory.sourceRoom) {
			creep.memory.sourceRoom = creep.pos.roomName;
		}

		if (!creep.memory.targetRoom) {
			creep.memory.targetRoom = creep.pos.roomName;
		}

		if (!creep.heapMemory.disabledNotifications) creep.heapMemory.disabledNotifications = [];

		if (!this.performOperationDismantle(creep)) this.performDismantle(creep);
		return;
	}

	/**
	 * Dismantles structures blocking an operation.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	performOperationDismantle(creep: DismantlerCreep): boolean {
		if (!creep.operation) return false;
		if (!(creep.operation instanceof RemoteMiningOperation)) return false;

		if (!creep.heapMemory.finishedPositions) creep.heapMemory.finishedPositions = [];
		if (!creep.operation.needsDismantler(creep.memory.source)) {
			// @todo Return home and suicide.
			const targetPos = new RoomPosition(24, 24, creep.memory.sourceRoom);
			if (targetPos.roomName === creep.pos.roomName && creep.pos.getRangeTo(targetPos) <= 20) return true;

			creep.moveToRange(targetPos, 20);
			return true;
		}

		const targetPositions = creep.operation.getDismantlePositions(creep.memory.source);
		let target;
		for (const pos of targetPositions) {
			if (creep.heapMemory.finishedPositions.indexOf(encodePosition(pos)) !== -1) continue;

			if (pos.roomName === creep.pos.roomName) {
				const structures = _.filter(
					pos.lookFor(LOOK_STRUCTURES),
					(s: AnyStructure) => (OBSTACLE_OBJECT_TYPES as string[]).indexOf(s.structureType) !== -1 || (s.structureType === STRUCTURE_RAMPART && !s.my)
				);

				if (structures.length === 0) {
					creep.heapMemory.finishedPositions.push(encodePosition(pos));
					continue;
				}
			}

			target = pos;
			break;
		}

		if (!target) {
			// Just to be sure, start again from the top.
			delete creep.heapMemory.finishedPositions;
			return true;
		}

		if (creep.pos.roomName !== target.roomName || creep.pos.getRangeTo(target) > 1) {
			// Get into range of target tile.
			creep.moveToRange(target, 1);
			return true;
		}

		const structures = _.filter(
			target.lookFor(LOOK_STRUCTURES),
			(s: AnyStructure) => (OBSTACLE_OBJECT_TYPES as string[]).indexOf(s.structureType) !== -1 || (s.structureType === STRUCTURE_RAMPART && !s.my)
		);

		if (!creep.heapMemory.disabledNotifications.includes(structures[0].id)) {
			creep.heapMemory.disabledNotifications.push(structures[0].id);
			structures[0].notifyWhenAttacked(false);
		}

		creep.dismantle(structures[0]);
		return true;
	}

	/**
	 * Makes the creep use energy to finish construction sites in the current room.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	performDismantle(creep: DismantlerCreep) {
		// First, get to target room.
		const targetPos = new RoomPosition(25, 25, creep.memory.targetRoom);
		if (creep.interRoomTravel(targetPos)) return;
		if (creep.pos.roomName !== creep.memory.targetRoom) return;

		if (!creep.room.roomManager || !creep.room.roomManager.needsDismantling()) return;

		const target = creep.room.roomManager.getDismantleTarget();
		if (!target) return;

		if (!creep.heapMemory.disabledNotifications.includes(target.id)) {
			creep.heapMemory.disabledNotifications.push(target.id);
			target.notifyWhenAttacked(false);
		}

		creep.whenInRange(1, target, () => creep.dismantle(target));
	}
}
