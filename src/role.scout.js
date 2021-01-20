'use strict';

/* global RoomPosition */

const utilities = require('./utilities');
const Role = require('./role');

const ScoutRole = function () {
	Role.call(this);
};

ScoutRole.prototype = Object.create(Role.prototype);

/**
 * Makes a creep behave like a scout.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
ScoutRole.prototype.run = function (creep) {
	if (!creep.memory.scoutTarget && !creep.memory.portalTarget) {
		this.chooseScoutTarget(creep);
	}

	this.performScout(creep);
};

/**
 * Makes this creep move between rooms to gather intel.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
ScoutRole.prototype.performScout = function (creep) {
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

	if (!creep.moveToRoom(creep.memory.scoutTarget, true)) {
		this.chooseScoutTarget(creep);
	}
};

/**
 * Chooses which of the possible scout target rooms to travel to.
 *
 * @param {Creep} creep
 *   The creep to run logic for.
 */
ScoutRole.prototype.chooseScoutTarget = function (creep) {
	creep.memory.scoutTarget = null;
	if (!creep.memory.origin) creep.memory.origin = creep.room.name;
	if (!Memory.strategy) return;

	const memory = Memory.strategy;

	let best = null;
	for (const info of _.values(memory.roomList)) {
		if (info.roomName === creep.pos.roomName) continue;

		if (info.origin === creep.memory.origin && info.scoutPriority > 0) {
			if (!best || best.scoutPriority < info.scoutPriority) {
				// Check distance / path to room.
				const path = creep.calculateRoomPath(info.roomName, true);

				if (path) {
					best = info;
				}
			}
		}
	}

	if (best) {
		creep.memory.scoutTarget = best.roomName;
	}

	if (!creep.memory.scoutTarget) {
		creep.memory.scoutTarget = creep.memory.origin;
	}
};

module.exports = ScoutRole;
