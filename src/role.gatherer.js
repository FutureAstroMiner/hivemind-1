'use strict';

/* global FIND_STRUCTURES FIND_RUINS FIND_DROPPED_RESOURCES FIND_TOMBSTONES
STRUCTURE_STORAGE STRUCTURE_TERMINAL FIND_SYMBOL_CONTAINERS */

const utilities = require('./utilities');
const Role = require('./role');
const ScoutRole = require('./role.scout');

/**
 * Gatherers collect resources from safe sources outside their spawn room.
 *
 * They do no work to "produce" these resources, instead relying on gathered
 * intel about resources left in buildings or ruins.
 * A gatherer will move directly to the target room, choose a target to withdraw
 * from, and return home once full to deposit the gathered resources.
 *
 * Memory structure:
 * - origin: Name of the room the creep originates in.
 * - targetRoom: Name of the room to gather resources in.
 */
module.exports = class GathererRole extends Role {
	/**
	 * Creates a new GathererRole object.
	 */
	constructor() {
		super();

		this.scoutRole = new ScoutRole();
	}

	/**
	 * Makes this creep behave like a gatherer.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep) {
		if (creep.memory.delivering) {
			this.deliverResources(creep);
			return;
		}

		if (creep.memory.targetRoom) {
			this.gatherResources(creep);
			return;
		}

		if (creep.store.getUsedCapacity() * 2 > creep.store.getFreeCapacity()) {
			// Deliver what resources we gathered.
			creep.memory.delivering = true;
			return;
		}

		this.scoutRole.run(creep);
	}

	/**
	 * Makes the creep move into the target room and gather resources.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	gatherResources(creep) {
		// Switch to delivery mode if storage is full.
		if (creep.store.getFreeCapacity() === 0) {
			creep.memory.delivering = true;
			return;
		}

		const isInTargetRoom = creep.pos.roomName === creep.memory.targetRoom;
		if (!isInTargetRoom || (!creep.isInRoom() && creep.getNavMeshMoveTarget())) {
			// Move to target room.
			if (creep.moveUsingNavMesh(new RoomPosition(25, 25, creep.memory.targetRoom)) !== OK) {
				// Can't reach target room, for example because of enemies.
				// Go scout, then.
				delete creep.memory.targetRoom;
			}

			return;
		}

		creep.stopNavMeshMove();

		// Choose a target in the room.
		const target = this.getGatherTarget(creep);
		if (!target && !creep.memory.delivering) {
			if (creep.store.getUsedCapacity() * 2 > creep.store.getFreeCapacity()) {
				// Deliver what resources we gathered.
				creep.memory.delivering = true;
			}

			// Go scouting afterwards. Same for all other gatherers assigned to this
			// room.
			const roomName = creep.memory.targetRoom;
			_.each(Game.creepsByRole.gatherer, creep2 => {
				if (creep2.memory.targetRoom === roomName) delete creep.memory.targetRoom;
			});
			return;
		}

		if (target) {
			this.gatherFromTarget(creep, target);
		}
	}

	/**
	 * Chooses a target to gather resources from.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 *
	 * @return {RoomObject}
	 *   An object that has gatherable resources stored.
	 */
	getGatherTarget(creep) {
		if (creep.memory.target) {
			const target = Game.getObjectById(creep.memory.target);
			if (target) return target;
		}

		// Decide what the most valuable target is.
		const options = [];
		this.addSymbolContainerOptions(creep, options);
		this.addResourceOptions(creep, options);
		this.addTombstoneOptions(creep, options);
		this.addStructureOptions(creep, options);
		this.addRuinOptions(creep, options);

		const option = utilities.getBestOption(options);
		if (!option) {
			// @todo If there's no valid target, deliver and/or assign to new room.
			creep.memory.delivering = true;
			return;
		}

		creep.memory.target = option.target;
		const target = Game.getObjectById(creep.memory.target);
		if (target) return target;
	}

	/**
	 * Adds gathering options for symbol containers at high priority.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {object} options
	 *   List of prioritized options to add targets to.
	 */
	addSymbolContainerOptions(creep, options) {
		const containers = creep.room.find(FIND_SYMBOL_CONTAINERS);
		for (const container of containers) {
			if (!container.store) continue;
			if (container.store.getUsedCapacity(container.resourceType) === 0) continue;

			options.push({
				priority: 4,
				weight: container.store[container.resourceType] / 1000,
				target: container.id,
			});
		}
	}

	/**
	 * Adds gathering options for dropped resources.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {object} options
	 *   List of prioritized options to add targets to.
	 */
	addResourceOptions(creep, options) {
		const resources = creep.room.find(FIND_DROPPED_RESOURCES);
		for (const resource of resources) {
			if (!resource.amount) continue;

			options.push({
				priority: resource.amount > 100 ? 3 : 2,
				weight: resource.amount / 1000,
				target: resource.id,
			});
		}
	}

	/**
	 * Adds gathering options for dropped resources.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {object} options
	 *   List of prioritized options to add targets to.
	 */
	addTombstoneOptions(creep, options) {
		const tombs = creep.room.find(FIND_TOMBSTONES);
		for (const tomb of tombs) {
			if (tomb.store.getUsedCapacity() === 0) continue;

			options.push({
				priority: tomb.store.getUsedCapacity() > 100 ? 3 : 2,
				weight: tomb.store.getUsedCapacity() / 1000,
				target: tomb.id,
			});
		}
	}

	/**
	 * Adds gathering options for structures containing resources.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {object} options
	 *   List of prioritized options to add targets to.
	 */
	addStructureOptions(creep, options) {
		const structures = creep.room.find(FIND_STRUCTURES);
		for (const structure of structures) {
			if (!structure.store) continue;
			if (structure.store.getUsedCapacity() === 0) continue;

			// @todo Ignore our own remote harvest containers.
			// @todo Handle structures with a store that can't be withdrawn from.

			options.push({
				priority: structure.structureType === STRUCTURE_STORAGE || structure.structureType === STRUCTURE_TERMINAL ? 2 : 1,
				weight: structure.store.getUsedCapacity() / 10000,
				target: structure.id,
			});
		}
	}

	/**
	 * Adds gathering options for ruins.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {object} options
	 *   List of prioritized options to add targets to.
	 */
	addRuinOptions(creep, options) {
		const ruins = creep.room.find(FIND_RUINS);
		for (const ruin of ruins) {
			if (!ruin.store) continue;
			if (ruin.store.getUsedCapacity() === 0) continue;

			options.push({
				priority: 1,
				weight: ruin.store.getUsedCapacity() / 10000,
				target: ruin.id,
			});
		}
	}

	/**
	 * Gathers resources from the given target.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 * @param {RoomObject} target
	 *   An object that has gatherable resources stored.
	 */
	gatherFromTarget(creep, target) {
		if (creep.pos.getRangeTo(target) > 1) {
			creep.moveToRange(target, 1);
			// @todo If path to target is blocked, remember as invalid target.
			// If everything is blocked, consider sending dismantlers, or not doing
			// anything in the room.
			return;
		}

		if (target.amount) {
			creep.pickup(target);
		}

		// @todo Withdraw as many resources as possible.
		// @todo Start with most valuable resources?
		_.each(target.store, (amount, resourceType) => {
			if (!amount || amount === 0) return;
			creep.withdraw(target, resourceType);
		});

		// Decide on a new target next tick after withdrawing.
		delete creep.memory.target;
	}

	/**
	 * Makes the creep return to the spawn room and deliver resources.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	deliverResources(creep) {
		const isInTargetRoom = creep.pos.roomName === creep.memory.origin;
		if (!isInTargetRoom || (!creep.isInRoom() && creep.getNavMeshMoveTarget())) {
			// Move back to spawn room.
			if (creep.moveUsingNavMesh(new RoomPosition(25, 25, creep.memory.origin)) !== OK) {
				// @todo What if we can't deliver? Find a new "origin" room to deliver to?
			}

			return;
		}

		creep.stopNavMeshMove();

		// Choose a resource and deliver it.
		_.each(creep.store, (amount, resourceType) => {
			if (!amount || amount === 0) return;

			const target = creep.room.getBestStorageTarget(amount, resourceType);
			if (!target) return false;

			if (creep.pos.getRangeTo(target) > 1) {
				creep.moveToRange(target, 1);
				return false;
			}

			creep.transfer(target, resourceType);
			return false;
		});

		if (creep.store.getUsedCapacity() === 0) {
			creep.memory.delivering = false;
		}
	}
};
