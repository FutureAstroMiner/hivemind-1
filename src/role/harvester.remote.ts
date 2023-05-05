/* global STRUCTURE_ROAD OK RESOURCE_ENERGY LOOK_CREEPS
FIND_STRUCTURES STRUCTURE_CONTAINER FIND_SOURCES LOOK_CONSTRUCTION_SITES
FIND_MY_CONSTRUCTION_SITES */

import RemoteMiningOperation from 'operation/remote-mining';
import Role from 'role/role';
import {decodePosition, serializePositionPath} from 'utils/serialization';

declare global {
	interface RemoteHarvesterCreep extends Creep {
		memory: RemoteHarvesterCreepMemory;
		heapMemory: RemoteHarvesterCreepHeapMemory;
		operation: RemoteMiningOperation;
	}

	interface RemoteHarvesterCreepMemory extends CreepMemory {
		role: 'harvester.remote';
		source: string;
	}

	interface RemoteHarvesterCreepHeapMemory extends CreepHeapMemory {
	}
}

export default class RemoteHarvesterRole extends Role {
	constructor() {
		super();

		// Remote harvesters have slighly higher priority, since they don't use much
		// cpu once they are harvesting.
		this.throttleAt = 5000;
		this.stopAt = 2000;
	}

	/**
	 * Makes a creep behave like a remote harvester.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: RemoteHarvesterCreep) {
		if (!creep.operation) {
			// @todo Operation has probably ended. Return home and suicide?
			return;
		}

		if (this.travelToSource(creep)) return;
		this.performRemoteHarvest(creep);
	}

	/**
	 * Makes the creep move toward its targeted source.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 *
	 * @returns {boolean}
	 *   Whether the creep is in the process of moving.
	 */
	travelToSource(creep: RemoteHarvesterCreep) {
		const sourcePosition = decodePosition(creep.memory.source);

		if (creep.pos.roomName !== creep.operation.getRoom() && !creep.hasCachedPath()) {
			const paths = creep.operation.getPaths();
			if (!paths[creep.memory.source] || !paths[creep.memory.source].accessible) return false;
			creep.setCachedPath(serializePositionPath(paths[creep.memory.source].path), true, 1);
		}

		if (creep.hasCachedPath()) {
			if (creep.hasArrived() || creep.pos.getRangeTo(sourcePosition) < 3) {
				creep.clearCachedPath();
			}
			else {
				creep.followCachedPath();
				return true;
			}
		}

		if (sourcePosition.roomName !== creep.pos.roomName) {
			creep.moveToRange(sourcePosition, 1);
			return true;
		}

		return false;
	}

	/**
	 * Makes the creep harvest resources outside of owned rooms.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	performRemoteHarvest(creep: RemoteHarvesterCreep) {
		if (creep.pos.roomName !== creep.operation.getRoom()) return;

		// Check if a container nearby is in need of repairs, since we can handle
		// it with less intents than haulers do.
		const workParts = creep.getActiveBodyparts(WORK) || 0;
		const needsBuild = creep.pos.findClosestByRange(FIND_MY_CONSTRUCTION_SITES, {
			// It's important we build nearby roads as their sites may prevent the
			// container construction site from being placed.
			filter: site => (site.structureType === STRUCTURE_CONTAINER) || (site.structureType === STRUCTURE_ROAD),
		});
		if (needsBuild && creep.pos.getRangeTo(needsBuild) <= 3 && creep.store.energy >= workParts * 5 && workParts > 0) {
			const result = creep.build(needsBuild);
			if (result === OK) {
				const buildCost = Math.min(creep.store.energy || 0, workParts * 5, needsBuild.progressTotal - needsBuild.progress);
				creep.operation.addResourceCost(buildCost, RESOURCE_ENERGY);
				return;
			}
		}

		const needsRepair = creep.pos.findClosestByRange(FIND_STRUCTURES, {
			// @todo Only repair as a last resort. We will have dedicated repair
			// creeps otherwise.
			filter: structure => (structure.structureType === STRUCTURE_CONTAINER) && structure.hits <= structure.hitsMax - (workParts * 100),
		});
		if (needsRepair && creep.pos.getRangeTo(needsRepair) <= 3 && creep.store.energy >= workParts && workParts > 0) {
			const result = creep.repair(needsRepair);
			if (result === OK) {
				creep.operation.addResourceCost(workParts, RESOURCE_ENERGY);
				return;
			}
		}

		const sourcePosition = decodePosition(creep.memory.source);
		const sources = creep.room.find(FIND_SOURCES, {
			filter: source => source.pos.x === sourcePosition.x && source.pos.y === sourcePosition.y,
		});
		const source = sources[0];

		if (creep.pos.getRangeTo(source) > 1) {
			// Make sure we stand directly on the container position.
			creep.moveToRange(source, 1);
			return;
		}

		// Wait if source is depleted.
		if (source.energy <= 0) return;

		creep.harvest(source);

		// Immediately deposit energy if a container is nearby.
		if (!(creep.operation instanceof RemoteMiningOperation)) return;
		if (!creep.operation.hasContainer(creep.memory.source)) {
			// Check if there is a container or construction site nearby.
			const containerPosition = creep.operation.getContainerPosition(creep.memory.source);
			if (!containerPosition) return;
			const sites = _.filter(containerPosition.lookFor(LOOK_CONSTRUCTION_SITES), (site: ConstructionSite) => site.structureType === STRUCTURE_CONTAINER);
			if (sites.length === 0) {
				// Place a container construction site for this source.
				containerPosition.createConstructionSite(STRUCTURE_CONTAINER);
			}

			return;
		}

		const container = creep.operation.getContainer(creep.memory.source);
		const range = creep.pos.getRangeTo(container);
		if (range === 1) {
			// Move onto container if it's not occupied by another creep.
			if (container.pos.lookFor(LOOK_CREEPS).length === 0) {
				creep.move(creep.pos.getDirectionTo(container.pos));
			}

			// Transfer energy to container if we can't drop directly onto it.
			if (creep.store.getUsedCapacity() >= creep.store.getCapacity() * 0.8) {
				creep.transfer(container, RESOURCE_ENERGY);
			}
		}
	}
}
