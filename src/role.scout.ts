/* global RoomPosition OK */

declare global {
	interface ScoutCreep extends Creep {
		memory: ScoutCreepMemory,
		heapMemory: ScoutCreepHeapMemory,
	}

	interface ScoutCreepMemory extends CreepMemory {
		role: 'scout',
		disableNotifications?: boolean,
		scoutTarget?: string,
		portalTarget?: string,
		invalidScoutTargets?: string[],
	}

	interface ScoutCreepHeapMemory extends CreepHeapMemory {
		moveWithoutNavMesh?: boolean,
		_roomHistory: string[],
		_posHistory: string[],
		_lastPos: string,
		_stuckCount: number,
	}
}

import hivemind from 'hivemind';
import utilities from 'utilities';
import Role from 'role';

export default class ScoutRole extends Role {
	/**
	 * Makes a creep behave like a scout.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: ScoutCreep) {
		if (creep.memory.disableNotifications) {
			// No attack notifications for scouts, please.
			creep.notifyWhenAttacked(false);
			delete creep.memory.disableNotifications;
		}

		if (!creep.memory.scoutTarget && !creep.memory.portalTarget) {
			this.chooseScoutTarget(creep);
		}

		this.performScout(creep);
	}

	/**
	 * Makes this creep move between rooms to gather intel.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	performScout(creep: ScoutCreep) {
		if (creep.memory.portalTarget) {
			const portalPosition = utilities.decodePosition(creep.memory.portalTarget);
			if (creep.pos.roomName === portalPosition.roomName) {
				if (creep.pos.getRangeTo(portalPosition) > 1) {
					creep.moveToRange(portalPosition, 1);
				}
				else {
					creep.moveTo(portalPosition);
				}
			}
			else {
				creep.moveToRoom(portalPosition.roomName);
			}

			return;
		}

		if (!creep.memory.scoutTarget) {
			// Just stand around somewhere.
			const target = new RoomPosition(25, 25, creep.pos.roomName);
			if (creep.pos.getRangeTo(target) > 3) {
				creep.moveToRange(target, 3);
			}

			return;
		}

		if (typeof creep.room.visual !== 'undefined') {
			creep.room.visual.text(creep.memory.scoutTarget, creep.pos);
		}

		if (this.isOscillating(creep) || this.isStuck(creep)) this.chooseScoutTarget(creep, true);

		if (!creep.memory.scoutTarget) {
			// Just stand around somewhere.
			const target = new RoomPosition(25, 25, creep.pos.roomName);
			if (creep.pos.getRangeTo(target) > 3) {
				creep.moveToRange(target, 3);
			}

			return;
		}

		const targetPosition = new RoomPosition(25, 25, creep.memory.scoutTarget);
		const isInTargetRoom = creep.pos.roomName === targetPosition.roomName;
		if (creep.heapMemory.moveWithoutNavMesh) {
			if (!isInTargetRoom || !creep.isInRoom()) {
				if (!creep.moveToRoom(creep.memory.scoutTarget, true)) {
					this.chooseScoutTarget(creep, true);
				}

				return;
			}
		}
		else {
			if (!isInTargetRoom || (!creep.isInRoom() && creep.getNavMeshMoveTarget())) {
				if (creep.moveUsingNavMesh(targetPosition, {allowDanger: true}) !== OK) {
					hivemind.log('creeps').debug(creep.name, 'can\'t move from', creep.pos.roomName, 'to', targetPosition.roomName);

					// Try moving to target room without using nav mesh.
					creep.heapMemory.moveWithoutNavMesh = true;
				}

				return;
			}

			creep.stopNavMeshMove();
		}

		this.chooseScoutTarget(creep);
	}

	/**
	 * Chooses which of the possible scout target rooms to travel to.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {boolean} invalidateOldTarget
	 *   If true, the old scout target is deemed invalid and will no longer be
	 *   scouted by this creep.
	 */
	chooseScoutTarget(creep: ScoutCreep, invalidateOldTarget?: boolean) {
		if (creep.memory.scoutTarget && invalidateOldTarget) {
			if (!creep.memory.invalidScoutTargets) {
				creep.memory.invalidScoutTargets = [];
			}

			creep.memory.invalidScoutTargets.push(creep.memory.scoutTarget);
		}

		delete creep.memory.scoutTarget;
		delete creep.heapMemory.moveWithoutNavMesh;
		if (!creep.memory.origin) creep.memory.origin = creep.room.name;
		if (!Memory.strategy) return;
		if (!hivemind.segmentMemory.isReady()) return;

		let best = null;
		for (const info of _.values<any>(Memory.strategy.roomList)) {
			if (!info.roomName) continue;
			if (info.roomName === creep.pos.roomName) continue;
			if (creep.memory.invalidScoutTargets && creep.memory.invalidScoutTargets.indexOf(info.roomName) !== -1) continue;

			if (info.origin !== creep.memory.origin) continue;
			if (info.scoutPriority <= 0) continue;
			if (best && best.info.scoutPriority > info.scoutPriority) continue;

			const roomIntel = hivemind.roomIntel(info.roomName);
			const lastScout = roomIntel.getLastScoutAttempt();
			if (best && lastScout > best.lastScout) continue;

			// Check distance / path to room.
			const path = creep.calculateRoomPath(info.roomName, true);

			if (path) {
				best = {info, lastScout};
			}
		}

		if (best) {
			creep.memory.scoutTarget = best.info.roomName;
			const roomIntel = hivemind.roomIntel(best.info.roomName);
			roomIntel.registerScoutAttempt();
		}

		if (!creep.memory.scoutTarget) {
			creep.memory.scoutTarget = creep.memory.origin;
		}
	}

	isOscillating(creep: ScoutCreep) {
		if (!creep.heapMemory._roomHistory) creep.heapMemory._roomHistory = [];
		const history = creep.heapMemory._roomHistory;

		if (history.length === 0 || history[history.length - 1] !== creep.pos.roomName) history.push(creep.pos.roomName);
		if (history.length > 20) creep.heapMemory._roomHistory = history.slice(-10);

		if (
			history.length >= 10 &&
			history[history.length - 1] === history[history.length - 3] &&
			history[history.length - 2] === history[history.length - 4] &&
			history[history.length - 3] === history[history.length - 5] &&
			history[history.length - 4] === history[history.length - 6] &&
			history[history.length - 5] === history[history.length - 7] &&
			history[history.length - 6] === history[history.length - 8] &&
			history[history.length - 7] === history[history.length - 9] &&
			history[history.length - 8] === history[history.length - 10]
		) {
			delete creep.heapMemory._roomHistory;
			return true;
		}

		return this.isTileOscillating(creep);
	}

	isTileOscillating(creep: ScoutCreep) {
		if (!creep.heapMemory._posHistory) creep.heapMemory._posHistory = [];
		const history = creep.heapMemory._posHistory;
		const pos = utilities.encodePosition(creep.pos);

		if (history.length === 0 || history[history.length - 1] !== pos) history.push(pos);
		if (history.length > 30) creep.heapMemory._posHistory = history.slice(-20);
		if (_.filter(history, v => v === pos).length >= 5) {
			delete creep.heapMemory._posHistory;
			return true;
		}

		return false;
	}

	isStuck(creep: ScoutCreep) {
		const pos = utilities.encodePosition(creep.pos);

		if (!creep.heapMemory._lastPos || creep.heapMemory._lastPos !== pos) {
			creep.heapMemory._lastPos = pos;
			creep.heapMemory._stuckCount = 1;
			return false;
		}

		if (creep.heapMemory._stuckCount++ < 10) return false;

		return true;
	}
}
