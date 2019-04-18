'use strict';

/* global hivemind */

const Process = require('./process');
const CreepManager = require('./creep-manager');

// Normal creep roles.
const creepRoles = [
	'brawler',
	'builder',
	'claimer',
	'dismantler',
	'builder.exploit',
	'harvester.exploit',
	'hauler.exploit',
	'gift',
	'harvester',
	'harvester.power',
	'hauler.power',
	'builder.remote',
	'harvester.remote',
	'scout',
	'upgrader',
];

// Power creep roles.
const OperatorRole = require('./role.operator');

/**
 * Runs logic for all rooms we have visibility in.
 * @constructor
 *
 * @param {object} params
 *   Options on how to run this process.
 * @param {object} data
 *   Memory object allocated for this process' stats.
 */
const CreepsProcess = function (params, data) {
	Process.call(this, params, data);

	this.creepManager = new CreepManager();
	for (const roleName of creepRoles) {
		const RoleClass = require('./role.' + roleName);
		this.creepManager.registerCreepRole(roleName, new RoleClass());
	}

	this.powerCreepManager = new CreepManager();
	this.powerCreepManager.registerCreepRole('operator', new OperatorRole());
};

CreepsProcess.prototype = Object.create(Process.prototype);

/**
 * Runs logic for all creeps.
 */
CreepsProcess.prototype.run = function () {
	this.creepManager.onTickStart();
	_.each(Game.creepsByRole, (creeps, role) => {
		hivemind.runSubProcess('creeps_' + role, () => {
			this.creepManager.manageCreeps(creeps);
		});
	});
	this.creepManager.report();

	const powerCreeps = _.filter(Game.powerCreeps, creep => (creep.ticksToLive || 0) > 0);
	this.powerCreepManager.onTickStart();
	this.powerCreepManager.manageCreeps(powerCreeps);
	this.powerCreepManager.report();
};

module.exports = CreepsProcess;
