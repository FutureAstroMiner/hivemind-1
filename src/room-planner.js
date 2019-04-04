'use strict';

/* global hivemind PathFinder Room RoomPosition RoomVisual Structure
STRUCTURE_ROAD STRUCTURE_SPAWN CONTROLLER_STRUCTURES CONSTRUCTION_COST
STRUCTURE_CONTAINER STRUCTURE_TOWER STRUCTURE_STORAGE STRUCTURE_EXTENSION
STRUCTURE_TERMINAL STRUCTURE_LINK STRUCTURE_EXTRACTOR LOOK_STRUCTURES
STRUCTURE_RAMPART LOOK_CONSTRUCTION_SITES MAX_CONSTRUCTION_SITES OK
STRUCTURE_WALL CREEP_LIFE_TIME STRUCTURE_LAB STRUCTURE_NUKER FIND_STRUCTURES
STRUCTURE_POWER_SPAWN STRUCTURE_OBSERVER FIND_HOSTILE_STRUCTURES
FIND_MY_CONSTRUCTION_SITES TERRAIN_MASK_WALL FIND_SOURCES FIND_MINERALS */

const utilities = require('./utilities');

const MAX_ROOM_LEVEL = 8;

/**
 * Creates a room layout and makes sure the room is built accordingly.
 * @constructor
 *
 * @todo Split off RoomManager class.
 *
 * @param {string} roomName
 *   Name of the room this room planner is assigned to.
 */
const RoomPlanner = function (roomName) {
	this.roomPlannerVersion = 23;
	this.roomName = roomName;
	this.room = Game.rooms[roomName]; // Will not always be available.

	if (!Memory.rooms[roomName]) {
		Memory.rooms[roomName] = {};
	}

	if (!Memory.rooms[roomName].roomPlanner) {
		Memory.rooms[roomName].roomPlanner = {};
	}

	this.memory = Memory.rooms[roomName].roomPlanner;

	if ((this.memory.drawDebug || 0) > 0) {
		this.memory.drawDebug--;
		this.drawDebug();
	}
};

/**
 * Draws a simple representation of the room layout using RoomVisuals.
 */
RoomPlanner.prototype.drawDebug = function () {
	const debugSymbols = {
		container: '⊔',
		exit: '🚪',
		extension: '⚬',
		lab: '🔬',
		link: '🔗',
		nuker: '☢',
		observer: '👁',
		powerSpawn: '⚡',
		rampart: '#',
		road: '·',
		spawn: '⭕',
		storage: '⬓',
		terminal: '⛋',
		tower: '⚔',
	};

	const visual = new RoomVisual(this.roomName);

	if (this.memory.locations) {
		for (const locationType in this.memory.locations) {
			if (!debugSymbols[locationType]) continue;

			const positions = this.memory.locations[locationType];
			for (const posName of _.keys(positions)) {
				const pos = utilities.decodePosition(posName);

				visual.text(debugSymbols[locationType], pos.x, pos.y + 0.2);
			}
		}
	}
};

/**
 * Allows this room planner to give commands in controlled rooms.
 */
RoomPlanner.prototype.runLogic = function () {
	if (Game.cpu.bucket < 3500) return;

	// Recalculate room layout if using a new version.
	if (!this.memory.plannerVersion || this.memory.plannerVersion !== this.roomPlannerVersion) {
		delete this.memory.locations;
		delete this.memory.planningTries;
		this.memory.plannerVersion = this.roomPlannerVersion;
	}

	// Sometimes room planning can't be finished successfully. Try a maximum of 10
	// times in that case.
	if (!this.memory.planningTries) this.memory.planningTries = 1;
	if (!this.memory.locations || (!this.memory.locations.observer && this.memory.planningTries <= 10)) {
		if (Game.cpu.getUsed() < Game.cpu.tickLimit / 2) {
			this.placeFlags();
			this.memory.planningTries++;
		}

		return;
	}

	if (!this.memory.runNextTick && this.memory.lastRun) {
		if (Game.time - this.memory.lastRun < 100 * hivemind.getThrottleMultiplier()) return;
	}

	delete this.memory.runNextTick;
	this.memory.lastRun = Game.time;

	// Prune old planning cost matrixes. They will be regenerated if needed.
	delete this.memory.wallDistanceMatrix;
	delete this.memory.exitDistanceMatrix;

	this.roomConstructionSites = this.room.find(FIND_MY_CONSTRUCTION_SITES);
	this.constructionSitesByType = _.groupBy(this.roomConstructionSites, 'structureType');
	this.roomStructures = this.room.find(FIND_STRUCTURES);
	this.structuresByType = _.groupBy(this.roomStructures, 'structureType');
	this.newStructures = 0;

	this.checkAdjacentRooms();

	this.cleanRoom();
	this.manageStructures();
};

/**
 * Removes structures that might prevent the room's construction.
 */
RoomPlanner.prototype.cleanRoom = function () {
	// Remove all roads not part of current room plan.
	const roomRoads = this.structuresByType[STRUCTURE_ROAD] || [];
	for (let i = 0; i < roomRoads.length; i++) {
		const road = roomRoads[i];
		if (!this.memory.locations.road || !this.memory.locations.road[utilities.encodePosition(road.pos)]) {
			road.destroy();
		}
	}

	// Remove unwanted walls.
	const roomWalls = this.structuresByType[STRUCTURE_WALL] || [];
	for (let i = 0; i < roomWalls.length; i++) {
		const wall = roomWalls[i];
		if (this.memory.locations.road[utilities.encodePosition(wall.pos)] ||
			this.memory.locations.spawn[utilities.encodePosition(wall.pos)] ||
			this.memory.locations.storage[utilities.encodePosition(wall.pos)] ||
			this.memory.locations.extension[utilities.encodePosition(wall.pos)]) {
			wall.destroy();
		}
	}

	// Remove hostile structures.
	const hostileStructures = this.room.find(FIND_HOSTILE_STRUCTURES);
	for (let i = 0; i < hostileStructures.length; i++) {
		hostileStructures[i].destroy();
	}
};

/**
 * Makes sure structures are built and removed as intended.
 */
RoomPlanner.prototype.manageStructures = function () {
	// Build road to sources asap to make getting energy easier.
	this.buildPlannedStructures('road.source', STRUCTURE_ROAD);

	// Make sure all current spawns have been built.
	const roomSpawns = this.structuresByType[STRUCTURE_SPAWN] || [];
	const roomSpawnSites = this.constructionSitesByType[STRUCTURE_SPAWN] || [];

	// Make sure spawns are built in the right place, remove otherwise.
	delete this.memory.hasMisplacedSpawn;
	if (roomSpawns.length >= CONTROLLER_STRUCTURES[STRUCTURE_SPAWN][this.room.controller.level] && this.roomConstructionSites.length === 0) {
		this.removeMisplacedSpawn(roomSpawns);
	}
	else if (roomSpawns.length + roomSpawnSites.length < CONTROLLER_STRUCTURES[STRUCTURE_SPAWN][this.room.controller.level]) {
		this.buildPlannedStructures('spawn', STRUCTURE_SPAWN);
	}

	this.buildPlannedStructures('wall.blocker', STRUCTURE_WALL);

	// Build road to controller for easier upgrading.
	this.buildPlannedStructures('road.controller', STRUCTURE_ROAD);

	if (this.room.controller.level === 0) {
		// If we're waiting for a claim, busy ourselves by building roads.
		this.buildPlannedStructures('road', STRUCTURE_ROAD);
	}

	if (this.room.controller.level < 2) return;

	// At level 2, we can start building containers at sources and controller.
	this.removeUnplannedStructures('container', STRUCTURE_CONTAINER);
	this.buildPlannedStructures('container.source', STRUCTURE_CONTAINER);
	this.buildPlannedStructures('container.controller', STRUCTURE_CONTAINER);

	// Make sure towers are built in the right place, remove otherwise.
	this.removeUnplannedStructures('tower', STRUCTURE_TOWER, 1);
	this.buildPlannedStructures('tower', STRUCTURE_TOWER);

	// Build storage ASAP.
	this.buildPlannedStructures('storage', STRUCTURE_STORAGE);

	// Make sure extensions are built in the right place, remove otherwise.
	this.removeUnplannedStructures('extension', STRUCTURE_EXTENSION, 1);
	this.buildPlannedStructures('extension', STRUCTURE_EXTENSION);

	// Also build terminal when available.
	this.buildPlannedStructures('terminal', STRUCTURE_TERMINAL);

	// Make sure links are built in the right place, remove otherwise.
	this.removeUnplannedStructures('link', STRUCTURE_LINK, 1);
	this.buildPlannedStructures('link.storage', STRUCTURE_LINK);
	this.buildPlannedStructures('link.sources', STRUCTURE_LINK);
	this.buildPlannedStructures('link.controller', STRUCTURE_LINK);
	this.buildPlannedStructures('link', STRUCTURE_LINK);

	// Build extractor and related container if available.
	if (CONTROLLER_STRUCTURES[STRUCTURE_EXTRACTOR][this.room.controller.level] > 0) {
		this.buildPlannedStructures('extractor', STRUCTURE_EXTRACTOR);
		this.buildPlannedStructures('container.mineral', STRUCTURE_CONTAINER);
	}

	if (this.room.controller.level < 3) return;

	// At level 3, we can build all remaining roads.
	this.buildPlannedStructures('road', STRUCTURE_ROAD);

	if (this.room.controller.level < 4) return;

	// Make sure all requested ramparts are built.
	this.buildPlannedStructures('rampart', STRUCTURE_RAMPART);

	// Slate all unmanaged walls and ramparts for deconstruction.
	const unwantedDefenses = this.room.find(FIND_STRUCTURES, {
		filter: structure => {
			if (structure.structureType === STRUCTURE_WALL && !this.isPlannedLocation(structure.pos, 'wall')) return true;
			if (structure.structureType === STRUCTURE_RAMPART) {
				// Keep rampart if it is one we have placed.
				const pos = utilities.encodePosition(structure.pos);
				if (this.memory.locations.rampart && this.memory.locations.rampart[pos]) return false;

				return true;
			}

			return false;
		},
	});

	if (!this.memory.dismantle) {
		this.memory.dismantle = {};
	}

	for (const structure of unwantedDefenses) {
		this.memory.dismantle[structure.id] = 1;
	}

	// Further constructions should only happen in safe rooms.
	if (this.room && this.room.isEvacuating()) return;
	if (!this.checkWallIntegrity()) return;

	// Make sure labs are built in the right place, remove otherwise.
	this.removeUnplannedStructures('lab', STRUCTURE_LAB, 1);
	this.buildPlannedStructures('lab', STRUCTURE_LAB);

	// Make sure all current nukers have been built.
	if (_.size(this.roomConstructionSites) === 0) this.removeUnplannedStructures('nuker', STRUCTURE_NUKER, 1);
	this.buildPlannedStructures('nuker', STRUCTURE_NUKER);

	// Make sure all current power spawns have been built.
	if (_.size(this.roomConstructionSites) === 0) this.removeUnplannedStructures('powerSpawn', STRUCTURE_POWER_SPAWN, 1);
	this.buildPlannedStructures('powerSpawn', STRUCTURE_POWER_SPAWN);

	// Make sure all current observers have been built.
	if (_.size(this.roomConstructionSites) === 0) this.removeUnplannedStructures('observer', STRUCTURE_OBSERVER, 1);
	this.buildPlannedStructures('observer', STRUCTURE_OBSERVER);
};

/**
 * Try placing construction sites of the given type at all locations.
 *
 * @param {string} locationType
 *   The type of location that should be checked.
 * @param {string} structureType
 *   The type of structure to place.
 *
 * @return {boolean}
 *   True if we can continue building.
 */
RoomPlanner.prototype.buildPlannedStructures = function (locationType, structureType) {
	let canBuildMore = true;
	for (const posName of _.keys(this.memory.locations[locationType])) {
		const pos = utilities.decodePosition(posName);

		canBuildMore &= this.tryBuild(pos, structureType);
	}

	return canBuildMore;
};

/**
 * Tries to place a construction site.
 *
 * @param {RoomPosition} pos
 *   The position at which to place the structure.
 * @param {string} structureType
 *   The type of structure to place.
 *
 * @return {boolean}
 *   True if we can continue building.
 */
RoomPlanner.prototype.tryBuild = function (pos, structureType) {
	// Check if there's a structure here already.
	const structures = pos.lookFor(LOOK_STRUCTURES);
	for (const i in structures) {
		if (structures[i].structureType === structureType) {
			// Structure is here, continue.
			return true;
		}
	}

	// Check if there's a construction site here already.
	const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
	for (const i in sites) {
		if (sites[i].structureType === structureType) {
			// Structure is being built, wait until finished.
			return false;
		}
	}

	if (this.newStructures + this.roomConstructionSites.length < 5 && _.size(Game.constructionSites) < MAX_CONSTRUCTION_SITES * 0.9) {
		if (pos.createConstructionSite(structureType) === OK) {
			this.newStructures++;
			// Structure is being built, wait until finished.
			return false;
		}

		// Some other structure is blocking or we can't build more of this structure.
		// Building logic should continue for now.
		return true;
	}

	// We can't build anymore in this room right now.
	return false;
};

/**
 * Removes misplaced spawns for rebuilding at a new location.
 *
 * @param {StructureSpawn[]} roomSpawns
 *   List of spawns in the room.
 *
 * @return {boolean}
 *   True if a spawn was destroyed this tick.
 */
RoomPlanner.prototype.removeMisplacedSpawn = function (roomSpawns) {
	for (let i = 0; i < roomSpawns.length; i++) {
		const spawn = roomSpawns[i];
		if (this.memory.locations.spawn && this.memory.locations.spawn[utilities.encodePosition(spawn.pos)]) continue;
		if (spawn.spawning) continue;

		// Only destroy spawn if there are enough resources and builders available.
		const resourcesAvailable = (this.room.storage && this.room.storage.store.energy > CONSTRUCTION_COST[STRUCTURE_SPAWN] * 2 && _.size(this.room.creepsByRole.builder) > 1);
		if (!resourcesAvailable && _.size(roomSpawns) === 1) return false;

		// This spawn is misplaced, set a flag for spawning more builders to help.
		if (this.room.storage && this.room.storage.store.energy > CONSTRUCTION_COST[STRUCTURE_SPAWN] * 3) {
			this.memory.hasMisplacedSpawn = true;
		}

		let buildPower = 0;
		for (const creep of _.values(this.room.creepsByRole.builder)) {
			if (creep.ticksToLive) {
				buildPower += creep.memory.body.work * creep.ticksToLive / CREEP_LIFE_TIME;
			}
		}

		if (buildPower > 10) {
			spawn.destroy();
			this.memory.runNextTick = true;
			// Only kill of one spawn at a time, it should be rebuilt right away next tick!
			return true;
		}
	}

	return false;
};

/**
 * Remove structures that are not part of the current building plan.
 *
 * @param {string} locationType
 *   The type of location that should be checked.
 * @param {string} structureType
 *   The type of structure to remove.
 * @param {number} amount
 *   Maximum number of structures to remove during a single tick.
 */
RoomPlanner.prototype.removeUnplannedStructures = function (locationType, structureType, amount) {
	const structures = this.structuresByType[structureType] || [];
	const sites = this.constructionSitesByType[structureType] || [];

	let limit = CONTROLLER_STRUCTURES[structureType][this.room.controller.level];
	if (amount) {
		limit = amount + structures.length + sites.length - limit;
	}

	let count = 0;
	if (this.memory.locations[locationType]) {
		for (const structure of structures) {
			if (!this.memory.locations[locationType][utilities.encodePosition(structure.pos)]) {
				if (count < limit) {
					structure.destroy();
					count++;
				}
				else break;
			}
		}
	}
};

/**
 * Checks if all ramparts in the room have at least 500.000 hits.
 *
 * @return {boolean}
 *   True if walls are considered complete.
 */
RoomPlanner.prototype.checkWallIntegrity = function () {
	for (const posName of _.keys(this.memory.locations.rampart)) {
		const pos = utilities.decodePosition(posName);

		// Check if there's a rampart here already.
		const structures = pos.lookFor(LOOK_STRUCTURES);
		if (_.filter(structures, structure => structure.structureType === STRUCTURE_RAMPART && structure.hits >= 500000).length === 0) {
			return false;
		}
	}

	return true;
};

/**
 * Decides whether a dismantler is needed in the current room.
 *
 * @return {boolean}
 *   True if a dismantler should be spawned.
 */
RoomPlanner.prototype.needsDismantling = function () {
	return _.size(this.memory.dismantle) > 0;
};

/**
 * Decides on a structure that needs to be dismantled.
 *
 * @return {Structure}
 *   The next structure to dismantle.
 */
RoomPlanner.prototype.getDismantleTarget = function () {
	if (!this.needsDismantling()) return null;

	for (const id of _.keys(this.memory.dismantle)) {
		const structure = Game.getObjectById(id);
		if (!structure) {
			delete this.memory.dismantle[id];
			continue;
		}

		// If there's a rampart on it, dismantle the rampart first if requested, or just destroy the building immediately.
		const structures = structure.pos.lookFor(LOOK_STRUCTURES);
		let innocentRampartFound = false;
		for (const i in structures) {
			if (structures[i].structureType === STRUCTURE_RAMPART) {
				if (this.memory.dismantle[structures[i].id]) {
					return structures[i];
				}

				structure.destroy();
				innocentRampartFound = true;
				break;
			}
		}

		if (!innocentRampartFound) {
			return structure;
		}
	}

	return null;
};

/**
 * Decides whether a structure is supposed to be dismantled.
 *
 * @return {boolean}
 *   True if the structure should be dismantled.
 */
Structure.prototype.needsDismantling = function () {
	if (!this.room.roomPlanner || !this.room.roomPlanner.needsDismantling()) return false;

	if (this.room.roomPlanner.memory.dismantle && this.room.roomPlanner.memory.dismantle[this.id]) {
		return true;
	}

	return false;
};

/**
 * Plans a room planner location of a certain type.
 *
 * @param {RoomPosition} pos
 *   Position to plan the structure at.
 * @param {string} locationType
 *   Type of location to plan.
 * @param {number} pathFindingCost
 *   Value to set in the pathfinding costmatrix at this position (Default 255).
 */
RoomPlanner.prototype.placeFlag = function (pos, locationType, pathFindingCost) {
	const posName = utilities.encodePosition(pos);

	if (!this.memory.locations) {
		this.memory.locations = {};
	}

	if (!this.memory.locations[locationType]) {
		this.memory.locations[locationType] = {};
	}

	this.memory.locations[locationType][posName] = 1;

	if (typeof pathFindingCost === 'undefined') {
		pathFindingCost = 255;
	}

	if (pathFindingCost && this.buildingMatrix.get(pos.x, pos.y) < 100) {
		this.buildingMatrix.set(pos.x, pos.y, pathFindingCost);
	}
};

/**
 * Generates CostMatrixes needed for structure placement.
 */
RoomPlanner.prototype.generateDistanceMatrixes = function () {
	const wallMatrix = new PathFinder.CostMatrix();
	const exitMatrix = new PathFinder.CostMatrix();

	this.prepareDistanceMatrixes(wallMatrix, exitMatrix);

	// @todo Use some kind of flood fill to calculate these faster.
	let currentDistance = 1;
	let done = false;
	while (!done) {
		done = true;

		for (let x = 0; x < 50; x++) {
			for (let y = 0; y < 50; y++) {
				done &= !this.markDistanceTiles(wallMatrix, currentDistance, x, y);
				done &= !this.markDistanceTiles(exitMatrix, currentDistance, x, y);
			}
		}

		currentDistance++;
	}

	this.memory.wallDistanceMatrix = wallMatrix.serialize();
	this.memory.exitDistanceMatrix = exitMatrix.serialize();
};

/**
 * Initializes wall and exit distance matrix with walls and adjacent tiles.
 *
 * @param {PathFinder.CostMatrix} wallMatrix
 *   Matrix that will have a 1 next to every wall tile.
 * @param {PathFinder.CostMatrix} exitMatrix
 *   Matrix that will have a 1 at every exit tile.
 */
RoomPlanner.prototype.prepareDistanceMatrixes = function (wallMatrix, exitMatrix) {
	const terrain = new Room.Terrain(this.roomName);

	for (let x = 0; x < 50; x++) {
		for (let y = 0; y < 50; y++) {
			if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
				wallMatrix.set(x, y, 255);
				exitMatrix.set(x, y, 255);
				continue;
			}

			if (x === 0 || x === 49 || y === 0 || y === 49) {
				exitMatrix.set(x, y, 1);
			}

			this.markWallAdjacentTiles(wallMatrix, terrain, x, y);
		}
	}
};

/**
 * Sets a tile's value to 1 if it is next to a wall.
 *
 * @param {PathFinder.CostMatrix} matrix
 *   The matrix to modify.
 * @param {Room.Terrain} terrain
 *   Terrain data for the room we are handling.
 * @param {number} x
 *   x position of the tile in question.
 * @param {number} y
 *   y position of the tile in question.
 */
RoomPlanner.prototype.markWallAdjacentTiles = function (matrix, terrain, x, y) {
	utilities.handleMapArea(x, y, (ax, ay) => {
		if (terrain.get(ax, ay) === TERRAIN_MASK_WALL) {
			matrix.set(x, y, 1);
			return false;
		}
	});
};

/**
 * Sets a tile's value if it is 0 and has a tile value of distance adjacent.
 *
 * @param {PathFinder.CostMatrix} matrix
 *   The matrix to modify.
 * @param {number} distance
 *   Distance value to look for in adjacent tiles.
 * @param {number} x
 *   x position of the tile in question.
 * @param {number} y
 *   y position of the tile in question.
 *
 * @return {boolean}
 *   True if tile value was modified.
 */
RoomPlanner.prototype.markDistanceTiles = function (matrix, distance, x, y) {
	if (matrix.get(x, y) !== 0) return false;

	let modified = false;
	utilities.handleMapArea(x, y, (ax, ay) => {
		if (matrix.get(ax, ay) === distance) {
			matrix.set(x, y, distance + 1);
			modified = true;
			return false;
		}
	});

	return modified;
};

/**
 * Find positions from where many exit tiles are in short range.
 *
 * @return {object}
 *   An object keyed by exit direction containing objects with the following
 *   keys:
 *   - count: 0 in preparation for storing actual tower number. @todo remove
 *   - tiles: A list of potential tower positions.
 */
RoomPlanner.prototype.findTowerPositions = function () {
	const positions = {
		N: {count: 0, tiles: []},
		E: {count: 0, tiles: []},
		S: {count: 0, tiles: []},
		W: {count: 0, tiles: []},
	};

	const allDirectionsSafe = _.sum(this.memory.adjacentSafe) === 4;
	const terrain = new Room.Terrain(this.roomName);
	for (let x = 1; x < 49; x++) {
		for (let y = 1; y < 49; y++) {
			if (this.buildingMatrix.get(x, y) !== 0 && this.buildingMatrix.get(x, y) !== 10) continue;
			if (this.safetyMatrix.get(x, y) !== 1) continue;
			if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
			let score = 0;

			let tileDir;
			if (x > y) {
				// Northeast.
				if (49 - x > y) tileDir = 'N';
				else tileDir = 'E';
			}
			// Southwest.
			else if (49 - x > y) tileDir = 'W';
			else tileDir = 'S';

			// No need to check in directions where there is no exit.
			if (this.exitTiles[tileDir].length === 0) continue;

			// Don't count exits toward "safe" rooms or dead ends.
			if (!allDirectionsSafe && this.memory.adjacentSafe && this.memory.adjacentSafe[tileDir]) continue;

			for (const dir in this.exitTiles) {
				// Don't score distance to exits toward "safe" rooms or dead ends.
				// Unless all directions are safe.
				if (!allDirectionsSafe && this.memory.adjacentSafe && this.memory.adjacentSafe[dir]) continue;

				for (const pos of this.exitTiles[dir]) {
					score += 1 / pos.getRangeTo(x, y);
				}
			}

			positions[tileDir].tiles.push({
				score,
				pos: new RoomPosition(x, y, this.roomName),
			});
		}
	}

	return positions;
};

/**
 * Makes plans for a room and place flags to visualize.
 */
RoomPlanner.prototype.placeFlags = function () {
	// @todo Place some ramparts on spawns and maybe towers as a last protection
	// if walls go down.
	// @todo Build small ramparts on spawns and on paths close to exit
	// where enemy ranged creeps might reach.
	const start = Game.cpu.getUsed();

	if (!this.memory.wallDistanceMatrix) {
		this.generateDistanceMatrixes();
		return;
	}

	// Reset location memory, to be replaced with new flags.
	this.memory.locations = {};
	this.wallDistanceMatrix = PathFinder.CostMatrix.deserialize(this.memory.wallDistanceMatrix);
	this.exitDistanceMatrix = PathFinder.CostMatrix.deserialize(this.memory.exitDistanceMatrix);

	// Prepare CostMatrix and exit points.
	this.exitTiles = {
		N: [],
		S: [],
		W: [],
		E: [],
	};
	const potentialWallPositions = [];
	const potentialCenterPositions = [];
	this.roads = [];
	this.prepareBuildingMatrix(potentialWallPositions, potentialCenterPositions);

	// Decide where exit regions are and where walls should be placed.
	const exitCenters = this.findExitCenters();

	// Decide where room center should be by averaging exit positions.
	let cx = 0;
	let cy = 0;
	let count = 0;
	for (const dir of _.keys(exitCenters)) {
		for (const pos of exitCenters[dir]) {
			count++;
			cx += pos.x;
			cy += pos.y;
		}
	}

	cx = Math.floor(cx / count);
	cy = Math.floor(cy / count);

	// Find closest position with distance from walls around there.
	const roomCenter = (new RoomPosition(cx, cy, this.roomName)).findClosestByRange(potentialCenterPositions);
	this.roomCenter = roomCenter;
	this.placeFlag(roomCenter, 'center', null);

	// Do another flood fill pass from interesting positions to remove walls that don't protect anything.
	this.pruneWalls(potentialWallPositions);

	// Actually place ramparts.
	for (const i in potentialWallPositions) {
		if (potentialWallPositions[i].isRelevant) {
			this.placeFlag(potentialWallPositions[i], 'rampart', null);
		}
	}

	// Center is accessible via the 4 cardinal directions.
	this.roomCenterEntrances = [
		new RoomPosition(roomCenter.x + 2, roomCenter.y, this.roomName),
		new RoomPosition(roomCenter.x - 2, roomCenter.y, this.roomName),
		new RoomPosition(roomCenter.x, roomCenter.y + 2, this.roomName),
		new RoomPosition(roomCenter.x, roomCenter.y - 2, this.roomName),
	];

	// Find paths from each exit towards the room center for making roads.
	for (const dir of _.keys(exitCenters)) {
		for (const pos of exitCenters[dir]) {
			this.scanAndAddRoad(pos, this.roomCenterEntrances);
		}
	}

	if (this.room) {
		// @todo Have intelManager save locations (not just IDs) of sources, minerals and controller, so we don't need room access here.
		// We also save which road belongs to which path, so we can selectively autobuild roads during room bootstrap instead of building all roads at once.
		if (this.room.controller) {
			const controllerRoads = this.scanAndAddRoad(this.room.controller.pos, this.roomCenterEntrances);
			for (const i in controllerRoads) {
				if (i === 0) continue;
				this.placeFlag(controllerRoads[i], 'road.controller', null);
			}

			this.placeContainer(controllerRoads, 'controller');

			// Place a link near controller, but off the calculated path.
			this.placeLink(controllerRoads, 'controller');
		}

		if (this.room.mineral) {
			this.placeFlag(this.room.mineral.pos, 'extractor');
			const mineralRoads = this.scanAndAddRoad(this.room.mineral.pos, this.roomCenterEntrances);
			for (const pos of mineralRoads) {
				this.placeFlag(pos, 'road.mineral', null);
			}

			this.placeContainer(mineralRoads, 'mineral');

			// Make sure no other paths get led through harvester position.
			this.buildingMatrix.set(mineralRoads[0].x, mineralRoads[0].y, 255);
		}

		if (this.room.sources) {
			for (const source of this.room.sources) {
				const sourceRoads = this.scanAndAddRoad(source.pos, this.roomCenterEntrances);
				for (const pos of sourceRoads) {
					this.placeFlag(pos, 'road.source', null);
				}

				this.placeContainer(sourceRoads, 'source');

				// Place a link near sources, but off the calculated path.
				this.placeLink(sourceRoads, 'source');

				// Make sure no other paths get led through harvester position.
				this.buildingMatrix.set(sourceRoads[0].x, sourceRoads[0].y, 255);
			}
		}
	}

	for (const pos of this.roads) {
		this.placeFlag(pos, 'road', 1);
	}

	this.placeRoomCore();

	this.startBuildingPlacement();
	this.placeAll('spawn', true);
	this.placeHelperParkingLot();
	this.placeBays();
	this.placeLabs();
	this.placeAll('powerSpawn', true);
	this.placeAll('nuker', true);
	this.placeAll('observer', false);
	this.placeTowers();
	this.placeSpawnWalls();

	const end = Game.cpu.getUsed();
	console.log('Planning for', this.roomName, 'took', end - start, 'CPU');
};

/**
 * Prepares building cost matrix.
 *
 * @param {RoomPosition[]} potentialWallPositions
 *   List of potential wall positions for this room to add to.
 * @param {RoomPosition[]} potentialCenterPositions
 *   List of potential room core positions to add to.
 */
RoomPlanner.prototype.prepareBuildingMatrix = function (potentialWallPositions, potentialCenterPositions) {
	const terrain = new Room.Terrain(this.roomName);
	this.buildingMatrix = new PathFinder.CostMatrix();
	for (let x = 0; x < 50; x++) {
		for (let y = 0; y < 50; y++) {
			if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
				this.buildingMatrix.set(x, y, 255);
				continue;
			}

			// Register room exit tiles.
			if (x === 0) this.exitTiles.W.push(new RoomPosition(x, y, this.roomName));
			if (x === 49) this.exitTiles.E.push(new RoomPosition(x, y, this.roomName));
			if (y === 0) this.exitTiles.N.push(new RoomPosition(x, y, this.roomName));
			if (y === 49) this.exitTiles.S.push(new RoomPosition(x, y, this.roomName));

			// Treat border as unwalkable for in-room pathfinding.
			if (x === 0 || y === 0 || x === 49 || y === 49) {
				this.buildingMatrix.set(x, y, 255);
				continue;
			}

			// Avoid pathfinding close to walls to keep space for dodging and building / wider roads.
			const wallDistance = this.wallDistanceMatrix.get(x, y);
			const exitDistance = this.exitDistanceMatrix.get(x, y);

			if (wallDistance === 1) {
				this.buildingMatrix.set(x, y, 10);
			}

			if (wallDistance >= 4 && wallDistance < 255 && exitDistance > 8) {
				potentialCenterPositions.push(new RoomPosition(x, y, this.roomName));
			}

			if (exitDistance <= 2) {
				// Avoid tiles we can't build ramparts on.
				this.buildingMatrix.set(x, y, 20);
			}

			if (exitDistance > 2 && exitDistance <= 5) {
				// Avoid area near exits and room walls to not get shot at.
				this.buildingMatrix.set(x, y, 10);

				if (exitDistance === 3) {
					potentialWallPositions.push(new RoomPosition(x, y, this.roomName));
				}
			}
		}
	}
};

/**
 * Finds center positions of all room exits.
 *
 * @return {object}
 *   Array of RoomPosition objects, keyed by exit direction.
 */
RoomPlanner.prototype.findExitCenters = function () {
	const exitCenters = {};

	for (const dir of _.keys(this.exitTiles)) {
		exitCenters[dir] = [];

		let startPos = null;
		let prevPos = null;
		for (const pos of this.exitTiles[dir]) {
			if (!startPos) {
				startPos = pos;
			}

			if (prevPos && pos.getRangeTo(prevPos) > 1) {
				// New exit block started.
				const middlePos = new RoomPosition(Math.ceil((prevPos.x + startPos.x) / 2), Math.ceil((prevPos.y + startPos.y) / 2), this.roomName);
				exitCenters[dir].push(middlePos);

				startPos = pos;
			}

			prevPos = pos;
		}

		if (startPos) {
			// Finish last wall run.
			const middlePos = new RoomPosition(Math.ceil((prevPos.x + startPos.x) / 2), Math.ceil((prevPos.y + startPos.y) / 2), this.roomName);
			exitCenters[dir].push(middlePos);
		}

		for (const pos of exitCenters[dir]) {
			this.placeFlag(pos, 'exit', null);
		}
	}

	return exitCenters;
};

/**
 * Places a link near a given road.
 *
 * @param {RoomPosition[]} sourceRoads
 *   Positions that make up the road.
 * @param {string} linkType
 *   Type identifier for this link, like `source` or `controller`.
 */
RoomPlanner.prototype.placeLink = function (sourceRoads, linkType) {
	const targetPos = this.findLinkPosition(sourceRoads);

	if (!targetPos) return;

	if (linkType) {
		this.placeFlag(targetPos, 'link.' + linkType, null);
	}

	this.placeFlag(targetPos, 'link');
};

/**
 * Finds a spot for a link near a given road.
 *
 * @param {RoomPosition[]} sourceRoads
 *   Positions that make up the road.
 *
 * @return {RoomPosition}
 *   A Position at which a container can be placed.
 */
RoomPlanner.prototype.findLinkPosition = function (sourceRoads) {
	for (const pos of _.slice(sourceRoads, 0, 3)) {
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				if (this.isBuildableTile(pos.x + dx, pos.y + dy)) {
					return new RoomPosition(pos.x + dx, pos.y + dy, pos.roomName);
				}
			}
		}
	}
};

/**
 * Places a container near a given road.
 *
 * @param {RoomPosition[]} sourceRoads
 *   Positions that make up the road.
 * @param {string} containerType
 *   Type identifier for this container, like `source` or `controller`.
 */
RoomPlanner.prototype.placeContainer = function (sourceRoads, containerType) {
	const targetPos = this.findContainerPosition(sourceRoads);

	if (!targetPos) return;

	if (containerType) {
		this.placeFlag(targetPos, 'container.' + containerType, null);
	}

	this.placeFlag(targetPos, 'container', 1);
};

/**
 * Finds a spot for a container near a given road.
 *
 * @param {RoomPosition[]} sourceRoads
 *   Positions that make up the road.
 *
 * @return {RoomPosition}
 *   A Position at which a container can be placed.
 */
RoomPlanner.prototype.findContainerPosition = function (sourceRoads) {
	if (this.isBuildableTile(sourceRoads[1].x, sourceRoads[1].y, true)) {
		return sourceRoads[1];
	}

	if (this.isBuildableTile(sourceRoads[0].x, sourceRoads[0].y, true)) {
		return sourceRoads[0];
	}

	for (const pos of _.slice(sourceRoads, 0, 3)) {
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 1; dy++) {
				if (this.isBuildableTile(pos.x + dx, pos.y + dy, true)) {
					return new RoomPosition(pos.x + dx, pos.y + dy, pos.roomName);
				}
			}
		}
	}
};

/**
 * Places structures that are fixed to the room's center.
 */
RoomPlanner.prototype.placeRoomCore = function () {
	// Fill center cross with roads.
	this.placeFlag(new RoomPosition(this.roomCenter.x - 1, this.roomCenter.y, this.roomName), 'road', 1);
	this.placeFlag(new RoomPosition(this.roomCenter.x + 1, this.roomCenter.y, this.roomName), 'road', 1);
	this.placeFlag(new RoomPosition(this.roomCenter.x, this.roomCenter.y - 1, this.roomName), 'road', 1);
	this.placeFlag(new RoomPosition(this.roomCenter.x, this.roomCenter.y + 1, this.roomName), 'road', 1);
	this.placeFlag(new RoomPosition(this.roomCenter.x, this.roomCenter.y, this.roomName), 'road', 1);

	// Mark center buildings for construction.
	this.placeFlag(new RoomPosition(this.roomCenter.x - 1, this.roomCenter.y + 1, this.roomName), 'storage');
	this.placeFlag(new RoomPosition(this.roomCenter.x - 1, this.roomCenter.y - 1, this.roomName), 'terminal');
	this.placeFlag(new RoomPosition(this.roomCenter.x + 1, this.roomCenter.y + 1, this.roomName), 'lab');
	this.placeFlag(new RoomPosition(this.roomCenter.x + 1, this.roomCenter.y - 1, this.roomName), 'link');
	this.placeFlag(new RoomPosition(this.roomCenter.x + 1, this.roomCenter.y - 1, this.roomName), 'link.storage');
};

/**
 * Places parking spot for helper creep.
 */
RoomPlanner.prototype.placeHelperParkingLot = function () {
	const nextPos = this.getNextAvailableBuildSpot();
	if (!nextPos) return;

	const flagKey = 'Helper:' + nextPos.roomName;
	if (Game.flags[flagKey]) {
		Game.flags[flagKey].setPosition(nextPos);
	}
	else {
		nextPos.createFlag(flagKey);
	}

	this.placeFlag(nextPos, 'road', 255);
	this.placeFlag(nextPos, 'helper_parking');

	this.placeAccessRoad(nextPos);

	this.filterOpenList(utilities.encodePosition(nextPos));
};

/**
 * Places extension bays.
 */
RoomPlanner.prototype.placeBays = function () {
	let bayCount = 0;
	while (this.canPlaceMore('extension')) {
		const pos = this.findBayPosition();
		if (!pos) break;

		this.placeAccessRoad(pos);

		// Make sure there is a road in the center of the bay.
		this.placeFlag(pos, 'road', 1);
		this.placeFlag(pos, 'bay_center', 1);

		// Fill other unused spots with extensions.
		utilities.handleMapArea(pos.x, pos.y, (x, y) => {
			if (!this.isBuildableTile(x, y)) return;

			this.placeFlag(new RoomPosition(x, y, pos.roomName), 'extension');
		});

		// Place a flag to mark this bay.
		const flagKey = 'Bay:' + pos.roomName + ':' + bayCount;
		if (Game.flags[flagKey]) {
			Game.flags[flagKey].setPosition(pos);
		}
		else {
			pos.createFlag(flagKey);
		}

		bayCount++;

		// Reinitialize pathfinding.
		this.startBuildingPlacement();
	}

	// Remove other bay flags in room that might be left over.
	for (let i = bayCount; i < 30; i++) {
		const flagKey = 'Bay:' + this.roomName + ':' + i;
		if (Game.flags[flagKey]) {
			Game.flags[flagKey].remove();
		}
	}
};

/**
 * Finds best position to place a new bay at.
 *
 * @return {RoomPosition}
 *   The calculated position.
 */
RoomPlanner.prototype.findBayPosition = function () {
	let maxExtensions = 0;
	let bestPos = null;
	let bestScore = 0;

	while (maxExtensions < 8) {
		const nextPos = this.getNextAvailableBuildSpot();
		if (!nextPos) break;

		// Don't build too close to exits.
		if (this.exitDistanceMatrix.get(nextPos.x, nextPos.y) < 8) continue;

		if (!this.isBuildableTile(nextPos.x, nextPos.y)) continue;

		// @todo One tile is allowed to be a road.
		let tileCount = 0;
		if (this.isBuildableTile(nextPos.x - 1, nextPos.y)) tileCount++;
		if (this.isBuildableTile(nextPos.x + 1, nextPos.y)) tileCount++;
		if (this.isBuildableTile(nextPos.x, nextPos.y - 1)) tileCount++;
		if (this.isBuildableTile(nextPos.x, nextPos.y + 1)) tileCount++;
		if (this.isBuildableTile(nextPos.x - 1, nextPos.y - 1)) tileCount++;
		if (this.isBuildableTile(nextPos.x + 1, nextPos.y - 1)) tileCount++;
		if (this.isBuildableTile(nextPos.x - 1, nextPos.y + 1)) tileCount++;
		if (this.isBuildableTile(nextPos.x + 1, nextPos.y + 1)) tileCount++;

		if (tileCount <= maxExtensions) continue;

		maxExtensions = tileCount;
		const score = tileCount / (this.getCurrentBuildSpotInfo().range + 10);
		if (score > bestScore && tileCount >= 4) {
			bestPos = nextPos;
			bestScore = score;
		}
	}

	if (maxExtensions < 4) return null;

	return bestPos;
};

/**
 * Places labs in big compounds.
 */
RoomPlanner.prototype.placeLabs = function () {
	while (this.canPlaceMore('lab')) {
		const nextPos = this.getNextAvailableBuildSpot();
		if (!nextPos) break;

		// Don't build too close to exits.
		if (this.exitDistanceMatrix.get(nextPos.x, nextPos.y) < 8) continue;

		// @todo Dynamically generate lab layout for servers where 10 labs is not the max.
		// @todo Allow rotating this blueprint for better access.
		if (!this.isBuildableTile(nextPos.x, nextPos.y)) continue;
		if (!this.isBuildableTile(nextPos.x - 1, nextPos.y)) continue;
		if (!this.isBuildableTile(nextPos.x + 1, nextPos.y)) continue;
		if (!this.isBuildableTile(nextPos.x, nextPos.y - 1)) continue;
		if (!this.isBuildableTile(nextPos.x, nextPos.y + 1)) continue;
		if (!this.isBuildableTile(nextPos.x - 1, nextPos.y - 1)) continue;
		if (!this.isBuildableTile(nextPos.x + 1, nextPos.y - 1)) continue;
		if (!this.isBuildableTile(nextPos.x - 1, nextPos.y + 1)) continue;
		if (!this.isBuildableTile(nextPos.x + 1, nextPos.y + 1)) continue;
		if (!this.isBuildableTile(nextPos.x - 1, nextPos.y + 2)) continue;
		if (!this.isBuildableTile(nextPos.x, nextPos.y + 2)) continue;
		if (!this.isBuildableTile(nextPos.x + 1, nextPos.y + 2)) continue;

		// Place center area.
		this.placeFlag(new RoomPosition(nextPos.x - 1, nextPos.y, nextPos.roomName), 'lab');
		this.placeFlag(new RoomPosition(nextPos.x, nextPos.y, nextPos.roomName), 'road', 1);

		this.placeFlag(new RoomPosition(nextPos.x + 1, nextPos.y, nextPos.roomName), 'lab');
		this.placeFlag(new RoomPosition(nextPos.x - 1, nextPos.y + 1, nextPos.roomName), 'lab');
		this.placeFlag(new RoomPosition(nextPos.x, nextPos.y + 1, nextPos.roomName), 'road', 1);

		this.placeFlag(new RoomPosition(nextPos.x + 1, nextPos.y + 1, nextPos.roomName), 'lab');

		this.placeAccessRoad(nextPos);

		// Add top and bottom buildings.
		for (let dx = -1; dx <= 1; dx++) {
			for (let dy = -1; dy <= 2; dy += 3) {
				if (this.isBuildableTile(nextPos.x + dx, nextPos.y + dy)) {
					this.placeFlag(new RoomPosition(nextPos.x + dx, nextPos.y + dy, nextPos.roomName), 'lab');
				}
			}
		}

		// Reinitialize pathfinding.
		this.startBuildingPlacement();
	}
};

/**
 * Places towers so exits are well covered.
 */
RoomPlanner.prototype.placeTowers = function () {
	const positions = this.findTowerPositions();
	while (this.canPlaceMore('tower')) {
		let info = null;
		let bestDir = null;
		for (const dir of _.keys(positions)) {
			for (const tile of positions[dir].tiles) {
				if (!info || positions[bestDir].count > positions[dir].count || (info.score < tile.score && positions[bestDir].count === positions[dir].count)) {
					info = tile;
					bestDir = dir;
				}
			}
		}

		if (!info) break;

		info.score = -1;

		// Make sure it's possible to refill this tower.
		const matrix = this.buildingMatrix;
		const result = PathFinder.search(info.pos, this.roomCenterEntrances, {
			roomCallback: () => matrix,
			maxRooms: 1,
			plainCost: 1,
			swampCost: 1, // We don't care about cost, just about possibility.
		});
		if (result.incomplete) continue;

		positions[bestDir].count++;
		this.placeFlag(new RoomPosition(info.pos.x, info.pos.y, info.pos.roomName), 'tower');
	}

	// Also create roads to all towers.
	for (const posName of _.keys(this.memory.locations.tower)) {
		const pos = utilities.decodePosition(posName);

		this.placeAccessRoad(pos);
	}
};

/**
 * Places walls around spawns so creeps don't get spawned on inaccessible tiles.
 */
RoomPlanner.prototype.placeSpawnWalls = function () {
	const positions = this.getLocations('spawn');

	for (const pos of positions) {
		for (let x = pos.x - 1; x <= pos.x + 1; x++) {
			for (let y = pos.y - 1; y <= pos.y + 1; y++) {
				if (this.isBuildableTile(x, y)) {
					// @todo Check if any adjacent tile has a road, don't place a wall then.
					this.placeFlag(new RoomPosition(x, y, pos.roomName), 'wall');
					this.placeFlag(new RoomPosition(x, y, pos.roomName), 'wall.blocker');
				}
			}
		}
	}
};

/**
 * Places all remaining structures of a given type.
 *
 * @param {string} structureType
 *   The type of structure to plan.
 * @param {boolean} addRoad
 *   Whether an access road should be added for these structures.
 */
RoomPlanner.prototype.placeAll = function (structureType, addRoad) {
	while (this.canPlaceMore(structureType)) {
		const nextPos = this.getNextAvailableBuildSpot();
		if (!nextPos) break;

		this.placeFlag(new RoomPosition(nextPos.x, nextPos.y, this.roomName), structureType);
		this.filterOpenList(utilities.encodePosition(nextPos));

		if (addRoad) this.placeAccessRoad(nextPos);
	}
};

/**
 * Plans a road from the given position to the room's center.
 *
 * @param {RoomPosition} position
 *   Source position from which to start the road.
 */
RoomPlanner.prototype.placeAccessRoad = function (position) {
	// Plan road out of labs.
	const accessRoads = this.scanAndAddRoad(position, this.roomCenterEntrances);
	for (const pos of accessRoads) {
		this.placeFlag(pos, 'road', 1);
	}
};

/**
 * Initializes pathfinding for finding building placement spots.
 */
RoomPlanner.prototype.startBuildingPlacement = function () {
	// Flood fill from the center to place buildings that need to be accessible.
	this.openList = {};
	this.closedList = {};
	const startPath = {};
	startPath[utilities.encodePosition(this.roomCenter)] = true;
	this.openList[utilities.encodePosition(this.roomCenter)] = {
		range: 0,
		path: startPath,
	};
};

/**
 * Gets the next reasonable building placement location.
 *
 * @return {RoomPosition}
 *   A buildable spot.
 */
RoomPlanner.prototype.getNextAvailableBuildSpot = function () {
	while (_.size(this.openList) > 0) {
		let minDist = null;
		let nextPos = null;
		let nextInfo = null;
		_.each(this.openList, (info, posName) => {
			const pos = utilities.decodePosition(posName);
			if (!minDist || info.range < minDist) {
				minDist = info.range;
				nextPos = pos;
				nextInfo = info;
			}
		});

		if (!nextPos) break;

		delete this.openList[utilities.encodePosition(nextPos)];
		this.closedList[utilities.encodePosition(nextPos)] = true;

		// Add unhandled adjacent tiles to open list.
		utilities.handleMapArea(nextPos.x, nextPos.y, (x, y) => {
			if (x === nextPos.x && y === nextPos.y) return;
			if (!this.isBuildableTile(x, y, true)) return;

			const pos = new RoomPosition(x, y, this.roomName);
			const posName = utilities.encodePosition(pos);
			if (this.openList[posName] || this.closedList[posName]) return;

			const newPath = {};
			for (const oldPos of _.keys(nextInfo.path)) {
				newPath[oldPos] = true;
			}

			newPath[posName] = true;
			this.openList[posName] = {
				range: minDist + 1,
				path: newPath,
			};
		});

		// Don't build to close to room center.
		if (nextPos.getRangeTo(this.roomCenter) < 3) continue;

		// Don't build on roads.
		if (!this.isBuildableTile(nextPos.x, nextPos.y)) continue;

		this.currentBuildSpot = {
			pos: nextPos,
			info: nextInfo,
		};
		return nextPos;
	}
};

/**
 * Gets information about the most recently requested build spot.
 *
 * @return {object}
 *   Info avoud the build spot, containing:
 *   - range: Distance from room center.
 *   - path: An object keyed by room positions that have been traversed.
 */
RoomPlanner.prototype.getCurrentBuildSpotInfo = function () {
	return this.currentBuildSpot.info;
};

/**
 * Checks if a structure can be placed on the given tile.
 *
 * @param {number} x
 *   x coordinate of the position to check.
 * @param {number} y
 *   y coordinate of the position to check.
 * @param {boolean} allowRoads
 *   Whether to allow building placement on a road.
 *
 * @return {boolean}
 *   True if building on the given coordinates is allowed.
 */
RoomPlanner.prototype.isBuildableTile = function (x, y, allowRoads) {
	// Only build on valid terrain.
	if (this.wallDistanceMatrix.get(x, y) > 100) return false;

	// Don't build too close to exits.
	if (this.exitDistanceMatrix.get(x, y) < 6) return false;

	const matrixValue = this.buildingMatrix.get(x, y);
	// Can't build on other buildings.
	if (matrixValue > 100) return false;

	// Tiles next to walls are fine for building, just not so much for pathing.
	if (matrixValue === 10 && this.wallDistanceMatrix.get(x, y) === 1) return true;

	// @todo Find out why this check was initially introduced.
	if (matrixValue > 1) return false;

	// Don't build on roads if not allowed.
	if (matrixValue === 1 && !allowRoads) return false;

	return true;
};

/**
 * Determines whether more of a certain structure could be placed.
 *
 * @param {string} structureType
 *   The type of structure to check for.
 *
 * @return {boolean}
 *   True if the current controller level allows more of this structure.
 */
RoomPlanner.prototype.canPlaceMore = function (structureType) {
	return _.size(this.memory.locations[structureType] || []) < CONTROLLER_STRUCTURES[structureType][MAX_ROOM_LEVEL];
};

/**
 * Removes all pathfinding options that use the given position.
 *
 * @param {string} targetPos
 *   An encoded room position that should not be used in paths anymore.
 */
RoomPlanner.prototype.filterOpenList = function (targetPos) {
	for (const posName in this.openList) {
		if (this.openList[posName].path[targetPos]) {
			delete this.openList[posName];
		}
	}
};

/**
 * Removes any walls that can not be reached from the given list of coordinates.
 *
 * @param {RoomPosition[]} walls
 *   Positions where walls are currently planned.
 * @param {string[]} startLocations
 *   Encoded positions from where to start flood filling.
 * @param {boolean} onlyRelevant
 *   Only check walls that have been declared as relevant in a previous pass.
 */
RoomPlanner.prototype.pruneWallFromTiles = function (walls, startLocations, onlyRelevant) {
	const openList = {};
	const closedList = {};
	let safetyValue = 1;

	for (const location of startLocations) {
		openList[location] = true;
	}

	// If we're doing an additionall pass, unmark walls first.
	if (onlyRelevant) {
		safetyValue = 2;
		for (const wall of walls) {
			wall.isIrrelevant = true;
			if (wall.isRelevant) {
				wall.isIrrelevant = false;
				wall.isRelevant = false;
			}
		}
	}

	// Flood fill, marking all walls we touch as relevant.
	while (_.size(openList) > 0) {
		const nextPos = utilities.decodePosition(_.first(_.keys(openList)));

		// Record which tiles are safe or unsafe.
		this.safetyMatrix.set(nextPos.x, nextPos.y, safetyValue);

		delete openList[utilities.encodePosition(nextPos)];
		closedList[utilities.encodePosition(nextPos)] = true;

		this.checkForAdjacentWallsToPrune(nextPos, walls, openList, closedList);
	}
};

/**
 * Checks tiles adjacent to this one.
 * Marks ramparts as relevant and adds open positions to open list.
 *
 * @param {RoomPosition} targetPos
 *   The position to check around.
 * @param {RoomPosition[]} walls
 *   Positions where walls are currently planned.
 * @param {object} openList
 *   List of tiles to check, keyed by encoded tile position.
 * @param {object} closedList
 *   List of tiles that have been checked, keyed by encoded tile position.
 */
RoomPlanner.prototype.checkForAdjacentWallsToPrune = function (targetPos, walls, openList, closedList) {
	// Add unhandled adjacent tiles to open list.
	utilities.handleMapArea(targetPos.x, targetPos.y, (x, y) => {
		if (x === targetPos.x && y === targetPos.y) return;
		if (x < 1 || x > 48 || y < 1 || y > 48) return;

		// Ignore walls.
		if (this.wallDistanceMatrix.get(x, y) > 100) return;

		const posName = utilities.encodePosition(new RoomPosition(x, y, this.roomName));
		if (openList[posName] || closedList[posName]) return;

		// If there's a rampart to be built there, mark it and move on.
		let wallFound = false;
		for (const wall of walls) {
			if (wall.x !== x || wall.y !== y) continue;

			// Skip walls that might have been discarded in a previous pass.
			if (wall.isIrrelevant) continue;

			wall.isRelevant = true;
			wallFound = true;
			closedList[posName] = true;
			break;
		}

		if (!wallFound) {
			openList[posName] = true;
		}
	});
};

/**
 * Marks all walls which are adjacent to the "inner area" of the room.
 *
 * @param {RoomPosition[]} walls
 *   Positions where walls are currently planned.
 */
RoomPlanner.prototype.pruneWalls = function (walls) {
	const roomCenter = this.getRoomCenter();
	this.safetyMatrix = new PathFinder.CostMatrix();

	const openList = [];
	openList.push(utilities.encodePosition(roomCenter));
	// @todo Include sources, minerals, controller.
	if (this.room) {
		openList.push(utilities.encodePosition(this.room.controller.pos));
		const sources = this.room.find(FIND_SOURCES);
		for (const source of sources) {
			openList.push(utilities.encodePosition(source.pos));
		}

		const minerals = this.room.find(FIND_MINERALS);
		for (const mineral of minerals) {
			openList.push(utilities.encodePosition(mineral.pos));
		}
	}

	this.pruneWallFromTiles(walls, openList);

	// Do a second pass, checking which walls get touched by unsafe exits.

	// Prepare CostMatrix and exit points.
	const exits = [];
	const terrain = new Room.Terrain(this.roomName);

	for (let i = 0; i < 50; i++) {
		if (terrain.get(0, i) !== TERRAIN_MASK_WALL && (!this.memory.adjacentSafe || !this.memory.adjacentSafe.W)) {
			exits.push(utilities.encodePosition(new RoomPosition(0, i, this.roomName)));
		}

		if (terrain.get(49, i) !== TERRAIN_MASK_WALL && (!this.memory.adjacentSafe || !this.memory.adjacentSafe.E)) {
			exits.push(utilities.encodePosition(new RoomPosition(49, i, this.roomName)));
		}

		if (terrain.get(i, 0) !== TERRAIN_MASK_WALL && (!this.memory.adjacentSafe || !this.memory.adjacentSafe.N)) {
			exits.push(utilities.encodePosition(new RoomPosition(i, 0, this.roomName)));
		}

		if (terrain.get(i, 49) !== TERRAIN_MASK_WALL && (!this.memory.adjacentSafe || !this.memory.adjacentSafe.S)) {
			exits.push(utilities.encodePosition(new RoomPosition(i, 49, this.roomName)));
		}
	}

	this.pruneWallFromTiles(walls, exits, true);

	// Safety matrix has been filled, now mark any tiles unsafe that can be reached by a ranged attacker.
	for (let x = 0; x < 50; x++) {
		for (let y = 0; y < 50; y++) {
			// Only check around unsafe tiles.
			if (this.safetyMatrix.get(x, y) !== 2) continue;

			this.markTilesInRangeOfUnsafeTile(x, y);
		}
	}
};

/**
 * Mark tiles that can be reached by ranged creeps outside our walls as unsafe.
 *
 * @param {number} x
 *   x position of the a tile that is unsafe.
 * @param {number} y
 *   y position of the a tile that is unsafe.
 */
RoomPlanner.prototype.markTilesInRangeOfUnsafeTile = function (x, y) {
	utilities.handleMapArea(x, y, (ax, ay) => {
		if (this.safetyMatrix.get(ax, ay) === 1) {
			// Safe tile in range of an unsafe tile, mark as neutral.
			this.safetyMatrix.set(ax, ay, 0);
		}
	}, 3);
};

/**
 * Tries to create a road from a target point.
 *
 * @param {RoomPosition} from
 *   Position from where to start road creation. The position itself will not
 *   have a road built on it.
 * @param {RoomPosition|RoomPosition[]} to
 *   Position or positions to lead the road to.
 *
 * @return {RoomPosition[]}
 *   Positions that make up the newly created road.
 */
RoomPlanner.prototype.scanAndAddRoad = function (from, to) {
	const matrix = this.buildingMatrix;
	const result = PathFinder.search(from, to, {
		roomCallback: () => matrix,
		maxRooms: 1,
		plainCost: 2,
		swampCost: 2, // Swamps are more expensive to build roads on, but once a road is on them, creeps travel at the same speed.
		heuristicWeight: 0.9,
	});

	if (!result.path) return [];

	const newRoads = [];
	for (const pos of result.path) {
		this.roads.push(pos);
		newRoads.push(pos);

		// Since we're building a road on this tile anyway, prefer it for future pathfinding.
		if (matrix.get(pos.x, pos.y) < 100) matrix.set(pos.x, pos.y, 1);
	}

	return newRoads;
};

/**
 * Checks which adjacent rooms are owned by ourselves or otherwise safe.
 */
RoomPlanner.prototype.checkAdjacentRooms = function () {
	if (!this.memory.adjacentSafe) {
		this.memory.adjacentSafe = {
			N: false,
			E: false,
			S: false,
			W: false,
		};
	}

	const newStatus = hivemind.roomIntel(this.roomName).calculateAdjacentRoomSafety();
	this.memory.adjacentSafeRooms = newStatus.safeRooms;

	// Check if status changed since last check.
	for (const dir in newStatus.directions) {
		if (newStatus.directions[dir] !== this.memory.adjacentSafe[dir]) {
			// Status has changed, recalculate building positioning.
			hivemind.log('room plan', this.roomName).debug('changed adjacent room status!');
			Game.notify(
				'Exit safety has changed for room ' + this.room.name + '!\n\n' +
				'N: ' + (this.memory.adjacentSafe.N ? 'safe' : 'not safe') + ' -> ' + (newStatus.directions.N ? 'safe' : 'not safe') + '\n' +
				'E: ' + (this.memory.adjacentSafe.E ? 'safe' : 'not safe') + ' -> ' + (newStatus.directions.E ? 'safe' : 'not safe') + '\n' +
				'S: ' + (this.memory.adjacentSafe.S ? 'safe' : 'not safe') + ' -> ' + (newStatus.directions.S ? 'safe' : 'not safe') + '\n' +
				'W: ' + (this.memory.adjacentSafe.W ? 'safe' : 'not safe') + ' -> ' + (newStatus.directions.W ? 'safe' : 'not safe') + '\n'
			);
			delete this.memory.locations;
			this.memory.adjacentSafe = newStatus.directions;
			break;
		}
	}
};

/**
 * Gets list of safe neighboring rooms.
 *
 * @return {string[]}
 *   An array of room names.
 */
RoomPlanner.prototype.getAdjacentSafeRooms = function () {
	return this.memory.adjacentSafeRooms || [];
};

/**
 * Gets the room's center position.
 *
 * @return {RoomPosition}
 *   The center position determined by planning.
 */
RoomPlanner.prototype.getRoomCenter = function () {
	for (const pos of this.getLocations('center')) {
		return pos;
	}

	// @todo Remove once we can guarantee there always is a center.
	return new RoomPosition(25, 25, this.roomName);
};

/**
 * Returns all positions planned for a certain type.
 *
 * @param {string} locationType
 *   Type of location to get positions for.
 *
 * @return {RoomPosition[]}
 *   An Array of positions where the given location type is planned.
 */
RoomPlanner.prototype.getLocations = function (locationType) {
	if (this.memory.locations && this.memory.locations[locationType]) {
		return _.map(_.keys(this.memory.locations[locationType]), utilities.decodePosition);
	}

	return [];
};

/**
 * Checks whether a certain position is planned for building something.
 *
 * @param {RoomPosition} pos
 *   Room position to check against.
 * @param {string} locationType
 *   Type of location to check for.
 *
 * @return {boolean}
 *   True if the given location type is planned for the given position.
 */
RoomPlanner.prototype.isPlannedLocation = function (pos, locationType) {
	if (!this.memory.locations) return false;
	if (!this.memory.locations[locationType]) return false;
	if (!this.memory.locations[locationType][utilities.encodePosition(pos)]) return false;

	return true;
};

module.exports = RoomPlanner;
