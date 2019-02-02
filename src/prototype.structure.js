'use strict';

/* global Structure StructureExtension OBSTACLE_OBJECT_TYPES STRUCTURE_RAMPART */

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
}
