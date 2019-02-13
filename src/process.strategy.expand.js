'use strict';

/* global PathFinder Room RoomPosition CREEP_LIFE_TIME FIND_MY_CREEPS
TERRAIN_MASK_WALL FIND_STRUCTURES STRUCTURE_ROAD FIND_CONSTRUCTION_SITES
OBSTACLE_OBJECT_TYPES STRUCTURE_RAMPART */

const Process = require('./process');
const Squad = require('./manager.squad');
const stats = require('./stats');

const ExpandProcess = function (params, data) {
	Process.call(this, params, data);

	if (!Memory.strategy) {
		Memory.strategy = {};
	}

	if (!Memory.strategy.expand) {
		Memory.strategy.expand = {};
	}
};

ExpandProcess.prototype = Object.create(Process.prototype);

/**
 * Sends a squad for expanding to a new room if GCL and CPU allow.
 */
ExpandProcess.prototype.run = function () {
	const memory = Memory.strategy;

	let canExpand = false;
	let ownedRooms = 0;
	for (const roomName in Game.rooms) {
		const room = Game.rooms[roomName];
		if (room.controller && room.controller.my) ownedRooms++;
	}

	if (ownedRooms < Game.gcl.level) {
		// Check if we have some cpu power to spare.
		if (stats.getStat('cpu_total', 10000) && stats.getStat('cpu_total', 10000) < Game.cpu.limit * 0.8 && stats.getStat('cpu_total', 1000) < Game.cpu.limit * 0.8) {
			canExpand = true;
		}
	}

	if (!memory.expand.currentTarget && canExpand) {
		// Choose a room to expand to.
		// @todo Handle cases where expansion to a target is not reasonable, like it being taken by somebody else, path not being safe, etc.
		let bestTarget = null;
		for (const i in memory.roomList || []) {
			const info = memory.roomList[i];
			if (!info.expansionScore || info.expansionScore <= 0) continue;
			if (bestTarget && bestTarget.expansionScore >= info.expansionScore) continue;

			// Don't try to expand to a room that can't be reached safely.
			const bestSpawn = this.findClosestSpawn(info.roomName);
			if (!bestSpawn) continue;

			info.spawnRoom = bestSpawn;

			bestTarget = info;
		}

		if (bestTarget) {
			memory.expand.currentTarget = bestTarget;

			// Spawn expansion squad at origin.
			const squad = new Squad('expand');
			squad.setSpawn(bestTarget.spawnRoom);

			// Sent to target room.
			squad.setTarget(new RoomPosition(25, 25, bestTarget.roomName));

			// @todo Place flags to guide squad through safe rooms and make pathfinding easier.
			squad.clearUnits();
			squad.setUnitCount('brawler', 1);
			squad.setUnitCount('singleClaim', 1);
			squad.setUnitCount('builder', 2);
			squad.setPath(null);
			memory.expand.started = Game.time;

			Game.notify('Started expanding to ' + bestTarget.roomName);
		}
	}

	if (memory.expand.currentTarget) {
		this.manageExpansionSupport();

		const info = memory.expand.currentTarget;
		const squad = new Squad('expand');

		this.checkAccessPath();

		if (Game.rooms[info.roomName]) {
			// @todo If path to controller is blocked, send dismantlers to dismantle
			// blocking buildings, or construct a tunnel to the controller.

			const room = Game.rooms[info.roomName];
			squad.setTarget(room.controller.pos);

			if (room.controller.my) {
				if (!memory.expand.claimed) {
					// Remove claimer from composition once room has been claimed.
					memory.expand.claimed = Game.time;
					squad.setUnitCount('singleClaim', 0);
				}

				if (room.controller.level > 3 && room.storage) {
					this.stopExpansion();
					return;
				}
			}
			else {
				this.checkClaimPath();
			}
		}

		// @todo Abort if claiming takes too long and we don't have anything
		// to dismantle in the way of the controller.

		// If a lot of time has passed, let the room fend for itself anyways,
		// either it will be lost or fix itself.
		if (Game.time - memory.expand.claimed > 50 * CREEP_LIFE_TIME) {
			this.stopExpansion();
		}
	}
};

/**
 * Stops current expansion plans by disbanding all related squads.
 */
ExpandProcess.prototype.stopExpansion = function () {
	const roomName = Memory.strategy.expand.currentTarget.roomName;
	const squad = new Squad('expand');
	squad.disband();

	_.each(Game.squads, (squad, squadName) => {
		if (squadName.startsWith('expandSupport.' + roomName)) {
			squad.disband();
		}
	});

	Memory.strategy.expand = {};
};

/**
 * Sends extra builders from rooms in range so the room is self-sufficient sooner.
 */
ExpandProcess.prototype.manageExpansionSupport = function () {
	const info = Memory.strategy.expand.currentTarget;
	if (!info) return;

	for (const roomName in Game.rooms) {
		const room = Game.rooms[roomName];
		if (!room.controller || !room.controller.my || room.controller.level < 4) continue;
		if (room.name === info.spawnRoom || room.name === info.roomName) continue;
		if (Game.map.getRoomLinearDistance(room.name, info.roomName) > 10) continue;

		const path = room.calculateRoomPath(info.roomName);
		if (!path || path.length > 15) continue;

		const supportSquad = new Squad('expandSupport.' + info.roomName + '.' + room.name);
		supportSquad.setSpawn(room.name);
		supportSquad.setTarget(new RoomPosition(25, 25, info.roomName));
		supportSquad.clearUnits();
		supportSquad.setUnitCount('builder', 1);
		supportSquad.setPath(null);
	}

	// Remove support squads from older rooms.
	_.each(_.filter(Game.flags, f => f.name.startsWith('AttackSquad:expandSupport.') && !f.name.startsWith('AttackSquad:expandSupport.' + info.roomName)), f => f.remove());
	_.each(_.filter(Game.flags, f => f.name.startsWith('SpawnSquad:expandSupport.') && !f.name.startsWith('SpawnSquad:expandSupport.' + info.roomName)), f => f.remove());
};

/**
 * Checks if creeps can reach the rooms controller, builds tunnels otherwise.
 */
ExpandProcess.prototype.checkClaimPath = function () {
	const info = Memory.strategy.expand.currentTarget;
	if (!info) return;

	const room = Game.rooms[info.roomName];
	const creeps = room.find(FIND_MY_CREEPS);

	const matrix = new PathFinder.CostMatrix();
	const terrain = new Room.Terrain(info.roomName);

	for (let x = 0; x < 50; x++) {
		for (let y = 0; y < 50; y++) {
			if (terrain.get(x, y) == TERRAIN_MASK_WALL) {
				matrix.set(x, y, 255);
			}
			else {
				matrix.set(x, y, 1);
			}
		}
	}

	const roads = room.find(FIND_STRUCTURES, {
		filter: s => s.structureType === STRUCTURE_ROAD,
	});
	for (const i in roads) {
		matrix.set(roads[i].pos.x, roads[i].pos.y, 255);
	}

	// Treat road sites as walkable so we don't calculate multiple tunnel paths, for example.
	const roadSites = room.find(FIND_CONSTRUCTION_SITES, {
		filter: s => s.structureType === STRUCTURE_ROAD,
	});
	for (const i in roadSites) {
		matrix.set(roadSites[i].pos.x, roadSites[i].pos.y, 255);
	}

	const structures = room.find(FIND_STRUCTURES, {
		filter: s => OBSTACLE_OBJECT_TYPES.indexOf(s.structureType) > -1 || (s.structureType === STRUCTURE_RAMPART && !s.my),
	});
	for (const i in structures) {
		matrix.set(structures[i].pos.x, structures[i].pos.y, 255);
	}

	for (const i in creeps) {
		const creep = creeps[i];

		const path = PathFinder.search(creep.pos, [{pos: room.controller.pos, range: 1}], {
			maxRooms: 1,
			plainCost: 1,
			swampCost: 1,
			roomCallback: roomName => {
				if (room.name !== roomName) return false;
				return matrix;
			},
		});
		if (path.incomplete) {
			// Find a new path that is allowed to go through walls, for
			// us to build tunnels.
			for (let x = 0; x < 50; x++) {
				for (let y = 0; y < 50; y++) {
					if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
						matrix.set(x, y, 50);
					}
				}
			}

			const tunnelPath = PathFinder.search(creep.pos, [{pos: room.controller.pos, range: 1}], {
				maxRooms: 1,
				plainCost: 1,
				swampCost: 1,
				roomCallback: roomName => {
					if (room.name !== roomName) return false;
					return matrix;
				},
			});

			if (tunnelPath.incomplete) {
				// @todo Abort expansion or dismantle structures?
			}
			else {
				// Build tunnels.
				for (const j in tunnelPath.path) {
					const pos = tunnelPath.path[j];
					if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) {
						pos.createConstructionSite(STRUCTURE_ROAD);
					}
				}

				// One path is enough.
				break;
			}
		}
	}
};

/**
 * Checks if there is a safe path to the current expansion for spawned creeps.
 */
ExpandProcess.prototype.checkAccessPath = function () {
	const info = Memory.strategy.expand.currentTarget;
	if (!info) return;

	const originRoom = Game.rooms[info.spawnRoom];
	if (originRoom) {
		const path = originRoom.calculateRoomPath(info.roomName);
		if (!path || path.length > 10) {
			// Path is too long, claimers might not even reach.
			if (!Memory.strategy.expand.pathBlocked) {
				Memory.strategy.expand.pathBlocked = Game.time;
			}
		}
		else {
			// Everything is fine (again).
			delete Memory.strategy.expand.pathBlocked;
		}
	}

	if (!originRoom || (Memory.strategy.expand.pathBlocked && Game.time - Memory.strategy.expand.pathBlocked > 5 * CREEP_LIFE_TIME)) {
		const newOrigin = this.findClosestSpawn(info.roomName);
		const squad = new Squad('expand');
		if (newOrigin) {
			info.spawnRoom = newOrigin;
			squad.setSpawn(newOrigin);
		}
		else {
			// No good spawn location available. Stop expanding, choose new target later.
			this.stopExpansion();
		}
	}
};

/**
 * Finds the closest valid spawn location for an expansion.
 */
ExpandProcess.prototype.findClosestSpawn = function (targetRoom) {
	let bestRoom = null;
	let bestLength = 0;
	for (const roomName in Game.rooms) {
		const room = Game.rooms[roomName];
		if (!room.controller || !room.controller.my || room.controller.level < 5) continue;
		if (room.name === targetRoom) continue;
		if (Game.map.getRoomLinearDistance(room.name, targetRoom) > 10) continue;

		const path = room.calculateRoomPath(targetRoom);
		if (!path || path.length > 10) continue;

		if (!bestRoom || bestLength > path.length) {
			bestRoom = room;
			bestLength = path.length;
		}
	}

	return bestRoom && bestRoom.name;
};

module.exports = ExpandProcess;
