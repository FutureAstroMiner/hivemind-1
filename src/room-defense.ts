/* global STRUCTURE_RAMPART ATTACK RANGED_ATTACK HEAL CLAIM MOVE TOUGH CARRY
FIND_STRUCTURES LOOK_STRUCTURES */

import hivemind from 'hivemind';
import Operation from 'operation/operation';
import cache from 'utils/cache';

declare global {
	interface RoomMemory {
		defense?: any;
	}
}

const attackParts: BodyPartConstant[] = [ATTACK, RANGED_ATTACK, CLAIM, WORK];

const partStrength = {
	[ATTACK]: ATTACK_POWER,
	[RANGED_ATTACK]: RANGED_ATTACK_POWER,
	[HEAL]: HEAL_POWER,
	[CLAIM]: ATTACK_POWER / 2,
	[WORK]: DISMANTLE_POWER,
};

const relevantBoostAttribute = {
	[ATTACK]: 'attack',
	[RANGED_ATTACK]: 'rangedAttack',
	[HEAL]: 'heal',
	[WORK]: 'dismantle',
};

// @todo Evacuate room when walls are breached, or when spawns are gone, ...
// @todo Destroy terminal and storage if not hope of recovery?

export default class RoomDefense {
	roomName: string;
	room: Room;
	memory;

	constructor(roomName) {
		this.roomName = roomName;
		this.room = Game.rooms[roomName];

		if (!this.room.memory.defense) this.room.memory.defense = {};

		this.memory = this.room.memory.defense;
	}

	/**
	 * Checks if a room's walls are intact.
	 *
	 * @return {boolean}
	 *   True if all planned ramparts are built and strong enough.
	 */
	isWallIntact() {
		return cache.inObject(this.room, 'isWallIntact', 1, () => {
			if (!this.room.roomPlanner) return true;

			const rampartPositions: RoomPosition[] = this.room.roomPlanner.getLocations('rampart');
			const requiredHits = 25_000 * this.room.controller.level * this.room.controller.level;

			for (const pos of rampartPositions) {
				// Check if there's a rampart here already.
				const structures = pos.lookFor(LOOK_STRUCTURES);
				if (_.filter(structures, structure => structure.structureType === STRUCTURE_RAMPART && structure.hits >= requiredHits).length === 0) {
					return false;
				}
			}

			return true;
		});
	}

	/**
	 * Determines enemy strength in a room.
	 *
	 * @return {Number}
	 *   0: No enemies in the room.
	 *   1: Enemies are very weak, towers can take them out.
	 *   2: Enemies are strong or numerous.
	 */
	getEnemyStrength() {
		return cache.inObject(this.room, 'getEnemyStrength', 1, () => {
			let attackStrength = 0;
			let totalStrength = 0;
			let invaderOnly = true;

			// @todo If it's invaders, don't go up to level 2.
			// @todo Take into account boost stength.
			// @todo Weigh against room defensive capabilities.

			for (const userName in this.room.enemyCreeps) {
				if (hivemind.relations.isAlly(userName)) continue;
				if (userName !== 'Invader') invaderOnly = false;

				const creeps = this.room.enemyCreeps[userName];
				for (const creep of creeps) {
					for (const part of creep.body) {
						let partPower = partStrength[part.type] || 0;
						let boostPower = 1;

						if (part.boost && typeof part.boost === 'string') {
							const effect = BOOSTS[part.type][part.boost];
							boostPower = effect[relevantBoostAttribute[part.type]] || 1;

							if (part.type === TOUGH) {
								partPower = 100;
								boostPower = 1 / (effect.damage || 1);
							}
						}

						if (attackParts.includes(part.type)) {
							attackStrength += partPower * boostPower;
						}
						totalStrength += partPower * boostPower;
					}
				}
			};

			let defenseStrength = TOWER_POWER_ATTACK * this.room.find(FIND_MY_STRUCTURES, {filter: s => s.structureType === STRUCTURE_TOWER}).length / 2;
			//defenseStrength += ATTACK_POWER * this.room.energyCapacityAvailable / BODYPART_COST[ATTACK] / 5;

			// @todo Factor available boosts into defense strength.

			this.room.visual.text('Enemy Attack power: ' + attackStrength, 5, 6);
			this.room.visual.text('Enemy Total power: ' + totalStrength, 5, 7);
			this.room.visual.text('Our defense power: ' + defenseStrength, 5, 8);

			if (attackStrength === 0) return 0;
			if (invaderOnly || totalStrength < defenseStrength) return 1;
			return 2;
		});
	}

	openRampartsToFriendlies() {
		if (_.size(this.room.enemyCreeps) === 0) {
			if (this.memory.lastActivity && Game.time - this.memory.lastActivity > 10) {
				// Close ramparts after last friendly leaves the room for a while.
				const ramparts = this.room.find<StructureRampart>(FIND_STRUCTURES, {filter: structure => structure.structureType === STRUCTURE_RAMPART});
				_.each(ramparts, rampart => {
					if (rampart.isPublic) rampart.setPublic(false);
				});
				delete this.memory.lastActivity;
				delete this.memory.creepStatus;
			}

			return;
		}

		this.memory.lastActivity = Game.time;
		if (!this.memory.creepStatus) this.memory.creepStatus = {};

		const allowed = [];
		const forbidden = [];
		_.each(this.room.enemyCreeps, (creeps, username) => {
			const numberInRoom = _.size(_.filter(creeps, creep => this.isInRoom(creep)));

			for (const creep of creeps) {
				this.recordCreepStatus(creep);

				if (!this.isWhitelisted(username) || (!this.isUnarmedCreep(creep) && !hivemind.relations.isAlly(username))) {
					// Deny unwanted creeps.
					forbidden.push(creep);
					continue;
				}

				if (numberInRoom >= hivemind.settings.get('maxVisitorsPerUser') && !this.isInRoom(creep)) {
					// Extra creeps outside are denied entry.
					forbidden.push(creep);
					continue;
				}

				allowed.push(creep);
			}
		});

		const ramparts = this.room.find<StructureRampart>(FIND_STRUCTURES, {filter: structure => structure.structureType === STRUCTURE_RAMPART});
		_.each(ramparts, rampart => {
			const newState = this.calculateRampartState(rampart, allowed, forbidden);
			if (rampart.isPublic !== newState) rampart.setPublic(newState);
		});
	}

	recordCreepStatus(creep) {
		// @todo Detect killed creeps as resources we've gained.

		if (!this.memory.creepStatus[creep.id]) {
			const store = {};
			_.each(creep.store, (amount, resourceType) => {
				store[resourceType] = amount;
			});

			this.memory.creepStatus[creep.id] = {
				store,
			};
		}

		const memory = this.memory.creepStatus[creep.id];
		if (memory.isThief) return;

		// Detect if creep has gained resources.
		_.each(creep.store, (amount, resourceType) => {
			if (amount !== (memory.store[resourceType] || 0)) {
				const creepGained = amount - (memory.store[resourceType] || 0);
				// We lost any resource the creep gained.
				this.calculatePlayerTrade(creep.owner.username, -creepGained, resourceType);
				// @todo Set `memory.isThief = true` when too many resources have been
				// taken.
			}

			memory.store[resourceType] = amount;
		});
		_.each(memory.store, (amount, resourceType) => {
			if (!creep.store[resourceType]) {
				// If the creep lost a resource, we gained as much.
				this.calculatePlayerTrade(creep.owner.username, amount, resourceType);
				delete memory.store[resourceType];
			}
		});
	}

	calculatePlayerTrade(username, amount, resourceType) {
		const opName = 'playerTrade:' + username;
		const operation = Game.operations[opName] || new Operation(opName);

		operation.recordStatChange(amount, resourceType);

		hivemind.log('trade', this.roomName).notify('Trade with', username, ':', amount, resourceType);
	}

	isThief(creep) {
		if (!this.memory.creepStatus) return false;
		if (!this.memory.creepStatus[creep.id]) return false;
		if (!this.memory.creepStatus[creep.id].isThief) return false;

		// @todo Mark as thief if player stole too many resources.

		return true;
	}

	/**
	 * Determines if a rampart should be opened or closed.
	 */
	calculateRampartState(rampart, allowed, forbidden) {
		if (allowed.length === 0) return false;
		if (forbidden.length === 0) return true;

		for (const creep of forbidden) {
			if (creep.pos.getRangeTo(rampart) <= 3) return false;
		}

		return true;
	}

	/**
	 * Checks if a creep is considered harmless.
	 */
	isUnarmedCreep(creep) {
		for (const part of creep.body) {
			if (part.type !== MOVE && part.type !== TOUGH && part.type !== CARRY) {
				return false;
			}
		}

		return true;
	}

	isInRoom(creep) {
		// @todo This is not correct when mincut ramparts are enabled.
		return creep.pos.x > 1 && creep.pos.y > 1 && creep.pos.x < 48 && creep.pos.y < 48;
	}

	isWhitelisted(username) {
		return hivemind.relations.isAlly(username) || _.includes(hivemind.settings.get('rampartWhitelistedUsers'), username);
	}
}
