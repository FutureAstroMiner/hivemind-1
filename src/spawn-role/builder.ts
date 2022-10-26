/* global FIND_MY_CONSTRUCTION_SITES FIND_MY_STRUCTURES MOVE WORK CARRY */

import cache from 'utils/cache';
import SpawnRole from 'spawn-role/spawn-role';

interface BuilderSpawnOption extends SpawnOption {
	size: number;
}

export default class BuilderSpawnRole extends SpawnRole {
	/**
	 * Adds builder spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room): BuilderSpawnOption[] {
		const maxWorkParts = this.getNeededWorkParts(room);

		let numWorkParts = 0;
		_.each(room.creepsByRole.builder, creep => {
			numWorkParts += creep.memory.body.work || 0;
		});

		const availableEnergy = room.getEffectiveAvailableEnergy();
		const needsStrongerRamparts = room.terminal && this.getLowestRampartValue(room) < 3_000_000 && availableEnergy > 10_000;
		const needsInitialBuildings = room.controller.level < 5 && room.find(FIND_MY_CONSTRUCTION_SITES).length > 0;

		if (numWorkParts >= maxWorkParts) return [];

		return [{
			priority: (needsStrongerRamparts || needsInitialBuildings) ? 4 : 3,
			weight: 0.5,
			size: room.isEvacuating() ? 3 : null,
		}];
	}

	/**
	 * Determine how many work parts we need on builders in this room.
	 *
	 * @param {Room} room
	 *   The room to check.
	 *
	 * @return {number}
	 *   The number of work parts needed.
	 */
	getNeededWorkParts(room: Room): number {
		const numConstructionSites = room.find(FIND_MY_CONSTRUCTION_SITES).length;

		if (room.isEvacuating()) {
			if (numConstructionSites === 0 && room.memory.noBuilderNeeded && Game.time - room.memory.noBuilderNeeded < 1500) {
				return 0;
			}

			// Just spawn a small builder for keeping roads intact.
			return 1;
		}

		if (room.controller.level <= 3 && numConstructionSites === 0) {
			// There isn't really much to repair before RCL 4, so don't spawn
			// new builders when there's nothing to build.
			return 1;
		}

		if (numConstructionSites === 0 && room.memory.noBuilderNeeded && Game.time - room.memory.noBuilderNeeded < 1500) {
			return 0;
		}

		let maxWorkParts = 5;
		if (room.controller.level > 2) {
			maxWorkParts += 5;
		}

		// There are a lot of ramparts in planned rooms, spawn builders appropriately.
		// @todo Only if they are not fully built, of course.
		if (room.roomPlanner && room.controller.level >= 4) {
			maxWorkParts += _.size(room.roomPlanner.getLocations('rampart')) / 10;
		}

		// Add more builders if we have a lot of energy to spare.
		const availableEnergy = room.getEffectiveAvailableEnergy();
		if (availableEnergy > 400_000) {
			maxWorkParts *= 2;
		}
		else if (availableEnergy > 200_000) {
			maxWorkParts *= 1.5;
		}

		// Add more builders if we're moving a spawn.
		if (room.roomManager && room.roomManager.hasMisplacedSpawn()) {
			maxWorkParts *= 2;
		}

		// Add more builders if we have a terminal, but ramparts are too low to
		// reasonably protect the room.
		if (room.terminal && this.getLowestRampartValue(room) < 3_000_000 && availableEnergy > 10_000) {
			maxWorkParts *= 2.5;
		}

		if (room.controller.level > 3) {
			// Spawn more builders depending on total size of current construction sites.
			// @todo Use hitpoints of construction sites vs number of work parts as a guide.
			maxWorkParts += numConstructionSites / 2;
		}

		return maxWorkParts;
	}

	/**
	 * Gets lowest number of hit points of all ramparts in the room.
	 *
	 * @return {number}
	 *   Number of hits for the lowest rampart.
	 */
	getLowestRampartValue(room: Room): number {
		return cache.inHeap('lowestRampart:' + room.name, 100, () => {
			const ramparts = room.find(FIND_MY_STRUCTURES, {
				filter: s => s.structureType === STRUCTURE_RAMPART,
			});

			return _.min(ramparts, 'hits').hits;
		});
	}

	/**
	 * Gets the body of a creep to be spawned.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object} option
	 *   The spawn option for which to generate the body.
	 *
	 * @return {string[]}
	 *   A list of body parts the new creep should consist of.
	 */
	getCreepBody(room: Room, option: BuilderSpawnOption): BodyPartConstant[] {
		const maxParts = option.size && {[WORK]: option.size};

		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.35, [WORK]: 0.35, [CARRY]: 0.3},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
			maxParts,
		);
	}

	/**
	 * Gets memory for a new creep.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object} option
	 *   The spawn option for which to generate the body.
	 *
	 * @return {Object}
	 *   The boost compound to use keyed by body part type.
	 */
	getCreepMemory(room: Room): BuilderCreepMemory {
		return {
			role: 'builder',
			singleRoom: room.name,
			operation: 'room:' + room.name,
		};
	}

	/**
	 * Gets which boosts to use on a new creep.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object} option
	 *   The spawn option for which to generate the body.
	 * @param {string[]} body
	 *   The body generated for this creep.
	 *
	 * @return {Object}
	 *   The boost compound to use keyed by body part type.
	 */
	getCreepBoosts(room: Room, option: BuilderSpawnOption, body: BodyPartConstant[]): Record<string, ResourceConstant> {
		return this.generateCreepBoosts(room, body, WORK, 'repair');
	}
}
