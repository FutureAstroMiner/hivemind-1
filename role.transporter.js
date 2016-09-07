/*
 * Module code goes here. Use 'module.exports' to export things:
 * module.exports.thing = 'a thing';
 *
 * You can import it from another modules like this:
 * var mod = require('role.builder');
 * mod.thing == 'a thing'; // true
 */

var creepGeneral = require('creep.general');
var utilities = require('utilities');

/**
 * Creates a priority list of energy sources available to this creep.
 */
Creep.prototype.getAvailableEnergySources = function () {
    var creep = this;
    var storage = this.room.storage;
    var terminal = this.room.terminal;
    var options = [];

    var storagePriority = 0;
    if (creep.room.energyAvailable < creep.room.energyCapacityAvailable * 0.9) {
        // Spawning is important, so get energy when needed.
        storagePriority = 4;
    }
    else if (creep.room.terminal && creep.room.storage && creep.room.terminal.store.energy < creep.room.storage.store.energy * 0.05) {
        // Take some energy out of storage to put into terminal from time to time.
        storagePriority = 2;
    }

    // Energy can be gotten at the room's storage.
    if (storage && storage.store.energy >= creep.carryCapacity - _.sum(creep.carry)) {
        // Only transporters can get the last bit of energy from storage, so spawning can always go on.
        if (creep.memory.role == 'transporter' || storage.store.energy > 5000) {
            options.push({
                priority: creep.memory.role == 'transporter' ? storagePriority : 5,
                weight: 0,
                type: 'structure',
                object: storage,
                resourceType: RESOURCE_ENERGY,
            });
        }
    }

    // Energy can be gotten at the room's terminal if storage is pretty empty.
    if (terminal && terminal.store.energy >= creep.carryCapacity - _.sum(creep.carry)) {
        if (!storage || storage.store.energy < 5000) {
            options.push({
                priority: creep.memory.role == 'transporter' ? storagePriority - 1 : 4,
                weight: 0,
                type: 'structure',
                object: terminal,
                resourceType: RESOURCE_ENERGY,
            });
        }
    }

    // Get storage location, since that is a low priority source for transporters.
    var storagePosition = creep.room.getStorageLocation();

    // Look for energy on the ground.
    var targets = creep.room.find(FIND_DROPPED_ENERGY, {
        filter: (resource) => {
            if (resource.resourceType == RESOURCE_ENERGY) {
                if (resource.amount < 200) return false;
                if (creep.pos.findPathTo(resource)) return true;
            }
            return false;
        }
    });

    for (var i in targets) {
        var target = targets[i];
        var option = {
            priority: 4,
            weight: target.amount / 100, // @todo Also factor in distance.
            type: 'resource',
            object: target,
            resourceType: RESOURCE_ENERGY,
        };

        if (storagePosition && target.pos.x == storagePosition.x && target.pos.y == storagePosition.y) {
            if (creep.memory.role == 'transporter') {
                option.priority = storagePriority;
            }
            else {
                option.priority = 5;
            }
        }
        else {
            option.priority -= creepGeneral.getCreepsWithOrder('getEnergy', target.id).length * 3;
        }

        options.push(option);
    }

    // Look for energy in Containers.
    var targets = creep.room.find(FIND_STRUCTURES, {
        filter: (structure) => {
            return (structure.structureType == STRUCTURE_CONTAINER) && structure.store[RESOURCE_ENERGY] > creep.carryCapacity * 0.1;
        }
    });

    // Prefer containers used as harvester dropoff.
    for (var i in targets) {
        var target = targets[i];

        // Don't use the controller container as a normal source.
        if (target.id == target.room.memory.controllerContainer) {
            continue;
        }

        // Actually, don't use other containers, only those with harvesters are a valid source.
        var option = {
            priority: -1,
            weight: target.store[RESOURCE_ENERGY] / 100, // @todo Also factor in distance.
            type: 'structure',
            object: target,
            resourceType: RESOURCE_ENERGY,
        };

        if (target.room.memory.sources) {
            for (var id in target.room.memory.sources) {
                if (target.room.memory.sources[id].targetContainer && target.room.memory.sources[id].targetContainer == target.id) {
                    option.priority = 2;
                    if (_.sum(target.store) >= creep.carryCapacity - _.sum(creep.carry)) {
                        // This container is filling up, prioritize emptying it.
                        option.priority += 2;
                    }
                    break;
                }
            }
        }

        option.priority -= creepGeneral.getCreepsWithOrder('getEnergy', target.id).length * 3;

        options.push(option);
    }

    return options;
};

/**
 * Creates a priority list of resources available to this creep.
 */
Creep.prototype.getAvailableSources = function () {
    var creep = this;
    var options = creep.getAvailableEnergySources();

    // Clear out overfull terminal.
    let terminal = creep.room.terminal;
    let storage = creep.room.storage;
    if (terminal && _.sum(terminal.store) > terminal.storeCapacity * 0.8) {
        // Find resource with highest count and take that.
        // @todo Unless it's supposed to be sent somewhere else.
        let max = null;
        let maxResourceType = null;
        for (let resourceType in terminal.store) {
            if (resourceType == RESOURCE_ENERGY && storage.store[RESOURCE_ENERGY] > terminal.store[RESOURCE_ENERGY] * 5) {
                // Do not take out energy if there is enough in storage.
                continue;
            }

            if (!max || terminal.store[resourceType] > max) {
                max = terminal.store[resourceType];
                maxResourceType = resourceType;
            }
        }

        options.push({
            priority: 1,
            weight: 0,
            type: 'structure',
            object: terminal,
            resourceType: maxResourceType,
        });
    }

    // @todo Take resources from storage if terminal is relatively empty.

    // Take resources from storage to terminal for transfer if requested.
    if (creep.room.memory.fillTerminal) {
        let resourceType = creep.room.memory.fillTerminal;
        if (storage && terminal && storage.store[resourceType] && storage.store[resourceType] > this.carryCapacity && _.sum(terminal.store) < terminal.storeCapacity - 10000) {
            options.push({
                priority: 4,
                weight: 0,
                type: 'structure',
                object: storage,
                resourceType: resourceType,
            });
        }
    }

    // Look for resources on the ground.
    var targets = creep.room.find(FIND_DROPPED_RESOURCES, {
        filter: (resource) => {
            if (resource.amount > 10 && creep.pos.findPathTo(resource)) {
                return true;
            }
            return false;
        }
    });

    for (var i in targets) {
        var target = targets[i];
        var option = {
            priority: 4,
            weight: target.amount / 30, // @todo Also factor in distance.
            type: 'resource',
            object: target,
            resourceType: target.resourceType,
        };

        options.push(option);
    }

    // Take non-energy out of containers.
    if (terminal || storage) {
        let containers = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => structure.structureType == STRUCTURE_CONTAINER
        });

        for (let i in containers) {
            for (let resourceType in containers[i].store) {
                if (resourceType != RESOURCE_ENERGY && containers[i].store[resourceType] > 0) {
                    var option = {
                        priority: 3,
                        weight: containers[i].store[resourceType] / 20, // @todo Also factor in distance.
                        type: 'structure',
                        object: containers[i],
                        resourceType: resourceType,
                    };

                    options.push(option);
                }
            }
        }
    }

    if (creep.room.memory.canPerformReactions) {
        let labs = creep.room.memory.labs.reactor;
        if (typeof labs == 'string') {
            labs = [labs];
            creep.room.memory.labs.reactor = labs;
        }

        for (let i in labs) {
            // Clear out reaction labs.
            let lab = Game.getObjectById(labs[i]);

            if (lab && lab.mineralAmount > 0) {
                let option = {
                    priority: 0,
                    weight: lab.mineralAmount / lab.mineralCapacity,
                    type: 'structure',
                    object: lab,
                    resourceType: lab.mineralType,
                };

                if (lab.mineralAmount > lab.mineralCapacity * 0.5) {
                    option.priority++;
                }
                if (lab.mineralAmount > lab.mineralCapacity * 0.8) {
                    option.priority++;
                }

                if (creep.room.memory.currentReaction) {
                    // If we're doing a different reaction now, clean out faster!
                    if (REACTIONS[creep.room.memory.currentReaction[0]][creep.room.memory.currentReaction[1]] != lab.mineralType) {
                        option.priority = 4;
                        option.weight = 0;
                    }
                }

                options.push(option);
            }
        }

        // Clear out labs with wrong resources.
        lab = Game.getObjectById(creep.room.memory.labs.source1);
        if (lab && lab.mineralAmount > 0 && creep.room.memory.currentReaction && lab.mineralType != creep.room.memory.currentReaction[0]) {
            let option = {
                priority: 3,
                weight: 0,
                type: 'structure',
                object: lab,
                resourceType: lab.mineralType,
            };

            options.push(option);
        }
        lab = Game.getObjectById(creep.room.memory.labs.source2);
        if (lab && lab.mineralAmount > 0 && creep.room.memory.currentReaction && lab.mineralType != creep.room.memory.currentReaction[1]) {
            let option = {
                priority: 3,
                weight: 0,
                type: 'structure',
                object: lab,
                resourceType: lab.mineralType,
            };

            options.push(option);
        }

        // Get reaction resources from terminal.
        if (creep.room.memory.currentReaction) {
            lab = Game.getObjectById(creep.room.memory.labs.source1);
            if (lab && (!lab.mineralType || lab.mineralType == creep.room.memory.currentReaction[0]) && lab.mineralAmount < lab.mineralCapacity * 0.5) {
                var source = terminal;
                if (!terminal.store[creep.room.memory.currentReaction[0]] || terminal.store[creep.room.memory.currentReaction[0]] <= 0) {
                    source = creep.room.storage;
                }
                let option = {
                    priority: 3,
                    weight: 1 - lab.mineralAmount / lab.mineralCapacity,
                    type: 'structure',
                    object: source,
                    resourceType: creep.room.memory.currentReaction[0],
                };

                if (lab.mineralAmount > lab.mineralCapacity * 0.2) {
                    option.priority--;
                }

                options.push(option);
            }
            lab = Game.getObjectById(creep.room.memory.labs.source2);
            if (lab && (!lab.mineralType || lab.mineralType == creep.room.memory.currentReaction[1]) && lab.mineralAmount < lab.mineralCapacity * 0.5) {
                var source = terminal;
                if (!terminal.store[creep.room.memory.currentReaction[1]] || terminal.store[creep.room.memory.currentReaction[1]] <= 0) {
                    source = creep.room.storage;
                }
                let option = {
                    priority: 3,
                    weight: 1 - lab.mineralAmount / lab.mineralCapacity,
                    type: 'structure',
                    object: source,
                    resourceType: creep.room.memory.currentReaction[1],
                };

                if (lab.mineralAmount > lab.mineralCapacity * 0.2) {
                    option.priority--;
                }

                options.push(option);
            }
        }

        // @todo Get reaction resources from storage.
    }

    return options;
};

/**
 * Sets a good energy source target for this creep.
 */
Creep.prototype.calculateEnergySource = function () {
    var creep = this;
    var best = utilities.getBestOption(creep.getAvailableEnergySources());

    if (best) {
        //console.log('best energy source for this', creep.memory.role , ':', best.type, best.object.id, '@ priority', best.priority, best.weight);
        creep.memory.sourceTarget = best.object.id;

        creep.memory.order = {
            type: 'getEnergy',
            target: best.object.id,
            resourceType: best.resourceType,
        };
    }
    else {
        delete creep.memory.sourceTarget;
        delete creep.memory.order;
    }
};

/**
 * Sets a good resource source target for this creep.
 */
Creep.prototype.calculateSource = function () {
    var creep = this;
    var best = utilities.getBestOption(creep.getAvailableSources());

    if (best) {
        //console.log('best source for this', creep.memory.role , ':', best.type, best.object.id, '@ priority', best.priority, best.weight);
        creep.memory.sourceTarget = best.object.id;

        creep.memory.order = {
            type: 'getResource',
            target: best.object.id,
            resourceType: best.resourceType,
        };

        /*if (creep.pos.roomName == 'E49S47') {
            console.log('new target:', best.priority, best.weight, best.resourceType, creep.pos.roomName);
        }//*/
    }
    else {
        delete creep.memory.sourceTarget;
        delete creep.memory.order;
    }
};

/**
 * Makes this creep collect energy.
 */
Creep.prototype.performGetEnergy = function () {
    var creep = this;
    //creep.memory.sourceTarget = null;
    if (!creep.memory.sourceTarget) {
        creep.calculateEnergySource();
    }

    var best = creep.memory.sourceTarget;
    if (!best) {
        if (creep.memory.role == 'transporter' && creep.carry[RESOURCE_ENERGY] > 0) {
            // Deliver what energy we already have stored, if no more can be found for picking up.
            creep.setTransporterState(true);
        }
        return false;
    }
    var target = Game.getObjectById(best);
    if (!target || (target.store && target.store[RESOURCE_ENERGY] <= 0) || (target.amount && target.amount <= 0) || (target.mineralAmount && target.mineralAmount <= 0)) {
        creep.calculateEnergySource();
    }
    else if (target.store) {
        if (creep.pos.getRangeTo(target) > 1) {
            creep.moveTo(target);
        }
        else {
            let result = creep.withdraw(target, RESOURCE_ENERGY);
            if (result == OK) {
                creep.calculateEnergySource();
            }
        }
    }
    else if (target.amount) {
        if (creep.pos.getRangeTo(target) > 1) {
            creep.moveTo(target);
        }
        else {
            let result = creep.pickup(target);
            if (result == OK) {
                creep.calculateEnergySource();
            }
        }
    }
    return true;
};

/**
 * Makes this creep collect resources.
 */
Creep.prototype.performGetResources = function () {
    var creep = this;
    //creep.memory.sourceTarget = null;
    if (!creep.memory.sourceTarget) {
        creep.calculateSource();
    }

    var best = creep.memory.sourceTarget;
    if (!best) {
        if (creep.memory.role == 'transporter' && _.sum(creep.carry) > 0) {
            // Deliver what we already have stored, if no more can be found for picking up.
            creep.setTransporterState(true);
        }
        return false;
    }
    var target = Game.getObjectById(best);
    if (!target || (target.store && _.sum(target.store) <= 0) || (target.amount && target.amount <= 0) || (target.mineralAmount && (target.mineralAmount <= 0 || target.mineralType != creep.memory.order.resourceType))) {
        creep.calculateSource();
    }
    else if (target.store && (!target.store[creep.memory.order.resourceType] || target.store[creep.memory.order.resourceType] <= 0)) {
        creep.calculateSource();
    }
    else if (target.store) {
        if (creep.pos.getRangeTo(target) > 1) {
            creep.moveTo(target);
        }
        else {
            let result = creep.withdraw(target, creep.memory.order.resourceType);
            if (result == OK) {
                creep.calculateEnergySource();
            }
        }
    }
    else if (target.amount) {
        if (creep.pos.getRangeTo(target) > 1) {
            creep.moveTo(target);
        }
        else {
            let result = creep.pickup(target);
            if (result == OK) {
                creep.calculateEnergySource();
            }
        }
    }
    else if (target.mineralAmount) {
        if (creep.pos.getRangeTo(target) > 1) {
            creep.moveTo(target);
        }
        else {
            let result = creep.withdraw(target, creep.memory.order.resourceType);
            if (result == OK) {
                creep.calculateSource();
            }
        }
    }
    else if (target.mineralCapacity) {
        // Empty lab.
        creep.calculateSource();
    }
    return true;
};

/**
 * Creates a priority list of possible delivery targets for this creep.
 */
Creep.prototype.getAvailableDeliveryTargets = function () {
    var creep = this;
    var options = [];

    let terminal = creep.room.terminal;
    let storage = creep.room.storage;

    if (creep.carry.energy > creep.carryCapacity * 0.1) {
        // Primarily fill spawn and extenstions.
        var targets = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return ((structure.structureType == STRUCTURE_EXTENSION && !structure.isBayExtension()) ||
                        structure.structureType == STRUCTURE_SPAWN) && structure.energy < structure.energyCapacity;
            }
        });

        for (let i in targets) {
            let target = targets[i];

            let canDeliver = Math.min(creep.carry.energy, target.energyCapacity - target.energy);

            let option = {
                priority: 5,
                weight: canDeliver / creep.carryCapacity,
                type: 'structure',
                object: target,
                resourceType: RESOURCE_ENERGY,
            };

            option.weight += 1 - (creep.pos.getRangeTo(target) / 100);
            option.priority -= creepGeneral.getCreepsWithOrder('deliver', target.id).length * 3;

            options.push(option);
        }

        // Fill bays.
        for (let i in creep.room.bays) {
            let target = creep.room.bays[i];

            if (target.energy >= target.energyCapacity) continue;

            let canDeliver = Math.min(creep.carry.energy, target.energyCapacity - target.energy);

            let option = {
                priority: 5,
                weight: canDeliver / creep.carryCapacity,
                type: 'bay',
                object: target,
                resourceType: RESOURCE_ENERGY,
            };

            option.weight += 1 - (creep.pos.getRangeTo(target) / 100);
            option.priority -= creepGeneral.getCreepsWithOrder('deliver', target.name).length * 3;

            options.push(option);
        }

        // Fill containers.
        var targets = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                if (structure.structureType == STRUCTURE_CONTAINER && structure.store.energy < structure.storeCapacity) {
                    // Do deliver to controller containers, always.
                    if (structure.id == structure.room.memory.controllerContainer) {
                        return true;
                    }

                    // Do not deliver to containers used as harvester drop off points.
                    if (structure.room.sources) {
                        for (let id in structure.room.sources) {
                            let container = structure.room.sources[id].getNearbyContainer();
                            if (container && container.id == structure.id) {
                                return false;
                            }
                        }
                        if (structure.room.mineral) {
                            let container = structure.room.mineral.getNearbyContainer();
                            if (container && container.id == structure.id) {
                                return false;
                            }
                        }
                    }
                    return true;
                }
                return false;
            }
        });

        for (let i in targets) {
            let target = targets[i];
            let option = {
                priority: 4,
                weight: (target.storeCapacity - target.store[RESOURCE_ENERGY]) / 100, // @todo Also factor in distance, and other resources.
                type: 'structure',
                object: target,
                resourceType: RESOURCE_ENERGY,
            };

            let prioFactor = 1;
            if (target.store[RESOURCE_ENERGY] / target.storeCapacity > 0.5) {
                prioFactor = 2;
            }
            else if (target.store[RESOURCE_ENERGY] / target.storeCapacity > 0.75) {
                prioFactor = 3;
            }

            option.priority -= creepGeneral.getCreepsWithOrder('deliver', target.id).length * prioFactor;

            options.push(option);
        }

        // Supply towers.
        var targets = creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return (structure.structureType == STRUCTURE_TOWER) && structure.energy < structure.energyCapacity * 0.8;
            }
        });

        for (var i in targets) {
            var target = targets[i];
            var option = {
                priority: 3,
                weight: (target.energyCapacity - target.energy) / 100, // @todo Also factor in distance.
                type: 'structure',
                object: target,
                resourceType: RESOURCE_ENERGY,
            };

            option.priority -= creepGeneral.getCreepsWithOrder('deliver', target.id).length * 2;

            options.push(option);
        }

        // Supply terminal with excess energy.
        if (terminal && _.sum(terminal.store) < terminal.storeCapacity) {
            if (creep.room.storage && terminal.store.energy < storage.store.energy * 0.1) {
                let option = {
                    priority: 2,
                    weight: 0,
                    type: 'structure',
                    object: terminal,
                    resourceType: RESOURCE_ENERGY,
                };

                if (terminal.store.energy < 5000) {
                    option.priority += 1;
                }

                options.push(option);
            }
        }

        // Deliver excess energy to storage.
        if (storage) {
            options.push({
                priority: 0,
                weight: 0,
                type: 'structure',
                object: storage,
                resourceType: RESOURCE_ENERGY,
            });
        }
        else {
            var storagePosition = creep.room.getStorageLocation();
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

        // Deliver energy to storage link.
        if (creep.room.memory.storageLink) {
            var target = Game.getObjectById(creep.room.memory.storageLink);
            if (target && target.energy < target.energyCapacity) {
                let option = {
                    priority: 5,
                    weight: (target.energyCapacity - target.energy) / 100, // @todo Also factor in distance.
                    type: 'structure',
                    object: target,
                    resourceType: RESOURCE_ENERGY,
                };

                if (creep.pos.getRangeTo(target) > 3) {
                    // Don't go out of your way to fill the link, do it when energy is taken out of storage.
                    option.priority = 4;
                }

                options.push(option);
            }
        }
    }

    for (let resourceType in creep.carry) {
        // If it's needed for transferring, store in terminal.
        if (resourceType == creep.room.memory.fillTerminal && creep.carry[resourceType] > 0) {
            if (terminal && (!terminal.store[resourceType] || terminal.store[resourceType] < 10000) && _.sum(terminal.store) < terminal.storeCapacity) {
                var option = {
                    priority: 4,
                    weight: creep.carry[resourceType] / 100, // @todo Also factor in distance.
                    type: 'structure',
                    object: terminal,
                    resourceType: resourceType,
                };
                options.push(option);
            }
            else {
                delete creep.room.memory.fillTerminal;
            }
        }

        // The following only only concerns resources other than energy.
        if (resourceType == RESOURCE_ENERGY || creep.carry[resourceType] <= 0) {
            continue;
        }

        // If there is space left, store in terminal.
        if (terminal && _.sum(terminal.store) < terminal.storeCapacity) {
            var option = {
                priority: 0,
                weight: creep.carry[resourceType] / 100, // @todo Also factor in distance.
                type: 'structure',
                object: creep.room.terminal,
                resourceType: resourceType,
            };

            if (_.sum(creep.room.terminal.store) - creep.room.terminal.store.energy < creep.room.terminal.storeCapacity * 0.6 && _.sum(creep.room.terminal.store) < creep.room.terminal.storeCapacity * 0.7) {
                option.priority = 3;
            }

            options.push(option);
        }

        // If there is space left, store in storage.
        if (storage && _.sum(storage.store) < storage.storeCapacity) {
            options.push({
                priority: 1,
                weight: creep.carry[resourceType] / 100, // @todo Also factor in distance.
                type: 'structure',
                object: storage,
                resourceType: resourceType,
            });
        }

        // Put correct resources into labs.
        if (creep.room.memory.currentReaction) {
            if (resourceType == creep.room.memory.currentReaction[0]) {
                let lab = Game.getObjectById(creep.room.memory.labs.source1);
                if (lab && (!lab.mineralType || lab.mineralType == resourceType) && lab.mineralAmount < lab.mineralCapacity * 0.8) {
                    options.push({
                        priority: 4,
                        weight: creep.carry[resourceType] / 100, // @todo Also factor in distance.
                        type: 'structure',
                        object: lab,
                        resourceType: resourceType,
                    });
                }
            }
            if (resourceType == creep.room.memory.currentReaction[1]) {
                let lab = Game.getObjectById(creep.room.memory.labs.source2);
                if (lab && (!lab.mineralType || lab.mineralType == resourceType) && lab.mineralAmount < lab.mineralCapacity * 0.8) {
                    options.push({
                        priority: 4,
                        weight: creep.carry[resourceType] / 100, // @todo Also factor in distance.
                        type: 'structure',
                        object: lab,
                        resourceType: resourceType,
                    });
                }
            }
        }
    }

    return options;
};

/**
 * Sets a good energy delivery target for this creep.
 */
Creep.prototype.calculateDeliveryTarget = function () {
    var creep = this;
    var best = utilities.getBestOption(creep.getAvailableDeliveryTargets());

    if (best) {
        //console.log('energy for this', creep.memory.role , 'should be delivered to:', best.type, best.object.id, '@ priority', best.priority, best.weight);
        if (best.type == 'position') {
            creep.memory.deliverTarget = {x: best.object.x, y: best.object.y, type: best.type};

            creep.memory.order = {
                type: 'deliver',
                target: utilities.encodePosition(best.object),
                resourceType: best.resourceType,
            };
        }
        else if (best.type == 'bay') {
            creep.memory.deliverTarget = {x: best.object.pos.x, y: best.object.pos.y, type: best.type},

            creep.memory.order = {
                type: 'deliver',
                target: best.object.name,
                resourceType: best.resourceType,
            };
        }
        else {
            creep.memory.deliverTarget = best.object.id;

            creep.memory.order = {
                type: 'deliver',
                target: best.object.id,
                resourceType: best.resourceType,
            };
        }
    }
    else {
        delete creep.memory.deliverTarget;
    }
};

/**
 * Makes this creep deliver carried energy somewhere.
 */
Creep.prototype.performDeliver = function () {
    var creep = this;
    if (!creep.memory.deliverTarget) {
        creep.calculateDeliveryTarget();
    }
    var best = creep.memory.deliverTarget;
    if (!best) {
        return false;
    }

    if (typeof best == 'string') {
        var target = Game.getObjectById(best);
        if (!target) {
            creep.calculateDeliveryTarget();
            return true;
        }
        if (!creep.carry[creep.memory.order.resourceType] || creep.carry[creep.memory.order.resourceType] <= 0) {
            creep.calculateDeliveryTarget();
        }

        if (creep.pos.getRangeTo(target) > 1) {
            creep.moveTo(target);
        }
        else {
            creep.transfer(target, creep.memory.order.resourceType);
        }
        if ((target.energy && target.energy >= target.energyCapacity) || (target.store && _.sum(target.store) >= target.storeCapacity) || (target.mineralAmount && target.mineralAmount >= target.mineralCapacity)) {
            creep.calculateDeliveryTarget();
        }
        else if (target.mineralAmount && target.mineralType != creep.memory.order.resourceType) {
            creep.calculateDeliveryTarget();
        }
        return true;
    }
    else if (best.type == 'bay') {
        let target = creep.room.bays[creep.memory.order.target];
        if (!target) {
            creep.calculateDeliveryTarget();
            return true;
        }

        if (creep.pos.getRangeTo(target) > 0) {
            creep.moveTo(target);
        }
        else {
            target.refillFrom(creep);
        }
        if (target.energy >= target.energyCapacity) {
            creep.calculateDeliveryTarget();
        }
        if (!creep.carry[creep.memory.order.resourceType] || creep.carry[creep.memory.order.resourceType] <= 0) {
            creep.calculateDeliveryTarget();
        }
        return true;
    }
    else if (best.x) {
        // Dropoff location.
        if (creep.pos.x == best.x && creep.pos.y == best.y) {
            creep.drop(creep.memory.order.resourceType);
        }
        else {
            var result = creep.moveTo(best.x, best.y);
            //console.log(result);
            if (result == ERR_NO_PATH) {
                if (!creep.memory.blockedPathCounter) {
                    creep.memory.blockedPathCounter = 0;
                }
                creep.memory.blockedPathCounter++;

                if (creep.memory.blockedPathCounter > 10) {
                    creep.calculateDeliveryTarget();
                }
            }
            else {
                delete creep.memory.blockedPathCounter;
            }
        }
        return true;

    }
    else {
        // Unknown target type, reset!
        console.log('Unknown target type for delivery found!');
        console.log(creep.memory.deliverTarget);
        delete creep.memory.deliverTarget;
    }
};

/**
 * Puts this creep into or out of delivery mode.
 */
Creep.prototype.setTransporterState = function (delivering) {
    this.memory.delivering = delivering;
    delete this.memory.sourceTarget;
    delete this.memory.order;
    delete this.memory.deliverTarget;
    delete this.memory.tempRole;
};

Creep.prototype.runTransporterLogic = function () {
    if (this.memory.singleRoom && this.pos.roomName != this.memory.singleRoom) {
        this.moveToRange(new RoomPosition(25, 25, this.memory.singleRoom), 10);
        return;
    }

    if (_.sum(this.carry) >= this.carryCapacity * 0.9 && !this.memory.delivering) {
        this.setTransporterState(true);
    }
    else if (_.sum(this.carry) <= this.carryCapacity * 0.1 && this.memory.delivering) {
        this.setTransporterState(false);
    }

    if (!this.memory.delivering) {
        // Make sure not to keep standing on resource drop stop.
        var storagePosition = this.room.getStorageLocation();
        if (!this.room.storage && storagePosition && this.pos.x == storagePosition.x && this.pos.y == storagePosition.y) {
            this.move(_.random(1, 8));
            return true;
        }

        return this.performGetResources();
    }
    else {
        return this.performDeliver();
    }

    return true;
};
