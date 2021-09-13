/* global FIND_HOSTILE_CREEPS FIND_MY_STRUCTURES STRUCTURE_RAMPART */

declare global {
	interface GuardianCreep extends Creep {
		memory: GuardianCreepMemory,
		heapMemory: GuardianCreepHeapMemory,
	}

	interface GuardianCreepMemory extends CreepMemory {
		role: 'guardian',
	}

	interface GuardianCreepHeapMemory extends CreepHeapMemory {
	}
}

import hivemind from 'hivemind';
import Role from 'role/role';

const filterEnemyCreeps = (c: Creep) => !hivemind.relations.isAlly(c.owner.username) && c.isDangerous();

export default class GuardianRole extends Role {
	constructor() {
		super();

		// Guardians have high priority because of their importance to room defense.
		this.stopAt = 0;
		this.throttleAt = 0;
	}

	/**
	 * Makes a creep behave like a guardian.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: GuardianCreep) {
		const rampart = this.getBestRampartToCover(creep);
		if (!rampart) return;

		creep.whenInRange(0, rampart, () => this.attackTargetsInRange(creep));
	}

	getBestRampartToCover(creep: GuardianCreep): StructureRampart {
		// @todo Make sure we can find a safe path to the rampart in question.
		const targets = creep.room.find(FIND_HOSTILE_CREEPS, {
			filter: filterEnemyCreeps,
		});

		const ramparts: StructureRampart[] = [];
		for (const target of targets) {
			const closestRampart = target.pos.findClosestByRange(FIND_MY_STRUCTURES, {
				filter: s => {
					if (s.structureType !== STRUCTURE_RAMPART) return false;

					// Only target ramparts not occupied by another creep.
					const occupyingCreeps = s.pos.lookFor(LOOK_CREEPS);
					if (occupyingCreeps.length > 0 && occupyingCreeps[0].id !== creep.id) return false;

					return true;
				},
			}) as StructureRampart;
			if (ramparts.indexOf(closestRampart) === -1) ramparts.push(closestRampart);
		}

		return _.min(ramparts, (s: StructureRampart) => s.pos.getRangeTo(creep.pos) / 2 + s.pos.getRangeTo(s.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
			filter: filterEnemyCreeps,
		})));
	}

	attackTargetsInRange(creep: GuardianCreep) {
		// @todo Ask military manager for best target for joint attacks.
		if (creep.getActiveBodyparts(RANGED_ATTACK) > 0) {
			const targets = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 3, {
				filter: filterEnemyCreeps,
			});
			if (targets.length === 0) return;

			creep.rangedAttack(targets[0]);
		}
		if (creep.getActiveBodyparts(ATTACK) > 0) {
			const targets = creep.pos.findInRange(FIND_HOSTILE_CREEPS, 1, {
				filter: filterEnemyCreeps,
			});
			if (targets.length === 0) return;

			creep.attack(targets[0]);
		}
	}
};