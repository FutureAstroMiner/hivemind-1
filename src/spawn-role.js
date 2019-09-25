'use strict';

/* global BODYPART_COST MAX_CREEP_SIZE TOUGH ATTACK RANGED_ATTACK HEAL */

module.exports = class SpawnRole {
	/**
	 * Adds spawn options for the given room.
	 *
	 * @param {Room} room
	 *   The room to add spawn options for.
	 * @param {Object[]} options
	 *   A list of spawn options to add to.
	 */
	getSpawnOptions() {}

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
	getCreepBody() {
		return [];
	}

	/**
	 * Dynamically generates a creep body using body part weights and limits.
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
	generateCreepBodyFromWeights(weights, maxCost, maxParts) {
		const totalWeight = _.sum(weights);
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
				if (currentWeight > weight / totalWeight) return;
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
	}
};
