'use strict';

module.exports = class SpawnManager {
	/**
	 * Creates a new SpawnManager instance.
	 */
	constructor() {
		this.roles = {};
	}

	/**
	 * Registers a role to be managed.
	 *
	 * @param {String} roleId
	 *   Identifier of the role, as stored in a creep's memory.
	 * @param {Role} role
	 *   The role to register.
	 */
	registerSpawnRole(roleId, role) {
		this.roles[roleId] = role;
	}

	/**
	 * Collects spawn options from all spawn roles.
	 *
	 * @param {Room} room
	 *   The room to use as context for spawn roles.
	 *
	 * @return {object[]}
	 *   An array of possible spawn options for the current room.
	 */
	getAllSpawnOptions(room) {
		const options = [];

		_.each(this.roles, (role, roleId) => {
			if (role.getSpawnOptions) {
				const roleOptions = [];
				role.getSpawnOptions(room, roleOptions);

				_.each(roleOptions, option => {
					// Set default values for options.
					if (typeof option.role === 'undefined') option.role = roleId;

					options.push(option);
				});
			}
		});

		return options;
	}

	/**
	 * Manages spawning in a room.
	 *
	 * @param {Room} room
	 *   The room to manage spawning in.
	 * @param {StructureSpawn[]} spawns
	 *   The room's spawns.
	 */
	manageSpawns(room, spawns) {
		const availableSpawns = this.filterAvailableSpawns(spawns);
		if (availableSpawns.length === 0) return;

		const options = this.getAllSpawnOptions(room);
		const option = _.sample(options);
		const role = this.roles[option.role];
		const body = role.getCreepBody(room, option);

		const spawn = _.sample(availableSpawns);
		spawn.spawnCreep(body, '', {});
	}

	/**
	 * Filters a list of spawns to only those available for spawning.
	 *
	 * @param {StructureSpawn[]} spawns
	 *   The list of spawns to filter.
	 *
	 * @return {StructureSpawn[]}
	 *   An array containing all spawns where spawning is possible.
	 */
	filterAvailableSpawns(spawns) {
		return _.filter(spawns, spawn => {
			if (spawn.spawning) return false;

			return true;
		});
	}

	/**
	 *
	 */
	getCreepBody(room, option) {
		const role = this.roles[option.role];
		if (typeof role !== 'undefined') return role.getCreepBody(room, option);
	}
};
