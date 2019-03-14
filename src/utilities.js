'use strict';

/* global hivemind PathFinder Room RoomPosition TERRAIN_MASK_WALL
BODYPART_COST TOUGH ATTACK RANGED_ATTACK HEAL MAX_CREEP_SIZE
OBSTACLE_OBJECT_TYPES STRUCTURE_RAMPART STRUCTURE_ROAD
TOP TOP_RIGHT RIGHT BOTTOM_RIGHT BOTTOM BOTTOM_LEFT LEFT TOP_LEFT */

const utilities = {

	/**
	 * Dynamically determines the username of the current user.
	 *
	 * @return {string}
	 *   The determined user name.
	 */
	getUsername() {
		return _.sample(Game.spawns).owner.username;
	},

	/**
	 * Calculates and stores paths for remote harvesting.
	 *
	 * @param {Room} room
	 *   Source room for the harvestint operation
	 * @param {RoomPosition} sourcePos
	 *   Position of the source to harvest.
	 */
	precalculatePaths(room, sourcePos) {
		if (Game.cpu.getUsed() > Game.cpu.tickLimit * 0.5) return;

		const sourceLocation = utilities.encodePosition(sourcePos);

		if (!room.memory.remoteHarvesting) {
			room.memory.remoteHarvesting = {};
		}

		if (!room.memory.remoteHarvesting[sourceLocation]) {
			room.memory.remoteHarvesting[sourceLocation] = {};
		}

		const harvestMemory = room.memory.remoteHarvesting[sourceLocation];

		if (harvestMemory.cachedPath && Game.time - harvestMemory.cachedPath.lastCalculated < 500) {
			// No need to recalculate path.
			return;
		}

		const startLocation = room.getStorageLocation();
		let startPosition = new RoomPosition(startLocation.x, startLocation.y, room.name);
		if (room.storage) {
			startPosition = room.storage.pos;
		}

		const endPosition = sourcePos;

		const result = utilities.getPath(startPosition, {pos: endPosition, range: 1});

		if (result) {
			hivemind.log('pathfinder').debug('New path calculated from', startPosition, 'to', endPosition);

			harvestMemory.cachedPath = {
				lastCalculated: Game.time,
				path: utilities.serializePositionPath(result.path),
			};
		}
		else {
			console.log('No path found!');
		}
	},

	/**
	 * Finds a path using PathFinder.search.
	 *
	 * @param {RoomPosition} startPosition
	 *   Position to start the search from.
	 * @param {object} endPosition
	 *   Position or Positions or object with information about path target.
	 * @param {boolean} allowDanger
	 *   If true, allow traversing unsafe rooms.
	 * @param {object} addOptions
	 *   Options to add to pathfinder options.
	 *
	 * @return {object}
	 *   Result of the pathfinding operation.
	 */
	getPath(startPosition, endPosition, allowDanger, addOptions) {
		const options = {
			plainCost: 2,
			swampCost: 10,
			maxOps: 10000, // The default 2000 can be too little even at a distance of only 2 rooms.

			roomCallback: roomName => {
				// If a room is considered inaccessible, don't look for paths through it.
				if (!allowDanger && hivemind.roomIntel(roomName).isOwned()) {
					if (!addOptions || !addOptions.whiteListRooms || addOptions.whiteListRooms.indexOf(roomName) === -1) {
						return false;
					}
				}

				// Work with roads and structures in a room.
				const options = {};
				if (addOptions && addOptions.singleRoom && addOptions.singleRoom === roomName) {
					options.singleRoom = true;
				}

				const costs = utilities.getCostMatrix(roomName, options);

				// Also try not to drive through bays.
				_.filter(Game.flags, flag => {
					return flag.pos.roomName === roomName && flag.name.startsWith('Bay:');
				}).forEach(flag => {
					if (costs.get(flag.pos.x, flag.pos.y) <= 20) {
						costs.set(flag.pos.x, flag.pos.y, 20);
					}
				});

				// @todo Try not to drive too close to sources / minerals / controllers.
				// @todo Avoid source keepers.

				return costs;
			},
		};

		if (addOptions) {
			_.each(addOptions, (value, key) => {
				options[key] = value;
			});
		}

		return PathFinder.search(startPosition, endPosition, options);
	},

	/**
	 * Generates a new CostMatrix for pathfinding.
	 *
	 * @param {Array} structures
	 *   An array of structures to navigate around.
	 * @param {Array} constructionSites
	 *   An array of construction sites to navigate around.
	 *
	 * @return {PathFinder.CostMatrix}
	 *   A cost matrix representing the given obstacles.
	 */
	generateCostMatrix(structures, constructionSites) {
		const costs = new PathFinder.CostMatrix();

		this.markBuildings(
			structures,
			constructionSites,
			structure => {
				if (costs.get(structure.pos.x, structure.pos.y) === 0) {
					costs.set(structure.pos.x, structure.pos.y, 1);
				}
			},
			structure => costs.set(structure.pos.x, structure.pos.y, 0xFF),
		);

		return costs;
	},

	/**
	 *
	 */
	generateObstacleList(structures, constructionSites) {
		const result = {
			obstacles: [],
			roads: [],
		};

		this.markBuildings(
			structures,
			constructionSites,
			structure => {
				const location = utilities.encodePosition(structure.pos);
				if (!_.contains(result.obstacles, location)) {
					result.roads.push(location);
				}
			},
			structure => result.obstacles.push(utilities.encodePosition(structure.pos)),
		);

		return result;
	},

	/**
	 *
	 */
	markBuildings(structures, constructionSites, roadCallback, blockerCallback) {
		_.each(OBSTACLE_OBJECT_TYPES, structureType => {
			_.each(structures[structureType], structure => {
				// Can't walk through non-walkable buildings.
				blockerCallback(structure);
			});

			_.each(constructionSites[structureType], site => {
				// Can't walk through non-walkable construction sites.
				blockerCallback(site);
			});
		});

		_.each(structures[STRUCTURE_RAMPART], structure => {
			if (!structure.my) {
				// Enemy ramparts are blocking.
				blockerCallback(structure);
			}
		});

		_.each(structures[STRUCTURE_ROAD], structure => {
			// Favor roads over plain tiles.
			roadCallback(structure);
		});
	},

	/**
	 * Gets the pathfinding cost matrix for a room.
	 *
	 * @param {string} roomName
	 *   Name of the room.
	 * @param {object} options
	 *   Further options regarding the matrix. Can have the following keys:
	 *   - `singleRoom`: If true, return a matrix for creeps that cannot leave
	 *     the room.
	 *
	 * @return {PathFinder.CostMatrix}
	 *   The requested cost matrix.
	 */
	getCostMatrix(roomName, options) {
		// Clear cost matrix cache from time to time.
		if (!utilities.costMatrixCacheAge || utilities.costMatrixCacheAge < Game.time - 500) {
			utilities.costMatrixCache = {};
			utilities.costMatrixCacheAge = Game.time;
		}

		if (!options) {
			options = {};
		}

		let cacheKey = roomName;
		let matrix;
		if (!utilities.costMatrixCache[cacheKey]) {
			const roomIntel = hivemind.roomIntel(roomName);
			matrix = roomIntel.getCostMatrix();
			utilities.costMatrixCache[cacheKey] = matrix;
		}

		matrix = utilities.costMatrixCache[cacheKey];

		if (matrix && options.singleRoom) {
			// Highly discourage room exits if creep is supposed to stay in a room.
			cacheKey += ':singleRoom';

			if (!utilities.costMatrixCache[cacheKey]) {
				utilities.costMatrixCache[cacheKey] = this.generateSingleRoomCostMatrix(matrix, roomName);
			}
		}

		matrix = utilities.costMatrixCache[cacheKey];

		return matrix;
	},

	/**
	 * Generates a derivative cost matrix that highly discourages room exits.
	 *
	 * @param {PathFinder.CostMatrix} matrix
	 *   The matrix to use as a base.
	 * @param {string} roomName
	 *   Name of the room this matrix represents.
	 *
	 * @return {PathFinder.CostMatrix}
	 *   The modified cost matrix.
	 */
	generateSingleRoomCostMatrix(matrix, roomName) {
		const newMatrix = matrix.clone();
		const terrain = new Room.Terrain(roomName);
		for (let x = 0; x < 50; x++) {
			for (let y = 0; y < 50; y++) {
				if ((x === 0 || y === 0 || x === 49 || y === 49) && terrain.get(x, y) !== TERRAIN_MASK_WALL) {
					newMatrix.set(x, y, 50);
				}
			}
		}

		return newMatrix;
	},

	/**
	 * Returns closest target to a room object.
	 *
	 * @param {RoomObject} roomObject
	 *   The room object the search originates from.
	 * @param {RoomObject[]} targets
	 *   A list of room objects to check.
	 *
	 * @return {RoomObject}
	 *   The closest target.
	 */
	getClosest(roomObject, targets) {
		if (targets.length > 0) {
			const target = roomObject.pos.findClosestByRange(targets);
			return target && target.id;
		}
	},

	/**
	 * Gets most highly rated option from a list.
	 *
	 * @param {Array} options
	 *   List of options, each option should at least contain the keys `priority`
	 *   and `weight`.
	 *
	 * @return {object}
	 *   The object with the highest priority and weight (within that priority).
	 */
	getBestOption(options) {
		let best = null;

		for (const option of options) {
			if (!best || option.priority > best.priority || (option.priority === best.priority && option.weight > best.weight)) {
				best = option;
			}
		}

		return best;
	},

	/**
	 * Calculates how much a creep cost to spawn.
	 * @todo Move into Creep.prototype.
	 *
	 * @param {Creep} creep
	 *   The creep in question.
	 *
	 * @return {number}
	 *   Energy cost for this creep.
	 */
	getBodyCost(creep) {
		let cost = 0;
		for (const part of creep.body) {
			cost += BODYPART_COST[part.type];
		}

		return cost;
	},

	/**
	 * Get part counts for this creep.
	 * @todo Move into Creep.prototype.
	 *
	 * @param {Creep} creep
	 *   The creep in question.
	 *
	 * @return {object}
	 *   Amount of parts of each type in the creep's body.
	 */
	getBodyParts(creep) {
		return creep.memory.body;
	},

	/**
	 * Dynamically generates a creep body for spawning.
	 *
	 * @param {object} weights
	 *   Weights specifying how to distribute the different body part types.
	 * @param {number} maxCost
	 *   Maximum cost for the creep.
	 * @param {object} maxParts
	 *   Maximum number of parts of certain types to use.
	 *
	 * @return {string[]}
	 *   List of parts that make up the requested creep.
	 */
	generateCreepBody(weights, maxCost, maxParts) {
		const newParts = {};
		let size = 0;
		let cost = 0;

		if (!maxCost) {
			maxCost = 300;
		}

		// Generate initial body containing at least one of each part.
		for (const part of _.keys(weights)) {
			newParts[part] = 1;
			size++;
			cost += BODYPART_COST[part];
		}

		if (cost > maxCost) {
			return null;
		}

		let done = false;
		while (!done && size < MAX_CREEP_SIZE) {
			done = true;
			_.each(weights, (weight, part) => {
				const currentWeight = newParts[part] / size;
				if (currentWeight > weight) return;
				if (cost + BODYPART_COST[part] > maxCost) return;

				if (maxParts && maxParts[part] && newParts[part] >= maxParts[part]) {
					// Limit for this bodypart has been reached, so stop adding.
					done = true;
					return false;
				}

				done = false;
				newParts[part]++;
				size++;
				cost += BODYPART_COST[part];

				if (size >= MAX_CREEP_SIZE) {
					// Maximum creep size reached, stop adding parts.
					return false;
				}
			});
		}

		// Chain the generated configuration into an array of body parts.
		const body = [];

		if (newParts.tough) {
			for (let i = 0; i < newParts.tough; i++) {
				body.push(TOUGH);
			}

			delete newParts.tough;
		}

		done = false;
		while (!done) {
			done = true;
			for (const part in newParts) {
				if (part === ATTACK || part === RANGED_ATTACK || part === HEAL) continue;
				if (newParts[part] > 0) {
					body.push(part);
					newParts[part]--;
					done = false;
				}
			}
		}

		// Add military parts last to keep fighting effeciency.
		const lastParts = [RANGED_ATTACK, ATTACK, HEAL];
		for (const part of lastParts) {
			for (let i = 0; i < newParts[part] || 0; i++) {
				body.push(part);
			}
		}

		return body;
	},

	/**
	 * Serializes a position for storing it in memory.
	 * @todo Move to RoomPosition.prototype.
	 *
	 * @param {RoomPosition} position
	 *   The position to encode.
	 *
	 * @return {string}
	 *   The encoded position.
	 */
	encodePosition(position) {
		if (!position) return;

		return position.roomName + '@' + position.x + 'x' + position.y;
	},

	/**
	 * Creates a RoomPosition object from serialized data.
	 * @todo Move to RoomPosition as static function.
	 *
	 * @param {string} position
	 *   The encoded position.
	 *
	 * @return {RoomPosition}
	 *   The original room position.
	 */
	decodePosition(position) {
		if (!position) return;

		const parts = position.match(/^(.*)@(\d*)x(\d*)$/);

		if (parts && parts.length > 0) {
			return new RoomPosition(parts[2], parts[3], parts[1]);
		}
	},

	xOffsets: {
		[TOP]: 0,
		[TOP_RIGHT]: 1,
		[RIGHT]: 1,
		[BOTTOM_RIGHT]: 1,
		[BOTTOM]: 0,
		[BOTTOM_LEFT]: -1,
		[LEFT]: -1,
		[TOP_LEFT]: -1,
	},

	yOffsets: {
		[TOP]: -1,
		[TOP_RIGHT]: -1,
		[RIGHT]: 0,
		[BOTTOM_RIGHT]: 1,
		[BOTTOM]: 1,
		[BOTTOM_LEFT]: 1,
		[LEFT]: 0,
		[TOP_LEFT]: -1,
	},

	directions: {
		[-1]: {
			[-1]: TOP_LEFT,
			[0]: TOP,
			[1]: TOP_RIGHT,
		},
		[0]: {
			[-1]: LEFT,
			[0]: null,
			[1]: RIGHT,
		},
		[1]: {
			[-1]: BOTTOM_LEFT,
			[0]: BOTTOM,
			[1]: BOTTOM_RIGHT,
		},
	},

	/**
	 * Serializes an array of RoomPosition objects for storing in memory.
	 *
	 * @param {RoomPosition[]} path
	 *   A list of positions to encode.
	 *
	 * @return {string[]}
	 *   The encoded path.
	 */
	serializePositionPath(path) {
		let previous;
		return _.map(path, pos => {
			let result;
			if (previous && previous.roomName === pos.roomName) {
				const dx = pos.x - previous.x;
				const dy = pos.y - previous.y;
				result = utilities.directions[dy] && utilities.directions[dy][dx];
			}

			previous = pos;
			return result || utilities.encodePosition(pos);
		});
	},

	/**
	 * Deserializes a serialized path into an array of RoomPosition objects.
	 *
	 * @param {string[]} path
	 *   A list of positions to decode.
	 *
	 * @return {RoomPosition[]}
	 *   The decoded path.
	 */
	deserializePositionPath(path) {
		let pos;
		return _.map(path, location => {
			if (typeof location === 'string') {
				pos = utilities.decodePosition(location);
			}
			else {
				pos = new RoomPosition(pos.x + utilities.xOffsets[location], pos.y + utilities.yOffsets[location], pos.roomName);
			}

			return pos;
		});
	},

	/**
	 * Generates a Van der Corput sequence.
	 *
	 * @param {number} power
	 *   Number of "digits" relative to base to generate a sequence for.
	 * @param {number} base
	 *   Base for the sequence. Detemines spacing of the sequence.
	 *
	 * @return {number[]}
	 *   The generated sequence, containing all numbers from 1 to base^power.
	 */
	generateEvenSequence(power, base) {
		const numbers = [];
		const digits = [];
		for (let i = 0; i < power; i++) {
			digits[i] = 0;
		}

		function increase(digit) {
			if (digit >= power) return;

			digits[digit]++;
			if (digits[digit] >= base) {
				digits[digit] = 0;
				increase(digit + 1);
			}
		}

		function getNumber() {
			let sum = 0;
			for (let i = 0; i < power; i++) {
				sum *= base;
				sum += digits[i];
			}

			return sum;
		}

		increase(0);
		let number = getNumber();
		const max = number * base;
		numbers.push(max);
		while (number !== 0) {
			numbers.push(number);
			increase(0);
			number = getNumber();
		}

		return numbers;
	},

	/**
	 * Choose whether an operation should currently run based on priorities.
	 *
	 * @param {number} offset
	 *   Offset to add to time, so not all operations get throttled on the same tick.
	 * @param {number} minBucket
	 *   Minimum amount of bucket needed for this operation to run.
	 * @param {number} maxBucket
	 *   Amount of bucket at which this operation should always run.
	 *
	 * @return {boolean}
	 *   True if the operation is allowed to run.
	 */
	throttle(offset, minBucket, maxBucket) {
		utilities.initThrottleMemory();

		if (!offset) offset = 0;
		if (!minBucket) minBucket = Memory.throttleInfo.bucket.critical;
		if (!maxBucket) maxBucket = Memory.throttleInfo.bucket.normal;

		const bucket = Game.cpu.bucket;
		if (bucket >= maxBucket) return false;
		if (bucket < minBucket) return true;

		const tick = (Game.time + offset) % Memory.throttleInfo.max;
		const ratio = (bucket - minBucket) / (maxBucket - minBucket);

		if (ratio >= Memory.throttleInfo.numbers[tick]) return false;

		return true;
	},

	/**
	 * Gets a new offset for a throttled operation.
	 *
	 * @return {number}
	 *   Offset to store for a throttled operation.
	 */
	getThrottleOffset() {
		utilities.initThrottleMemory();

		if (!Memory.throttleInfo.currentOffset) {
			Memory.throttleInfo.currentOffset = 0;
		}

		Memory.throttleInfo.currentOffset++;
		return Memory.throttleInfo.currentOffset;
	},

	/**
	 * Initializes memory with general throttling information.
	 */
	initThrottleMemory() {
		if (!Memory.throttleInfo) {
			Memory.throttleInfo = {
				bucket: {
					normal: 8000,
					warning: 5000,
					critical: 2000,
				},
			};
		}

		if (!Memory.throttleInfo.numbers) {
			Memory.throttleInfo.numbers = [];

			const sequence = utilities.generateEvenSequence(8, 2);
			const max = sequence[0];
			Memory.throttleInfo.max = max;

			_.each(sequence, (number, index) => {
				Memory.throttleInfo.numbers[number] = 1 - (index / max);
			});

			Memory.throttleInfo.numbers[0] = 1;
		}
	},

};

module.exports = utilities;
