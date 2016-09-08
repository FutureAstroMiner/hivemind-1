 // @todo Build containers automatically at calculated dropoff spots.

var utilities = require('utilities');

StructureKeeperLair.prototype.isDangerous = function () {
    return !this.ticksToSpawn || this.ticksToSpawn < 20;
};

StructureTower.prototype.runLogic = function () {
    var tower = this;

    // Emergency repairs.
    /*var closestDamagedStructure = tower.pos.findClosestByRange(FIND_STRUCTURES, {
        filter: (structure) => {
            if (structure.structureType == STRUCTURE_WALL) {
                return ((structure.pos.getRangeTo(tower) <= 5 && structure.hits < 10000) || structure.hits < 1000) && tower.energy > tower.energyCapacity * 0.7;
            }
            if (structure.structureType == STRUCTURE_RAMPART) {
                return ((structure.pos.getRangeTo(tower) <= 5 && structure.hits < 10000) || structure.hits < 1000) && tower.energy > tower.energyCapacity * 0.7 || structure.hits < 500;
            }
            return (structure.hits < structure.hitsMax - TOWER_POWER_REPAIR) && (structure.hits < structure.hitsMax * 0.2);
        }
    });
    if (closestDamagedStructure) {
        tower.repair(closestDamagedStructure);
    }//*/

    // Attack enemies.
    var closestHostileHealer = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
        filter: (creep) => {
            for (var i in creep.body) {
                if (creep.body[i].type == HEAL && creep.body[i].hits > 0) {
                    return true;
                }
            }
            return false;
        }
    });
    var closestHostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS, {
        filter: (creep) => creep.isDangerous()
    });
    if (closestHostileHealer) {
        tower.attack(closestHostileHealer);
    }
    else if (closestHostile) {
        tower.attack(closestHostile);
    }

    // Heal friendlies.
    var damaged = tower.pos.findClosestByRange(FIND_MY_CREEPS, {
        filter: (creep) => creep.hits < creep.hitsMax
    });
    if (damaged) {
        tower.heal(damaged);
    }
};

Room.prototype.manageLabs = function () {
    if (this.controller && this.controller.my && this.memory.canPerformReactions && this.memory.currentReaction) {
        var source1 = Game.getObjectById(this.memory.labs.source1);
        var source2 = Game.getObjectById(this.memory.labs.source2);

        var labs = this.memory.labs.reactor;
        if (!labs) return;
        if (typeof labs == 'string') {
            labs = [labs];
            this.memory.labs.reactor = labs;
        }
        for (let i in labs) {
            var reactor = Game.getObjectById(labs[i]);

            if (source1 && source2 && reactor) {
                if (reactor.cooldown <= 0 && source1.mineralType == this.memory.currentReaction[0] && source2.mineralType == this.memory.currentReaction[1]) {
                    reactor.runReaction(source1, source2);
                }
            }
        }
    }
};

var structureManager = {

    /**
     * Determines the amount of available resources in each room.
     */
    getRoomResourceStates: function () {
        var rooms = {};

        for (let roomId in Game.rooms) {
            let room = Game.rooms[roomId];

            let storage = room.storage;
            let terminal = room.terminal;

            if (!room.controller || !room.controller.my) {
                continue;
            }

            let roomData = {
                totalResources: {},
                state: {},
                canTrade: false,
            };
            if (storage && terminal) {
                roomData.canTrade = true;
            }

            if (storage) {
                for (let resourceType in storage.store) {
                    roomData.totalResources[resourceType] = storage.store[resourceType];
                }
            }
            if (terminal) {
                for (let resourceType in terminal.store) {
                    if (!roomData.totalResources[resourceType]) {
                        roomData.totalResources[resourceType] = 0;
                    }
                    roomData.totalResources[resourceType] += terminal.store[resourceType];
                }
            }

            for (let resourceType in roomData.totalResources) {
                let amount = roomData.totalResources[resourceType];
                if (resourceType == RESOURCE_ENERGY) {
                    amount /= 2.5;
                }

                if (amount >= 220000) {
                    roomData.state[resourceType] = 'excessive';
                }
                else if (amount >= 30000) {
                    roomData.state[resourceType] = 'high';
                }
                else if (amount >= 10000) {
                    roomData.state[resourceType] = 'medium';
                }
                else {
                    roomData.state[resourceType] = 'low';
                }
            }

            rooms[room.name] = roomData;
        }

        return rooms;
    },

    /**
     * Determines when it makes sense to transport resources between rooms.
     */
    getAvailableTransportRoutes: function (rooms) {
        var options = [];

        for (var roomName in rooms) {
            var roomState = rooms[roomName];
            if (!roomState.canTrade) continue;

            // Do not try transferring from a room that is already preparing a transfer.
            if (Game.rooms[roomName].memory.fillTerminal) continue;

            for (var resourceType in roomState.state) {
                if (roomState.state[resourceType] == 'high' || roomState.state[resourceType] == 'excessive') {
                    // Look for other rooms that are low on this resource.
                    for (var roomName2 in rooms) {
                        if (!rooms[roomName2].canTrade) continue;

                        if (!rooms[roomName2].state[resourceType] || rooms[roomName2].state[resourceType] == 'low' || (roomState.state[resourceType] == 'excessive' && (rooms[roomName2].state[resourceType] == 'medium' || rooms[roomName2].state[resourceType] == 'high'))) {
                            // Make sure target has space left.
                            if (_.sum(Game.rooms[roomName2].terminal.store) > Game.rooms[roomName2].terminal.storeCapacity - 5000) {
                                continue;
                            }

                            var option = {
                                priority: 5,
                                weight: (roomState.totalResources[resourceType] - rooms[roomName2].totalResources[resourceType]) / 100000 - Game.map.getRoomLinearDistance(roomName, roomName2),
                                resourceType: resourceType,
                                source: roomName,
                                target: roomName2,
                            };

                            if (rooms[roomName2].state[resourceType] == 'medium') {
                                option.priority--;
                            }

                            //option.priority -= Game.map.getRoomLinearDistance(roomName, roomName2) * 0.5;

                            options.push(option);
                        }
                    }
                }
            }
        }

        return options;
    },

    /**
     * Sets appropriate reactions for each room depending on available resources.
     */
    chooseReactions: function (rooms) {
        for (let roomName in rooms) {
            let room = Game.rooms[roomName];
            let roomData = rooms[roomName];

            if (room.memory.canPerformReactions) {
                // Try to find possible reactions where we have a good amount of resources.
                var bestReaction = null;
                var mostResources = null;
                for (var resourceType in roomData.totalResources) {
                    if (roomData.totalResources[resourceType] > 0 && REACTIONS[resourceType]) {
                        for (var resourceType2 in REACTIONS[resourceType]) {
                            let targetType = REACTIONS[resourceType][resourceType2];
                            if (roomData.totalResources[targetType] > 10000) continue;

                            if (roomData.totalResources[resourceType2] && roomData.totalResources[resourceType2] > 0) {
                                //console.log(resourceType, '+', resourceType2, '=', REACTIONS[resourceType][resourceType2]);
                                var resourceAmount = Math.min(roomData.totalResources[resourceType], roomData.totalResources[resourceType2]);

                                // Also prioritize reactions whose product we don't have much of.
                                resourceAmount -= (roomData.totalResources[targetType] || 0);

                                if (!mostResources || mostResources < resourceAmount) {
                                    mostResources = resourceAmount;
                                    bestReaction = [resourceType, resourceType2];
                                }
                            }
                        }
                    }
                }

                room.memory.currentReaction = bestReaction;
                if (bestReaction) {
                    new Game.logger('labs', roomName).log('now producing', REACTIONS[bestReaction[0]][bestReaction[1]]);
                }
            }
        }
    },

    /**
     * Manages all rooms' resources.
     */
    manageResources: function () {
        let rooms = structureManager.getRoomResourceStates();
        let best = utilities.getBestOption(structureManager.getAvailableTransportRoutes(rooms));

        if (best) {
            let terminal = Game.rooms[best.source].terminal;
            if (terminal.store[best.resourceType] && terminal.store[best.resourceType] > 5000) {
                let result = terminal.send(best.resourceType, 5000, best.target, "Resource equalizing");
                new Game.logger('trade').log("sending", best.resourceType, "from", best.source, "to", best.target, ":", result);
            }
            else {
                new Game.logger('trade').log("Preparing 5000", best.resourceType, 'for transport from', best.source, 'to', best.target);
                Game.rooms[best.source].memory.fillTerminal = best.resourceType;
            }
        }

        if (Game.time % 1500 == 981) {
            structureManager.chooseReactions(rooms);
        }
    },

};

module.exports = structureManager;
