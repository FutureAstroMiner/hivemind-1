'use strict';

/* global Creep OK */

const utilities = require('./utilities');

/**
 * Makes the creep claim a room for the hive!
 */
Creep.prototype.performClaim = function () {
	const targetPosition = utilities.decodePosition(this.memory.target);

	if (targetPosition.roomName !== this.pos.roomName) {
		this.moveTo(targetPosition);
		return;
	}

	const target = this.room.controller;

	if (target.owner && !target.my && this.memory.body && this.memory.body.claim >= 5) {
		if (this.pos.getRangeTo(target) > 1) {
			this.moveTo(target);
		}
		else {
			this.claimController(target);
		}
	}
	else if (!target.my) {
		const numRooms = _.size(_.filter(Game.rooms, room => room.controller && room.controller.my));
		const maxRooms = Game.gcl.level;

		if (this.pos.getRangeTo(target) > 1) {
			this.moveTo(target);
		}
		else if (numRooms < maxRooms) {
			this.claimController(target);
		}
		else {
			this.reserveController(target);
		}
	}
};

/**
 * Makes the creep reserve a room.
 */
Creep.prototype.performReserve = function () {
	const targetPosition = utilities.decodePosition(this.memory.target);
	if (targetPosition.roomName !== this.pos.roomName) {
		this.moveTo(targetPosition);
		return;
	}

	const target = this.room.controller;

	if (this.pos.getRangeTo(target) > 1) {
		this.moveTo(target);
	}
	else {
		const result = this.reserveController(target);
		if (result === OK) {
			let reservation = 0;
			if (this.room.controller.reservation && this.room.controller.reservation.username === utilities.getUsername()) {
				reservation = this.room.controller.reservation.ticksToEnd;
			}

			this.room.memory.lastClaim = {
				time: Game.time,
				value: reservation,
			};
		}
	}
};

/**
 * Makes a creep behave like a claimer.
 */
Creep.prototype.runClaimerLogic = function () {
	const targetPosition = utilities.decodePosition(this.memory.target);
	if (!this.hasCachedPath() && Memory.rooms[this.room.name].remoteHarvesting && Memory.rooms[this.room.name].remoteHarvesting[this.memory.target]) {
		const harvestMemory = Memory.rooms[this.room.name].remoteHarvesting[this.memory.target];

		if (harvestMemory.cachedPath) {
			this.setCachedPath(harvestMemory.cachedPath.path, false, 1);
		}
	}

	if (this.hasCachedPath()) {
		if (this.hasArrived() || this.pos.getRangeTo(targetPosition) < 3) {
			this.clearCachedPath();
		}
		else {
			this.followCachedPath();
			return;
		}
	}

	if (this.memory.mission === 'reserve') {
		this.performReserve();
	}
	else if (this.memory.mission === 'claim') {
		this.performClaim();
	}
};
