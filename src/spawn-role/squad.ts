/* global MOVE ATTACK RANGED_ATTACK HEAL TOUGH CLAIM CARRY WORK */

import SpawnRole from 'spawn-role/spawn-role';
import Squad from 'manager.squad';

declare global {
	type SquadUnitType = 'ranger' | 'healer' | 'claimer' | 'singleClaim' | 'builder' | 'attacker' | 'brawler' | 'test';
}

interface SquadSpawnOption extends SpawnOption {
	unitType: SquadUnitType;
	squad: string;
}

export default class SquadSpawnRole extends SpawnRole {
	/**
	 * Adds squad spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 */
	getSpawnOptions(room: Room) {
		const options: SquadSpawnOption[] = [];

		_.each(Game.squads, squad => {
			if (squad.getSpawn() !== room.name) return;
			const spawnUnitType = this.needsSpawning(squad);
			if (!spawnUnitType) return;

			const roomHasReserves = room.getEffectiveAvailableEnergy() > 10_000;
			options.push({
				priority: roomHasReserves ? 4 : 2,
				weight: 1.1,
				unitType: spawnUnitType,
				squad: squad.name,
			});
		});

		return options;
	}

	/**
	 * Decides whether a squad needs additional units spawned.
	 *
	 * @param {Squad} squad
	 *   The squad to check.
	 *
	 * @return {string|null}
	 *   Type of the unit that needs spawning.
	 */
	needsSpawning(squad: Squad): SquadUnitType | null {
		const neededUnits: SquadUnitType[] = [];
		for (const unitType in squad.memory.composition) {
			if (squad.memory.composition[unitType] > _.size(squad.units[unitType])) {
				neededUnits.push(unitType as SquadUnitType);
			}
		}

		if (_.size(neededUnits) === 0) squad.memory.fullySpawned = true;

		// @todo Some squad units might need to be spawned at higher priorities
		// than others.
		return _.sample(neededUnits);
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
	getCreepBody(room: Room, option: SquadSpawnOption): BodyPartConstant[] {
		// Automatically call spawning function for selected unit type.
		const methodName = 'get' + _.capitalize(option.unitType) + 'CreepBody';
		const bodyCallback: (room: Room, option: SquadSpawnOption) => BodyPartConstant[] = this[methodName];
		if (bodyCallback) return bodyCallback.call(this, room, option);

		// If the unit type is not supported, spawn a general brawler.
		return this.getBrawlerCreepBody(room);
	}

	getRangerCreepBody(room: Room) {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.5, [RANGED_ATTACK]: 0.3, [HEAL]: 0.2},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
		);
	}

	getHealerCreepBody(room: Room) {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.52, [HEAL]: 0.48},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
		);
	}

	getClaimerCreepBody(room: Room) {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.52, [TOUGH]: 0.18, [CLAIM]: 0.3},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
		);
	}

	getSingleClaimCreepBody() {
		return [MOVE, MOVE, MOVE, MOVE, MOVE, CLAIM];
	}

	getBuilderCreepBody(room: Room) {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.52, [CARRY]: 0.28, [WORK]: 0.2},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
		);
	}

	getAttackerCreepBody(room: Room) {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.5, [ATTACK]: 0.5},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
		);
	}

	getTestCreepBody() {
		return [MOVE];
	}

	getBrawlerCreepBody(room: Room) {
		return this.generateCreepBodyFromWeights(
			{[MOVE]: 0.5, [ATTACK]: 0.3, [HEAL]: 0.2},
			Math.max(room.energyCapacityAvailable * 0.9, room.energyAvailable),
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
	getCreepMemory(room: Room, option: SquadSpawnOption): CreepMemory {
		return {
			role: 'brawler',
			squadName: option.squad,
			squadUnitType: option.unitType,
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
	getCreepBoosts(room: Room, option: SquadSpawnOption, body: BodyPartConstant[]): Record<string, ResourceConstant> {
		if (option.unitType === 'healer') {
			return this.generateCreepBoosts(room, body, HEAL, 'heal');
		}

		if (option.unitType === 'attacker') {
			return this.generateCreepBoosts(room, body, ATTACK, 'attack');
		}

		return null;
	}
}
