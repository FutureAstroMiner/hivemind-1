'use strict';

/* global Structure StructureExtension StructureTower OBSTACLE_OBJECT_TYPES
STRUCTURE_RAMPART TOWER_OPTIMAL_RANGE TOWER_FALLOFF_RANGE TOWER_FALLOFF */

if (!Structure.prototype.__enhancementsLoaded) {
	/**
	 * Checks whether a structure can be moved onto.
	 *
	 * @return {boolean}
	 *   True if a creep can move onto this structure.
	 */
	Structure.prototype.isWalkable = function () {
		if (_.includes(OBSTACLE_OBJECT_TYPES, this.structureType)) return false;
		if (this.structureType === STRUCTURE_RAMPART) {
			return this.my || this.isPublic();
		}

		return true;
	};

	/**
	 * Checks whether this extension belongs to any bay.
	 *
	 * @return {boolean}
	 *   True if the extension is part of a bay.
	 */
	StructureExtension.prototype.isBayExtension = function () {
		if (!this.bayChecked) {
			this.bayChecked = true;
			this.bay = null;

			for (const bay of this.room.bays) {
				if (bay.hasExtension(this)) {
					this.bay = bay;
					break;
				}
			}
		}

		return this.bay !== null;
	};

	/**
	 * Calculates relative tower power at a certain range.
	 *
	 * @param {number} range
	 *   Tile distance between tower and target.
	 *
	 * @return {number}
	 *   Relative power between 0 and 1.
	 */
	StructureTower.prototype.getPowerAtRange = function (range) {
		if (range < TOWER_OPTIMAL_RANGE) range = TOWER_OPTIMAL_RANGE;
		if (range > TOWER_FALLOFF_RANGE) range = TOWER_FALLOFF_RANGE;

		return 1 - (((range - TOWER_OPTIMAL_RANGE) / (TOWER_FALLOFF_RANGE - TOWER_OPTIMAL_RANGE)) * TOWER_FALLOFF);
	};
}
