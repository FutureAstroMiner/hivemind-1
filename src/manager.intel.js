// @todo Mark inaccessible rooms accessible again after a set number of ticks (to revisit with scouts or something similar).

Room.prototype.gatherIntel = function () {
    var room = this;
    if (!room.memory.intel) {
        room.memory.intel = {};
    }
    var intel = room.memory.intel;

    let lastScanThreshold = 500;
    if (Game.cpu.bucket < 5000) {
        lastScanThreshold = 2500;
    }

    if (intel.lastScan && Game.time - intel.lastScan < lastScanThreshold) return;
    new Game.logger('intel', this.name).debug('Gathering intel after', intel.lastScan && Game.time - intel.lastScan || 'infinite', 'ticks.');
    intel.lastScan = Game.time;

    // @todo Check if this could cause problems.
    intel.inaccessible = false;

    // Check room controller.
    intel.owner = null;
    intel.rcl = 0;
    intel.ticksToDowngrade = 0;
    intel.ticksToNeutral = 0;
    intel.hasController = (room.controller ? true : false);
    if (room.controller && room.controller.owner) {
        intel.owner = room.controller.owner.username;
        intel.rcl = room.controller.level;
        intel.ticksToDowngrade = room.controller.ticksToDowngrade;

        let total = intel.ticksToDowngrade;
        for (let i = 1; i < intel.rcl; i++) {
            total += CONTROLLER_DOWNGRADE[i];
        }
        intel.ticksToNeutral = total;
    }

    intel.reservation = {
        username: null,
        ticksToEnd: 0,
    };
    if (room.controller && room.controller.reservation) {
        intel.reservation = room.controller.reservation;
    }

    // Check sources.
    var sources = this.find(FIND_SOURCES);
    intel.sources = [];
    intel.sourcePos = [];
    for (let i in sources) {
        intel.sources.push({
            x: sources[i].pos.x,
            y: sources[i].pos.y,
            id: sources[i].id,
        });
    }

    // Check minerals.
    delete intel.mineral;
    delete intel.mineralType;
    var minerals = this.find(FIND_MINERALS);
    for (let i in minerals) {
        intel.mineral = minerals[i].id;
        intel.mineralType = minerals[i].mineralType;
    }

    // Check structures.
    intel.structures = {};
    var structures = room.find(FIND_STRUCTURES);
    for (let i in structures) {
        let structure = structures[i];
        let structureType = structure.structureType;

        // Check for power.
        if (structureType == STRUCTURE_POWER_BANK) {
            // For now, send a notification!
            console.log('Power bank found in', room.name);
            //Game.notify('Power bank found in ' + room.name + '!');
        }
        else if (structureType == STRUCTURE_KEEPER_LAIR || structureType == STRUCTURE_CONTROLLER) {
            if (!intel.structures[structureType]) {
                intel.structures[structureType] = {};
            }
            intel.structures[structureType][structure.id] = {
                x: structure.pos.x,
                y: structure.pos.y,
                hits: structure.hits,
                hitsMax: structure.hitsMax,
            };
        }
    }

    // Remember room exits.
    intel.exits = Game.map.describeExits(room.name);

    // At the same time, create a PathFinder CostMatrix to use when pathfinding through this room.
    var costs = room.generateCostMatrix(structures);
    intel.costMatrix = costs.serialize();

    // @todo Check for portals.

    // @todo Check enemy structures.

    // @todo Maybe even have a modified military CostMatrix that can consider moving through enemy structures.

    // Perform normal scan process.
    room.scan();
};

var intelManager = {

    setRoomInaccessible: function (roomName) {
        if (!Memory.rooms[roomName]) {
            Memory.rooms[roomName] = {};
        }
        if (!Memory.rooms[roomName].intel) {
            Memory.rooms[roomName].intel = {};
        }

        var intel = Memory.rooms[roomName].intel;

        intel.lastScan = Game.time;
        intel.inaccessible = true;
    },

    isRoomInaccessible: function (roomName) {
        if (!Memory.rooms[roomName]) {
            return false;
        }
        if (!Memory.rooms[roomName].intel) {
            return false;
        }

        var intel = Memory.rooms[roomName].intel;
        if (_.size(Game.spawns) > 0 && intel.owner && intel.owner != _.sample(Game.spawns).owner.username) {
            return true;
        }

        return intel.inaccessible;
    },

    /**
     * Gathers intel in several possible ways.
     */
    scout: function () {
        // Check all currently visible rooms.
        for (let i in Game.rooms) {
            try {
                Game.rooms[i].gatherIntel();
            }
            catch (e) {
                console.log(e);
                console.log(e.stack);
            }
        }
    },

};

module.exports = intelManager;
