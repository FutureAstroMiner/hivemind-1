/* global PathFinder Room RoomPosition FIND_DROPPED_RESOURCES
STRUCTURE_CONTAINER RESOURCE_POWER RESOURCE_GHODIUM STRUCTURE_LAB REACTIONS
STRUCTURE_EXTENSION STRUCTURE_SPAWN STRUCTURE_TOWER STRUCTURE_NUKER ERR_NO_PATH
STRUCTURE_POWER_SPAWN TERRAIN_MASK_WALL LOOK_STRUCTURES RESOURCE_ENERGY
LOOK_CONSTRUCTION_SITES FIND_STRUCTURES OK OBSTACLE_OBJECT_TYPES ORDER_SELL
FIND_TOMBSTONES FIND_RUINS */

import hivemind from 'hivemind';
import Role from 'role/role';
import utilities from 'utilities';
import {getResourcesIn} from 'utils/store';
import {handleMapArea} from 'utils/map';

type TransporterDropOrderOption = {
	priority: number;
	weight: number;
	type: 'drop';
	resourceType: ResourceConstant;
}

type TransporterStructureOrderOption = {
	priority: number;
	weight: number;
	type: 'structure';
	object: AnyStoreStructure;
	resourceType: ResourceConstant;
}

type TransporterTombstoneOrderOption = {
	priority: number;
	weight: number;
	type: 'tombstone';
	object: Ruin | Tombstone;
	resourceType: ResourceConstant;
}

type TransporterPickupOrderOption = {
	priority: number;
	weight: number;
	type: 'resource';
	object: Resource;
	resourceType: ResourceConstant;
}

type TransporterPositionOrderOption = {
	priority: number;
	weight: number;
	type: 'position',
	object: RoomPosition,
	resourceType: ResourceConstant,
}

type TransporterDestinationOrderOption = ResourceDestinationTask | TransporterDropOrderOption | TransporterStructureOrderOption | TransporterPositionOrderOption;

type TransporterSourceOrderOption = ResourceSourceTask | TransporterStructureOrderOption | TransporterPickupOrderOption | TransporterTombstoneOrderOption;

type TransporterGetEnergyOrder = {
	type: 'getEnergy' | 'getResource';
	target: Id<AnyStoreStructure | Resource | Ruin | Tombstone>;
	resourceType: ResourceConstant;
}

type TransporterDeliverOrder = {
	type: 'deliver';
	target: Id<AnyStoreStructure>;
	resourceType: ResourceConstant;
}

type TransporterPositionOrder = {
	type: 'position';
	resourceType: ResourceConstant;
	x: number;
	y: number;
}

type TransporterOrder = TransporterGetEnergyOrder | TransporterDeliverOrder | TransporterPositionOrder | ResourceSourceTask | ResourceDestinationTask;

declare global {
	interface TransporterCreep extends Creep {
		role: 'transporter';
		memory: TransporterCreepMemory;
		heapMemory: TransporterCreepHeapMemory;
	}

	interface TransporterCreepMemory extends CreepMemory {
		role: 'transporter';
		delivering?: boolean;
		order?: TransporterOrder;
		blockedPathCounter?: number;
	}

	interface TransporterCreepHeapMemory extends CreepHeapMemory {
	}
}

function isPositionOrderOption(order: TransporterDestinationOrderOption): order is TransporterPositionOrderOption {
	return order.type == 'position';
}

function isDropOrderOption(order: TransporterDestinationOrderOption): order is TransporterDropOrderOption {
	return order.type == 'drop';
}

function isResourceDestinationOrder(room: Room, order: TransporterOrder): order is ResourceDestinationTask {
	if ('type' in order && room.destinationDispatcher.hasProvider(order.type)) {
		return true;
	}

	return false;
}

function isBayDestinationOrder(order: ResourceDestinationTask): order is BayDestinationTask {
	return order.type === 'bay';
}

function isResourceSourceOrder(room: Room, order: TransporterOrder): order is ResourceSourceTask {
	if ('type' in order && room.sourceDispatcher.hasProvider(order.type)) {
		return true;
	}

	return false;
}

function isPositionOrder(order: TransporterOrder): order is TransporterPositionOrder {
	return order.type == 'position';
}

function isCollectOrder(order: TransporterOrder): order is TransporterGetEnergyOrder {
	return order.type == 'getEnergy' || order.type == 'getResource';
}

function isDeliverOrder(order: TransporterOrder): order is TransporterDeliverOrder {
	return order.type == 'deliver';
}

export default class TransporterRole extends Role {
	creep: TransporterCreep;

	constructor() {
		super();

		// Make sure transporters always run at least a little.
		this.stopAt = 0;
		this.throttleAt = 5000;
	}

	/**
	 * Makes this creep behave like a transporter.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	run(creep: TransporterCreep) {
		this.creep = creep;

		if (creep.memory.singleRoom) {
			if (creep.memory.order && 'target' in creep.memory.order) {
				const target = Game.getObjectById<RoomObject>(creep.memory.order.target);
				if (target && target.pos && target.pos.roomName !== creep.memory.singleRoom) {
					this.setTransporterState(creep.memory.delivering);
				}
			}
		}

		if (creep.store.getUsedCapacity() >= creep.store.getCapacity() * 0.9 && !creep.memory.delivering) {
			this.setTransporterState(true);
		}
		else if (creep.store.getUsedCapacity() <= creep.store.getCapacity() * 0.1 && creep.memory.delivering) {
			// Don't switch state if we're currently filling a bay.
			if (!creep.memory.order || !isResourceDestinationOrder(creep.room, creep.memory.order) || !isBayDestinationOrder(creep.memory.order)) {
				this.setTransporterState(false);
			}
		}

		if (this.bayUnstuck()) return;

		if (creep.memory.delivering) {
			this.performDeliver();
			return;
		}

		// Make sure not to keep standing on resource drop stop.
		const storagePosition = creep.room.getStorageLocation();
		if (!creep.room.storage && storagePosition && creep.pos.x === storagePosition.x && creep.pos.y === storagePosition.y && (!creep.memory.order || !('target' in creep.memory.order))) {
			creep.move(_.random(1, 8) as DirectionConstant);
			return;
		}

		this.performGetResources();
	}

	/**
	 * Puts this creep into or out of delivery mode.
	 *
	 * @param {boolean} delivering
	 *   Whether this creep is delivering resources instead of collecting.
	 */
	setTransporterState(delivering: boolean) {
		this.creep.memory.delivering = delivering;
		delete this.creep.memory.order;
	}

	/**
	 * Makes sure creeps don't get stuck in bays.
	 *
	 * @return {boolean}
	 *   True if the creep is trying to get free.
	 */
	bayUnstuck(): boolean {
		const creep = this.creep;
		// If the creep is in a bay, but not delivering to that bay (any more), make it move out of the bay forcibly.
		for (const bay of creep.room.bays) {
			if (creep.pos.x !== bay.pos.x || creep.pos.y !== bay.pos.y) continue;
			if (bay.isBlocked()) continue;

			// It's fine if we're explicitly delivering to this bay right now.
			if (creep.memory.order && isResourceDestinationOrder(creep.room, creep.memory.order) && isBayDestinationOrder(creep.memory.order) && creep.memory.order.name === bay.name) continue;

			// We're standing in a bay that we're not delivering to.
			const terrain = new Room.Terrain(creep.pos.roomName);
			// @todo Bay's available tiles should by handled and cached by the bay itself.
			const availableTiles: RoomPosition[] = [];
			handleMapArea(creep.pos.x, creep.pos.y, (x, y) => {
				if (x === creep.pos.x && y === creep.pos.y) return;
				if (terrain.get(x, y) === TERRAIN_MASK_WALL) return;

				const pos = new RoomPosition(x, y, creep.pos.roomName);

				// Check if there's a structure here already.
				const structures = pos.lookFor(LOOK_STRUCTURES);
				if (_.some(structures, structure => _.contains(OBSTACLE_OBJECT_TYPES, structure.structureType))) return;

				// Check if there's a construction site here already.
				const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
				if (_.some(sites, site => _.contains(OBSTACLE_OBJECT_TYPES, site.structureType))) return;

				availableTiles.push(pos);
			});

			if (availableTiles.length === 1) {
				// Move out of the way.
				const dir = creep.pos.getDirectionTo(availableTiles[0]);
				creep.move(dir);
				return true;
			}
		}

		return false;
	}

	/**
	 * Makes this creep deliver carried energy somewhere.
	 */
	performDeliver() {
		const creep = this.creep;

		if (!this.ensureValidDeliveryTarget()) {
			delete creep.memory.order;
			return;
		}

		const order = creep.memory.order;
		if (isResourceDestinationOrder(creep.room, order)) {
			creep.room.destinationDispatcher.executeTask(order, {creep});
			return;
		}

		if (isDeliverOrder(order)) {
			const target = Game.getObjectById(order.target);
			creep.whenInRange(1, target, () => {
				if ('amount' in creep.memory.order)
					creep.transfer(target, order.resourceType, Math.min(creep.memory.order.amount, creep.store.getUsedCapacity(order.resourceType), target.store.getFreeCapacity(order.resourceType)));
				else
					creep.transfer(target, order.resourceType);

				delete creep.memory.order;
			});
			return;
		}

		if (isPositionOrder(order)) {
			// Dropoff location.
			if (creep.pos.x === order.x && creep.pos.y === order.y) {
				creep.drop(order.resourceType);
			}
			else {
				const result = creep.moveTo(order.x, order.y);
				if (result === ERR_NO_PATH) {
					if (!creep.memory.blockedPathCounter) {
						creep.memory.blockedPathCounter = 0;
					}

					creep.memory.blockedPathCounter++;

					if (creep.memory.blockedPathCounter > 10) {
						this.calculateDeliveryTarget();
					}
				}
				else {
					delete creep.memory.blockedPathCounter;
				}
			}

			return;
		}

		// Unknown target type, reset!
		hivemind.log('default').error('Unknown target type for delivery found!', JSON.stringify(order.type));
	}

	/**
	 * Makes sure the creep has a valid target for resource delivery.
	 *
	 * @return {boolean}
	 *   True if the target is valid and can receive the needed resource.
	 */
	ensureValidDeliveryTarget(): boolean {
		const creep = this.creep;

		if (!creep.memory.order) this.calculateDeliveryTarget();
		if (!creep.memory.order) return false;

		const resourceType = creep.memory.order.resourceType;
		if ((creep.store[resourceType] || 0) <= 0) return false;

		if (isResourceDestinationOrder(creep.room, creep.memory.order)) {
			return creep.room.destinationDispatcher.validateTask(creep.memory.order, {creep});
		}

		if (isPositionOrder(creep.memory.order)) {
			return true;
		}

		if (isDeliverOrder(creep.memory.order)) {
			return this.ensureValidDeliveryTargetObject(Game.getObjectById(creep.memory.order.target), resourceType);
		}

		return false;
	}

	/**
	 * Sets a good energy delivery target for this creep.
	 */
	calculateDeliveryTarget(): void {
		const creep = this.creep;
		const options = this.getAvailableDeliveryTargets();
		const best = utilities.getBestOption(options);

		if (!best) {
			delete creep.memory.order;
			if (creep.store.getFreeCapacity() > 0) this.setTransporterState(false);
			return;
		}

		creep.room.visual.text('target: ' + best.type + '@' + best.priority, creep.pos);

		if (isPositionOrderOption(best)) {
			creep.memory.order = {
				type: 'position',
				resourceType: best.resourceType,
				x: best.object.x,
				y: best.object.y,
			};
		}
		else if (isResourceDestinationOrder(creep.room, best)) {
			creep.memory.order = best;
		}
		else if (isDropOrderOption(best)) {
			// Just do it, no need to travel anywhere.
			creep.drop(best.resourceType);
			delete creep.memory.order;
		}
		else {
			creep.memory.order = {
				type: 'deliver',
				target: best.object.id,
				resourceType: best.resourceType,
			};
		}
	}

	/**
	 * Creates a priority list of possible delivery targets for this creep.
	 *
	 * @return {Array}
	 *   A list of potential delivery targets.
	 */
	getAvailableDeliveryTargets(): TransporterDestinationOrderOption[] {
		const creep = this.creep;
		const options: TransporterDestinationOrderOption[] = [];

		const task = creep.room.destinationDispatcher.getTask({creep});
		if (task) {
			if (creep.store.getUsedCapacity(task.resourceType as ResourceConstant) > 0) {
				options.push(task);
			}
			else {
				hivemind.log('creeps', creep.room.name).notify(
					'Invalid delivery target calculated for creep ' + creep.name + ': ' + JSON.stringify(task) + '\n\n' +
					'creep storage: ' + JSON.stringify(getResourcesIn(creep.store))
				);
			}
		}

		const terminal = creep.room.terminal;

		if (creep.store[RESOURCE_ENERGY] > creep.store.getCapacity() * 0.1) {
			this.addStorageEnergyDeliveryOptions(options);
		}

		for (const resourceType of getResourcesIn(creep.store)) {
			// The following only concerns resources other than energy.
			if (resourceType === RESOURCE_ENERGY) continue;

			const storageTarget = creep.room.getBestStorageTarget(creep.store[resourceType], resourceType);

			// If there is space left, store in storage.
			if (storageTarget && storageTarget.store.getFreeCapacity() > 0) {
				options.push({
					priority: 1,
					weight: creep.store[resourceType] / 100, // @todo Also factor in distance.
					type: 'structure',
					object: storageTarget,
					resourceType,
				});
			}

			// As a last resort, simply drop the resource since it can't be put anywhere.
			options.push({
				priority: 0,
				weight: 0,
				type: 'drop',
				resourceType,
			});
		}

		return options;
	}

	/**
	 * Adds options for storing energy.
	 *
	 * @param {Array} options
	 *   A list of potential delivery targets.
	 */
	addStorageEnergyDeliveryOptions(options: TransporterDestinationOrderOption[]) {
		const creep = this.creep;
		// Put in storage if nowhere else needs it.
		const storageTarget = creep.room.getBestStorageTarget(creep.store[RESOURCE_ENERGY], RESOURCE_ENERGY);
		if (storageTarget) {
			options.push({
				priority: 0,
				weight: 0,
				type: 'structure',
				object: storageTarget,
				resourceType: RESOURCE_ENERGY,
			});
		}
		else {
			// Transporters keep their energy in store on low-level rooms since there
			// is no storage to reduce decay and deliver faster.
			if (creep.memory.role === 'transporter' && creep.room?.controller.level < 4) return;

			const storagePosition = creep.room.getStorageLocation();
			if (storagePosition) {
				options.push({
					priority: 0,
					weight: 0,
					type: 'position',
					object: creep.room.getPositionAt(storagePosition.x, storagePosition.y),
					resourceType: RESOURCE_ENERGY,
				});
			}
		}
	}

	/**
	 * Makes sure the creep has a valid target for resource delivery.
	 *
	 * @param {RoomObject} target
	 *   The target to deliver resources to.
	 * @param {string} resourceType
	 *   The type of resource that is being delivered.
	 *
	 * @return {boolean}
	 *   True if the target is valid and can receive the needed resource.
	 */
	ensureValidDeliveryTargetObject(target: AnyStoreStructure | Ruin | Tombstone, resourceType: ResourceConstant): boolean {
		if (!target) return false;
		if (this.creep.memory.singleRoom && target.pos.roomName !== this.creep.memory.singleRoom) return false;

		if (target.store && target.store.getFreeCapacity(resourceType) > 0) return true;

		return false;
	}

	/**
	 * Makes this creep collect resources.
	 *
	 * @param {Function} calculateSourceCallback
	 *   Optional callback to use when a new source target needs to be chosen.
	 */
	performGetResources(calculateSourceCallback?: () => void) {
		const creep = this.creep;
		if (!calculateSourceCallback) {
			calculateSourceCallback = () => {
				this.calculateSource();
			};
		}

		if (!this.ensureValidResourceSource(creep.memory.order, calculateSourceCallback)) {
			delete creep.memory.order;
			if (creep.memory.role === 'transporter') {
				if (creep.store.getUsedCapacity() > creep.store.getCapacity() * 0.1) {
					// Deliver what we already have stored, if no more can be found for picking up.
					this.setTransporterState(true);
				}
				else {
					this.setTransporterState(false);
				}
			}

			return;
		}

		if (isResourceSourceOrder(creep.room, creep.memory.order)) {
			creep.room.sourceDispatcher.executeTask(creep.memory.order, {creep});
			return;
		}

		const target = Game.getObjectById(creep.memory.order.target);
		creep.whenInRange(1, target, () => {
			const resourceType = creep.memory.order.resourceType;
			let orderDone = false;
			if (target instanceof Resource) {
				orderDone = creep.pickup(target) === OK;
				if (
					orderDone &&
					creep.store.getFreeCapacity() > target.amount
				) {
					const containers = _.filter(target.pos.lookFor(LOOK_STRUCTURES), s => s.structureType === STRUCTURE_CONTAINER) as StructureContainer[];
					if (containers.length > 0 && (containers[0].store.getUsedCapacity(target.resourceType) || 0) > 0) {
						// We have picked up energy dropped on the ground probably due to a full
						// container. Pick up resources from the container next.
						creep.memory.order = {
							type: 'getResource',
							target: containers[0].id,
							resourceType: target.resourceType,
						};
						// Don't try to determine another source.
						return;
					}
				}
			}
			else {
				if ('amount' in creep.memory.order)
					orderDone = creep.withdraw(target, resourceType, Math.min(target.store.getUsedCapacity(resourceType), creep.memory.order.amount, creep.store.getFreeCapacity())) === OK;
				else
					orderDone = creep.withdraw(target, resourceType) === OK;
			}

			if (orderDone) {
				delete creep.memory.order;
				calculateSourceCallback();
			}
		});
	}

	/**
	 * Makes sure the creep has a valid target for resource pickup.
	 *
	 * @param {Function } calculateSourceCallback
	 *   Callback to use when a new source target needs to be chosen.
	 *
	 * @return {boolean}
	 *   True if the target is valid and contains the needed resource.
	 */
	ensureValidResourceSource(order: TransporterOrder, calculateSourceCallback: () => void): order is TransporterGetEnergyOrder | ResourceSourceTask {
		const creep = this.creep;

		if (!order) {
			calculateSourceCallback();
			order = creep.memory.order;
		}
		if (!order) return false;

		if (isResourceSourceOrder(creep.room, order)) {
			return creep.room.sourceDispatcher.validateTask(order, {creep});
		}

		// The only valid source order type is `getEnergy` / `getResource`.
		if (!isCollectOrder(order)) return false;

		const target = Game.getObjectById(order.target);
		if (!target) return false;
		if (creep.memory.singleRoom && target.pos.roomName !== creep.memory.singleRoom) return false;

		const resourceType = order.resourceType;
		if ('store' in target && ((target as AnyStoreStructure).store.getUsedCapacity(resourceType)) > 0) return true;
		if (target instanceof Resource && target.amount > 0) return true;

		return false;
	}

	/**
	 * Sets a good resource source target for this creep.
	 */
	calculateSource() {
		const creep = this.creep;
		const best = utilities.getBestOption(this.getAvailableSources());

		if (!best) {
			delete creep.memory.order;
			return;
		}

		creep.room.visual.text('source: ' + best.type + '@' + best.priority, creep.pos);

		if (isResourceSourceOrder(creep.room, best)) {
			creep.memory.order = best;
			return;
		}

		creep.memory.order = {
			type: 'getResource',
			target: best.object.id,
			resourceType: best.resourceType,
		};
	}

	/**
	 * Creates a priority list of resources available to this creep.
	 *
	 * @return {Array}
	 *   A list of potential resource sources.
	 */
	getAvailableSources(): TransporterSourceOrderOption[] {
		const creep = this.creep;
		const options = this.getAvailableEnergySources();

		const terminal = creep.room.terminal;
		const storage = creep.room.storage;

		// Don't pick up anything that's not energy if there's no place to store.
		if (!terminal && !storage) return options;

		const task = creep.room.sourceDispatcher.getTask({creep});
		if (task) options.push(task);

		// Clear out overfull terminal.
		const storageHasSpace = storage && storage.store.getFreeCapacity() >= 0 && !creep.room.isClearingStorage();
		const terminalNeedsClearing = terminal && (terminal.store.getUsedCapacity() > terminal.store.getCapacity() * 0.8 || creep.room.isClearingTerminal()) && (!creep.room.isClearingStorage());
		const noSpaceForEnergy = terminal && (terminal.store.getFreeCapacity() + terminal.store.getUsedCapacity(RESOURCE_ENERGY)) < 5000;
		if ((terminalNeedsClearing && storageHasSpace) || noSpaceForEnergy) {
			// Find resource with highest count and take that.
			// @todo Unless it's supposed to be sent somewhere else.
			let max = null;
			let maxResourceType = null;
			for (const resourceType in terminal.store) {
				// Do not take out energy if there is enough in storage.
				if (!creep.room.isClearingTerminal() && resourceType === RESOURCE_ENERGY && storage && storage.store[RESOURCE_ENERGY] > terminal.store[RESOURCE_ENERGY] * 5) continue;
				// Do not take out resources that should be sent away.
				if (resourceType === creep.room.memory.fillTerminal) continue;

				if (!max || terminal.store[resourceType] > max) {
					max = terminal.store[resourceType];
					maxResourceType = resourceType;
				}
			}

			const option: TransporterStructureOrderOption = {
				priority: 1,
				weight: 0,
				type: 'structure',
				object: terminal,
				resourceType: maxResourceType,
			};

			if (creep.room.isClearingTerminal() || noSpaceForEnergy) {
				option.priority += 2;
			}

			options.push(option);
		}

		this.addTerminalOperationResourceOptions(options);
		this.addObjectResourceOptions(options, FIND_DROPPED_RESOURCES, 'resource');
		this.addObjectResourceOptions(options, FIND_TOMBSTONES, 'tombstone');
		this.addObjectResourceOptions(options, FIND_RUINS, 'tombstone');
		this.addContainerResourceOptions(options);
		this.addHighLevelResourceOptions(options);
		this.addEvacuatingRoomResourceOptions(options);
		this.addLabResourceOptions(options);

		return options;
	}

	/**
	 * Creates a priority list of energy sources available to this creep.
	 *
	 * @return {Array}
	 *   A list of potential energy sources.
	 */
	getAvailableEnergySources(): TransporterSourceOrderOption[] {
		const room = this.creep.room;
		const options: TransporterSourceOrderOption[] = [];

		const task = this.creep.room.sourceDispatcher.getTask({
			creep: this.creep,
			resourceType: RESOURCE_ENERGY,
		});
		if (task) options.push(task);

		let priority = 0;
		if (room.energyAvailable < room.energyCapacityAvailable * 0.9) {
			// Spawning is important, so get energy when needed.
			priority = 4;
		}
		else if (room.terminal && room.storage && room.storage.store.energy > 5000 && room.terminal.store.energy < room.storage.store.energy * 0.05 && !room.isClearingTerminal()) {
			// Take some energy out of storage to put into terminal from time to time.
			priority = 2;
		}

		this.addObjectEnergySourceOptions(options, FIND_DROPPED_RESOURCES, 'resource', priority);
		this.addObjectEnergySourceOptions(options, FIND_TOMBSTONES, 'tombstone', priority);
		this.addObjectEnergySourceOptions(options, FIND_RUINS, 'tombstone', priority);
		this.addContainerEnergySourceOptions(options);

		return options;
	}

	/**
	 * Adds options for picking up energy from room objects to priority list.
	 *
	 * @param {Array} options
	 *   A list of potential energy sources.
	 * @param {String} findConstant
	 *   The type of find operation to run, e.g. FIND_DROPPED_RESOURCES.
	 * @param {string} optionType
	 *   Type designation of added resource options.
	 */
	addObjectEnergySourceOptions(options: TransporterSourceOrderOption[], findConstant: FIND_RUINS | FIND_TOMBSTONES | FIND_DROPPED_RESOURCES, optionType: 'resource' | 'tombstone', storagePriority: number) {
		const creep = this.creep;

		// Get storage location, since that is a low priority source for transporters.
		const storagePosition = creep.room.getStorageLocation();

		// Look for energy on the ground.
		const targets = creep.room.find(findConstant, {
			filter: target => {
				const store = target instanceof Resource ? {[target.resourceType]: target.amount} : target.store;
				if ((store[RESOURCE_ENERGY] || 0) < 20) return false;
				if (!this.isSafePosition(creep, target.pos)) return false;

				// const result = PathFinder.search(creep.pos, target.pos);
				// if (result.incomplete) return false;

				return true;
			},
		});

		for (const target of targets) {
			const store = target instanceof Resource ? {[target.resourceType]: target.amount} : target.store;
			const option = {
				priority: 4,
				weight: store[RESOURCE_ENERGY] / 100, // @todo Also factor in distance.
				type: optionType,
				object: target,
				resourceType: RESOURCE_ENERGY,
			};

			if (storagePosition && target.pos.x === storagePosition.x && target.pos.y === storagePosition.y) {
				option.priority = creep.memory.role === 'transporter' ? storagePriority : 5;
			}
			else {
				if (store[RESOURCE_ENERGY] < 100) option.priority--;
				if (store[RESOURCE_ENERGY] < 200) option.priority--;

				// If spawn / extensions need filling, transporters should not pick up
				// energy from random targets as readily, instead prioritize storage.
				if (creep.room.energyAvailable < creep.room.energyCapacityAvailable && creep.room.getCurrentResourceAmount(RESOURCE_ENERGY) > 5000 && creep.memory.role === 'transporter') option.priority -= 2;
			}

			option.priority -= creep.room.getCreepsWithOrder('getEnergy', target.id).length * 3;
			option.priority -= creep.room.getCreepsWithOrder('getResource', target.id).length * 3;

			if (creep.room.storage && creep.room.getFreeStorage() < store[RESOURCE_ENERGY] && creep.room.getEffectiveAvailableEnergy() > 20_000) {
				// If storage is super full, try leaving stuff on the ground.
				option.priority -= 2;
			}

			options.push(option);
		}
	}

	/**
	 * Adds options for picking up energy from containers to priority list.
	 *
	 * @param {Array} options
	 *   A list of potential energy sources.
	 */
	addContainerEnergySourceOptions(options: TransporterSourceOrderOption[]) {
		const creep = this.creep;

		// Look for energy in Containers.
		const targets = creep.room.find<StructureContainer>(FIND_STRUCTURES, {
			filter: structure => (structure.structureType === STRUCTURE_CONTAINER)
				&& structure.store[RESOURCE_ENERGY] > creep.store.getCapacity() * 0.1
				&& this.isSafePosition(creep, structure.pos),
		});

		// Prefer containers used as harvester dropoff.
		for (const target of targets) {
			// Don't use the controller container as a normal source if we're upgrading.
			if (target.id === target.room.memory.controllerContainer && creep.room.creepsByRole.upgrader) continue;

			const option: TransporterStructureOrderOption = {
				priority: 1,
				weight: target.store[RESOURCE_ENERGY] / 100, // @todo Also factor in distance.
				type: 'structure',
				object: target,
				resourceType: RESOURCE_ENERGY,
			};

			for (const source of target.room.sources) {
				if (source.getNearbyContainer()?.id !== target.id) continue;

				option.priority++;
				if (target.store.getUsedCapacity() >= creep.store.getFreeCapacity()) {
					// This container is filling up, prioritize emptying it when we aren't
					// busy filling extensions.
					if (creep.room.energyAvailable >= creep.room.energyCapacityAvailable || creep.memory.role !== 'transporter') option.priority += 2;
				}

				break;
			}

			for (const bay of target.room.bays) {
				if (bay.pos.getRangeTo(target.pos) > 0) continue;
				if (!target.room.roomPlanner) continue;
				if (!target.room.roomPlanner.isPlannedLocation(target.pos, 'harvester')) continue;

				if (target.store.getUsedCapacity() < target.store.getCapacity() / 3) {
					// Do not empty containers in harvester bays for quicker extension refills.
					option.priority = -1;
				}

				break;
			}

			option.priority -= creep.room.getCreepsWithOrder('getEnergy', target.id).length * 3;
			option.priority -= creep.room.getCreepsWithOrder('getResource', target.id).length * 3;

			options.push(option);
		}
	}

	/**
	 * Take resources that need to be put in terminal for trading.
	 *
	 * @param {Array} options
	 *   A list of potential resource sources.
	 */
	addTerminalOperationResourceOptions(options: TransporterSourceOrderOption[]) {
		const creep = this.creep;
		const storage = creep.room.storage;
		const terminal = creep.room.terminal;
		if (!storage || !terminal) return;

		// Take resources from storage to terminal for transfer if requested.
		if (creep.room.memory.fillTerminal && terminal.store[RESOURCE_ENERGY] > 5000) {
			const resourceType = creep.room.memory.fillTerminal;
			if (storage.store[resourceType]) {
				if (terminal.store.getFreeCapacity() > 10_000) {
					options.push({
						priority: 4,
						weight: 0,
						type: 'structure',
						object: storage,
						resourceType,
					});
				}
			}
			else {
				// No more of these resources can be taken into terminal.
				delete creep.room.memory.fillTerminal;
			}
		}

		if (creep.room.isClearingTerminal()) return;

		const roomSellOrders = _.filter(Game.market.orders, order => order.roomName === creep.room.name && order.type === ORDER_SELL);
		_.each(roomSellOrders, order => {
			if ((terminal.store[order.resourceType] || 0) >= order.remainingAmount) return;
			if (!storage.store[order.resourceType]) return;
			if (terminal.store.getFreeCapacity() < order.remainingAmount - (terminal.store[order.resourceType] || 0)) return;

			options.push({
				priority: 4,
				weight: 0,
				type: 'structure',
				object: storage,
				resourceType: order.resourceType as ResourceConstant,
			});
		});
	}

	/**
	 * Adds options for picking up resources from certain objects to priority list.
	 *
	 * @param {Array} options
	 *   A list of potential resource sources.
	 * @param {String} findConstant
	 *   The type of find operation to run, e.g. FIND_DROPPED_RESOURCES.
	 * @param {string} optionType
	 *   Type designation of added resource options.
	 */
	addObjectResourceOptions(options: TransporterSourceOrderOption[], findConstant: FIND_RUINS | FIND_TOMBSTONES | FIND_DROPPED_RESOURCES, optionType: 'resource' | 'tombstone') {
		const creep = this.creep;

		// Look for resources on the ground.
		const targets = creep.room.find(findConstant, {
			filter: target => {
				if (!this.isSafePosition(creep, target.pos)) return false;

				const storeAmount = target instanceof Resource ? target.amount : target.store.getUsedCapacity();
				if (storeAmount > 10) {
					const result = PathFinder.search(creep.pos, target.pos);
					if (!result.incomplete) return true;
				}

				return false;
			},
		});

		for (const target of targets) {
			const store = target instanceof Resource ? {[target.resourceType]: target.amount} : target.store;
			for (const resourceType of getResourcesIn(store)) {
				if (resourceType === RESOURCE_ENERGY) continue;
				if (store[resourceType] === 0) continue;

				const option = {
					priority: 4,
					weight: store[resourceType] / 30, // @todo Also factor in distance.
					type: optionType,
					object: target,
					resourceType,
				};

				if (resourceType === RESOURCE_POWER) {
					option.priority++;
				}

				if (creep.room.getFreeStorage() < store[resourceType]) {
					// If storage is super full, try leaving stuff on the ground.
					continue;
				}

				option.priority -= creep.room.getCreepsWithOrder('getEnergy', target.id).length * 2;
				option.priority -= creep.room.getCreepsWithOrder('getResource', target.id).length * 2;

				options.push(option);
			}
		}
	}

	/**
	 * Adds options for picking up resources from containers to priority list.
	 *
	 * @param {Array} options
	 *   A list of potential resource sources.
	 */
	addContainerResourceOptions(options: TransporterSourceOrderOption[]) {
		const room = this.creep.room;
		// We need a decent place to store these resources.
		if (!room.terminal && !room.storage) return;

		// Take non-energy out of containers.
		const containers = room.find<StructureContainer>(FIND_STRUCTURES, {
			filter: structure => structure.structureType === STRUCTURE_CONTAINER && this.isSafePosition(this.creep, structure.pos),
		});

		for (const container of containers) {
			for (const resourceType of getResourcesIn(container.store)) {
				if (resourceType === RESOURCE_ENERGY) continue;
				if (container.store[resourceType] === 0) continue;
				if (container.id === room.mineral.getNearbyContainer()?.id && resourceType === room.mineral.mineralType && container.store[resourceType] < CONTAINER_CAPACITY / 2) continue;

				const option: TransporterStructureOrderOption = {
					priority: 3,
					weight: container.store[resourceType] / 20, // @todo Also factor in distance.
					type: 'structure',
					object: container,
					resourceType,
				};

				option.priority -= room.getCreepsWithOrder('getResource', container.id).length * 2;

				options.push(option);
			}
		}
	}

	/**
	 * Adds options for picking up resources for nukers and power spawns.
	 *
	 * @param {Array} options
	 *   A list of potential resource sources.
	 */
	addHighLevelResourceOptions(options: TransporterSourceOrderOption[]) {
		const room = this.creep.room;

		// Take ghodium if nuker needs it.
		if (room.nuker && room.nuker.store.getFreeCapacity(RESOURCE_GHODIUM) > 0) {
			const target = room.getBestStorageSource(RESOURCE_GHODIUM);
			if (target && target.store[RESOURCE_GHODIUM] > 0) {
				const option = {
					priority: 2,
					weight: 0, // @todo Also factor in distance.
					type: 'structure',
					object: target,
					resourceType: RESOURCE_GHODIUM,
				};

				options.push(option);
			}
		}

		// Take power if power spawn needs it.
		if (room.powerSpawn && room.powerSpawn.store[RESOURCE_POWER] < room.powerSpawn.store.getCapacity(RESOURCE_POWER) * 0.1) {
			const target = room.getBestStorageSource(RESOURCE_POWER);
			if (target && target.store[RESOURCE_POWER] > 0) {
				// @todo Limit amount since power spawn can only hold 100 power at a time.
				// @todo Make sure only 1 creep does this at a time.
				const option = {
					priority: 3,
					weight: 0, // @todo Also factor in distance.
					type: 'structure',
					object: target,
					resourceType: RESOURCE_POWER,
				};

				if (room.isFullOnPower()) {
					option.priority++;
				}

				options.push(option);
			}
		}
	}

	/**
	 * Adds options for picking up resources for moving to terminal.
	 *
	 * @param {Array} options
	 *   A list of potential resource sources.
	 */
	addEvacuatingRoomResourceOptions(options: TransporterSourceOrderOption[]) {
		const room = this.creep.room;
		if (!room.isEvacuating()) return;

		// Take everything out of labs.
		const labs = room.find<StructureLab>(FIND_STRUCTURES, {
			filter: structure => structure.structureType === STRUCTURE_LAB,
		});

		for (const lab of labs) {
			if (room.boostManager.isLabUsedForBoosting(lab.id)) continue;

			if (lab.store[RESOURCE_ENERGY] > 0) {
				options.push({
					priority: 3,
					weight: 0,
					type: 'structure',
					object: lab,
					resourceType: RESOURCE_ENERGY,
				});
			}

			if (lab.mineralType) {
				options.push({
					priority: 3,
					weight: 0,
					type: 'structure',
					object: lab,
					resourceType: lab.mineralType,
				});
			}
		}

		// @todo Destroy nuker once storage is empty so we can pick up contained resources.
	}

	/**
	 * Adds options for picking up resources for lab management.
	 *
	 * @param {Array} options
	 *   A list of potential resource sources.
	 */
	addLabResourceOptions(options: TransporterSourceOrderOption[]) {
		const room = this.creep.room;
		const currentReaction = room.memory.currentReaction;
		if (!room.memory.canPerformReactions) return;
		if (room.isEvacuating()) return;

		const labs = room.memory.labs.reactor;
		for (const labID of labs) {
			// Clear out reaction labs.
			const lab = Game.getObjectById<StructureLab>(labID);
			if (!lab) continue;

			const mineralAmount = lab.store[lab.mineralType];
			const mineralCapacity = lab.store.getCapacity(lab.mineralType);
			if (lab && mineralAmount > 0) {
				if (room.boostManager.isLabUsedForBoosting(lab.id) && lab.mineralType === room.boostManager.getRequiredBoostType(lab.id)) continue;

				const option = {
					priority: 0,
					weight: mineralAmount / mineralCapacity,
					type: 'structure',
					object: lab,
					resourceType: lab.mineralType,
				};

				if (mineralAmount > mineralCapacity * 0.8) {
					option.priority++;
				}

				if (mineralAmount > mineralCapacity * 0.9) {
					option.priority++;
				}

				if (mineralAmount > mineralCapacity * 0.95) {
					option.priority++;
				}

				if (currentReaction) {
					// If we're doing a different reaction now, clean out faster!
					if (REACTIONS[currentReaction[0]][currentReaction[1]] !== lab.mineralType) {
						option.priority = 3;
						option.weight = 0;
					}
				}

				if (option.priority > 0) options.push(option);
			}
		}

		if (!currentReaction) return;

		// Clear out labs with wrong resources.
		let lab = Game.getObjectById<StructureLab>(room.memory.labs.source1);
		if (lab && lab.store[lab.mineralType] > 0 && lab.mineralType !== currentReaction[0]) {
			const option = {
				priority: 3,
				weight: 0,
				type: 'structure',
				object: lab,
				resourceType: lab.mineralType,
			};

			options.push(option);
		}

		lab = Game.getObjectById<StructureLab>(room.memory.labs.source2);
		if (lab && lab.store[lab.mineralType] > 0 && lab.mineralType !== currentReaction[1]) {
			const option = {
				priority: 3,
				weight: 0,
				type: 'structure',
				object: lab,
				resourceType: lab.mineralType,
			};

			options.push(option);
		}

		// Get reaction resources.
		this.addSourceLabResourceOptions(options, Game.getObjectById<StructureLab>(room.memory.labs.source1), currentReaction[0]);
		this.addSourceLabResourceOptions(options, Game.getObjectById<StructureLab>(room.memory.labs.source2), currentReaction[1]);
	}

	/**
	 * Adds options for getting reaction lab resources.
	 *
	 * @param {Array} options
	 *   A list of potential resource sources.
	 * @param {StructureLab} lab
	 *   The lab to fill.
	 * @param {string} resourceType
	 *   The type of resource that should be put in the lab.
	 */
	addSourceLabResourceOptions(options: TransporterSourceOrderOption[], lab: StructureLab, resourceType: ResourceConstant) {
		if (!lab) return;
		if (lab.mineralType && lab.mineralType !== resourceType) return;
		if (lab.store[lab.mineralType] > lab.store.getCapacity(lab.mineralType) * 0.5) return;

		const source = this.creep.room.getBestStorageSource(resourceType);
		if (!source) return;
		if ((source.store[resourceType] || 0) === 0) return;

		const option = {
			priority: 3,
			weight: 1 - (lab.store[lab.mineralType] / lab.store.getCapacity(lab.mineralType)),
			type: 'structure',
			object: source,
			resourceType,
		};

		if (lab.store[lab.mineralType] > lab.store.getCapacity(lab.mineralType) * 0.2) {
			option.priority--;
		}

		options.push(option);
	}

	/**
	 * Makes this creep collect energy.
	 *
	 * @param {Creep} creep
	 *   The creep to run logic for.
	 */
	performGetEnergy(creep: TransporterCreep) {
		this.creep = creep;
		this.performGetResources(() => {
			this.calculateEnergySource();
		});
	}

	/**
	 * Sets a good energy source target for this creep.
	 */
	calculateEnergySource() {
		const creep = this.creep;
		const best = utilities.getBestOption(this.getAvailableEnergySources());

		if (!best) {
			delete creep.memory.order;
			return;
		}

		creep.room.visual.text('source: ' + best.type + '@' + best.priority, creep.pos);

		if (isResourceSourceOrder(creep.room, best)) {
			creep.memory.order = best;
			return;
		}

		creep.memory.order = {
			type: 'getEnergy',
			target: best.object.id,
			resourceType: best.resourceType,
		};
	}
}
