// Screeps profiler stuff
var useProfiler = false;
var collectStats = false;

var debug = require('debug');

require('manager.mineral');
require('manager.source');
require('pathfinding');
require('role.brawler');
require('role.builder');
require('role.builder.exploit');
require('role.claimer');
require('role.dismantler');
require('role.harvester');
require('role.harvester.exploit');
require('role.harvester.remote');
require('role.hauler');
require('role.hauler.exploit');
require('role.helper');
require('role.scout');
require('role.transporter');
require('role.upgrader');

var RoomPlanner;
try {
    RoomPlanner = require('roomplanner');
}
catch (e) {
    console.log('Error when loading room planner:', e);
    console.log(e.stack);
}

var BoostManager;
try {
    BoostManager = require('manager.boost');
}
catch (e) {
    console.log('Error when loading boost manager:', e);
    console.log(e.stack);
}

var creepGeneral = require('creep.general');
var gameState = require('game.state');
var intelManager = require('manager.intel');
var roleplay = require('manager.roleplay');
var roleRemoteBuilder = require('role.builder.remote');
var spawnManager = require('manager.spawn');
var stats = require('stats');
var structureManager = require('manager.structure');
var utilities = require('utilities');

var Bay = require('manager.bay');
var Exploit = require('manager.exploit');
var Squad = require('manager.squad');

// @todo Decide when it is a good idea to send out harvesters to adjacent unclaimend tiles.
// @todo Add a healer to defender squads, or spawn one when creeps are injured.
// @todo spawn new buildings where reasonable when controller upgrades or stuff gets destroyed.

// @todo Do not send any remote harvesters or claimers until enemies in a room should have expired. Maybe scout from time to time.
// @todo make unarmed creeps run from hostiles.

// @todo Make sure creeps that are supposed to stay in their room do that, go back to their room if exited, and pathfind within the room only.

// @todo add try / catch block to main loops so that one broken routine doesn't stop the whole colony from working.

// @todo Harvest source keeper rooms. Inspiration: E36N34

// @todo Cache building info and CostMatrix objects when scanning rooms in intel manager.

// @todo Buff creeps with mineral compounds when there are labs near a spawn.

// @todo Spawn creeps using "sequences" where more control is needed.

/**
 * Use the new pathfinder to move within a certain range of a target.
 */
Creep.prototype.moveToRange = function (target, range) {
    PathFinder.use(true);
    let pos = target;
    if (target.pos) {
        pos = target.pos;
    }
    this.moveTo({pos: pos, range: range}, {
        maxRooms: 1,
    });
    PathFinder.use(false);
};

var creepThrottleLevels = {
    // Military creeps are always fully active!
    brawler: {
        max: 0,
        min: -1,
    },
    claimer: {
        max: 0,
        min: -1,
    },

    // Some essential creeps only start throttling when things get critical.
    harvester: {
        max: 'critical',
        min: 0,
    },
    'harvester.minerals': {
        max: 'warning',
        min: 0,
    },
    'harvester.remote': {
        max: 'warning',
        min: 'critical',
    },
    'harvester.exploit': {
        max: 'normal',
        min: 0,
    },
    upgrader: {
        max: 'critical',
        min: 0,
    },
    transporter: {
        max: 'normal',
        min: 0,
    },
};

/**
 * Runs a creeps logic depending on role and other factors.
 */
Creep.prototype.runLogic = function() {
    var creep = this;

    if (!this.memory.throttleOffset) this.memory.throttleOffset = utilities.getThrottleOffset();
    let minBucket = null;
    let maxBucket = null;
    if (creepThrottleLevels[this.memory.role]) {
        let min = creepThrottleLevels[this.memory.role].min;
        let max = creepThrottleLevels[this.memory.role].max;

        if (min && Memory.throttleInfo.bucket[min]) {
            minBucket = Memory.throttleInfo.bucket[min];
        }
        else {
            minBucket = min;
        }
        if (max && Memory.throttleInfo.bucket[max]) {
            maxBucket = Memory.throttleInfo.bucket[max];
        }
        else {
            maxBucket = max;
        }
    }

    if (utilities.throttle(this.memory.throttleOffset, minBucket, maxBucket)) {
        if (creep.pos.x == 0 || creep.pos.x == 49 || creep.pos.y == 0 || creep.pos.y == 49) {
            // Do not throttle creeps at room borders, so they don't get stuck between rooms.
        }
        else {
            Game.numThrottledCreeps++;
            return;
        }
    }

    if (this.memory.singleRoom && this.pos.roomName != this.memory.singleRoom) {
        // @todo Keep in room.
    }

    try {
        if (creep.room.boostManager && creep.room.boostManager.overrideCreepLogic(creep)) {
            return;
        }

        if (creep.memory.role == 'harvester') {
            creep.runHarvesterLogic();
        }
        else if (creep.memory.role == 'harvester.minerals') {
            creep.runHarvesterLogic();
        }
        else if (creep.memory.role == 'upgrader') {
            creep.runUpgraderLogic();
        }
        else if (creep.memory.role == 'builder' || creep.memory.role == 'repairer') {
            creep.runBuilderLogic();
        }
        else if (creep.memory.role == 'transporter') {
            creep.runTransporterLogic();
        }
        else if (creep.memory.role == 'harvester.remote') {
            creep.runRemoteHarvesterLogic();
        }
        else if (creep.memory.role == 'harvester.exploit') {
            creep.runExploitHarvesterLogic();
        }
        else if (creep.memory.role == 'claimer') {
            creep.runClaimerLogic();
        }
        else if (creep.memory.role == 'dismantler') {
            creep.runDismantlerLogic();
        }
        else if (creep.memory.role == 'hauler') {
            creep.runHaulerLogic();
        }
        else if (creep.memory.role == 'hauler.exploit') {
            creep.runExploitHaulerLogic();
        }
        else if (creep.memory.role == 'brawler') {
            creep.runBrawlerLogic();
        }
        else if (creep.memory.role == 'builder.remote') {
            roleRemoteBuilder.run(creep);
        }
        else if (creep.memory.role == 'builder.exploit') {
            creep.runExploitBuilderLogic();
        }
        else if (creep.memory.role == 'helper') {
            creep.runHelperLogic();
        }
        else if (creep.memory.role == 'scout') {
            creep.runScoutLogic();
        }
    }
    catch (e) {
        console.log('Error when managing creep', creep.name, ':', e);
        console.log(e.stack);
    }
};

/**
 * Add additional data for each creep.
 */
Creep.prototype.enhanceData = function () {
    let role = this.memory.role;

    // Store creeps by role in global and room data.
    if (!Game.creepsByRole[role]) {
        Game.creepsByRole[role] = {};
    }
    Game.creepsByRole[role][this.name] = this;

    let room = this.room;
    if (!room.creeps) {
        room.creeps = {};
        room.creepsByRole = {};
    }
    room.creeps[this.name] = this;
    if (!room.creepsByRole[role]) {
        room.creepsByRole[role] = {};
    }
    room.creepsByRole[role][this.name] = this;

    // Store creeps that are part of a squad in their respectice squads.
    if (this.memory.squadName) {
        var squad = Game.squads[this.memory.squadName];
        if (squad) {
            if (!squad.units[this.memory.squadUnitType]) {
                squad.units[this.memory.squadUnitType] = [];
            }
            squad.units[this.memory.squadUnitType].push(this);
        }
    }

    // Store creeps that are part of an exploit operation in the correct object.
    if (this.memory.exploitName) {
        if (!Game.exploitTemp[this.memory.exploitName]) {
            Game.exploitTemp[this.memory.exploitName] = [];
        }
        Game.exploitTemp[this.memory.exploitName].push(this.id);
    }
};

/**
 * Adds some additional data to room objects.
 */
Room.prototype.enhanceData = function () {
    this.sources = [];

    // Prepare memory for creep cache (filled globally later).
    if (!this.creeps) {
        this.creeps = {};
        this.creepsByRole = {};
    }

    // Register sources from intelManager.
    if (this.memory.intel) {
        let intel = this.memory.intel;

        if (intel.sources) {
            for (let i in intel.sources) {
                let source = Game.getObjectById(intel.sources[i]);
                this.sources.push(source);
                source.enhanceData();
            }
        }

        if (intel.mineral) {
            let mineral = Game.getObjectById(intel.mineral);
            this.mineral = mineral;
            mineral.enhanceData();
        }
    }

    // Register bays.
    this.bays = {};
    let flags = this.find(FIND_FLAGS, {
        filter: (flag) => flag.name.startsWith('Bay:')
    });
    for (let i in flags) {
        try {
            this.bays[flags[i].name] = new Bay(flags[i].name);
        }
        catch (e) {
            console.log('Error when initializing Bays:', e);
            console.log(e.stack);
        }
    }

    // Register exploits.
    this.exploits = {};
    if (this.controller && this.controller.level >= 7) {
        flags = _.filter(Game.flags, (flag) => flag.name.startsWith('Exploit:' + this.name + ':'));
        for (let i in flags) {
            try {
                this.exploits[flags[i].pos.roomName] = new Exploit(this, flags[i].name);
                Game.exploits[flags[i].pos.roomName] = this.exploits[flags[i].pos.roomName];
            }
            catch (e) {
                console.log('Error when initializing Exploits:', e);
                console.log(e.stack);
            }
        }
    }

    // Initialize boost manager.
    if (BoostManager) {
        this.boostManager = new BoostManager(this.name);
    }
    this.roomPlanner = new RoomPlanner(this.name);
};


if (useProfiler) {
    var profiler = require('screeps-profiler');
    // Enable profiling of all methods in Game object protitypes defined up to now.
    profiler.enable();
}

var main = {

    /**
     * Manages logic for all creeps.
     */
    manageCreeps: function () {
        Game.numThrottledCreeps = 0;
        for (var name in Game.creeps) {
            var creep = Game.creeps[name];

            if (creep.spawning) {
                continue;
            }

            creep.runLogic();
        }
        if (Game.numThrottledCreeps > 0) {
            new Game.logger('creeps').log(Game.numThrottledCreeps, 'of', _.size(Game.creeps), 'creeps have been throttled due to bucket this tick.');
        }
    },

    /**
     * Manages logic for structures.
     */
    manageStructures: function () {
        for (var name in Game.rooms) {
            if (Game.time % 1000 == 337) {
                structureManager.checkRoads(Game.rooms[name]);
            }

            try {
                Game.rooms[name].roomPlanner.runLogic();
            }
            catch (e) {
                console.log('Error when running RoomPlanner:', e);
                console.log(e.stack);
            }
        }
    },

    /**
     * Manages logic for all towers.
     */
    manageTowers: function () {
        // Handle towers.
        var towers = _.filter(Game.structures, function (structure) {
            return (structure.structureType == STRUCTURE_TOWER) && structure.energy > 0;
        });
        for (var i in towers) {
            // @todo Try / catch.
            towers[i].runLogic();
        }
    },

    /**
     * Manages logic for all links.
     */
    manageLinks: function () {
        for (var roomName in Game.rooms) {
            var room = Game.rooms[roomName];

            // Pump energy into upgrade controller link when possible to keep the upgrades flowing.
            if (room.memory.controllerLink) {
                var controllerLink = Game.getObjectById(room.memory.controllerLink);
                if (controllerLink && controllerLink.energy <= controllerLink.energyCapacity * 0.5) {
                    var upgradeControllerSupplied = false;

                    if (room.memory.sources) {
                        for (var id in room.memory.sources) {
                            if (!room.memory.sources[id].targetLink) continue;

                            // We have a link next to a source. Good.
                            var link = Game.getObjectById(room.memory.sources[id].targetLink);
                            if (!link) continue;

                            if (link.energy >= link.energyCapacity * 0.5 && link.cooldown <= 0) {
                                link.transferEnergy(controllerLink);
                                upgradeControllerSupplied = true;
                            }
                        }
                    }

                    if (!upgradeControllerSupplied && room.memory.storageLink) {
                        var storageLink = Game.getObjectById(room.memory.storageLink);
                        if (storageLink) {
                            if (storageLink.energy >= storageLink.energyCapacity * 0.5 && storageLink.cooldown <= 0) {
                                storageLink.transferEnergy(controllerLink);
                                upgradeControllerSupplied = true;
                            }
                        }
                    }
                }
            }
        }
    },

    /**
     * Records when hostiles were last seen in a room.
     */
    checkRoomSecurity: function () {
        for (var roomName in Game.rooms) {
            var room = Game.rooms[roomName];

            var hostiles = room.find(FIND_HOSTILE_CREEPS);
            var parts = {};
            var lastSeen = room.memory.enemies && room.memory.enemies.lastSeen || 0;
            var safe = true;

            if (hostiles.length > 0) {
                // Count body parts for strength estimation.
                for (var j in hostiles) {
                    if (hostiles[j].isDangerous()) {
                        safe = false;
                        lastSeen = Game.time;
                    }
                    for (var k in hostiles[j].body) {
                        let type = hostiles[j].body[k].type;
                        if (!parts[type]) {
                            parts[type] = 0;
                        }
                        parts[type]++;
                    }
                }
            }

            room.memory.enemies = {
                parts: parts,
                lastSeen: lastSeen,
                safe: safe,
            };
        }
    },

    /**
     * Main game loop.
     */
    loop: function () {
        var mainLoop = function () {
            debug.init();
            var logger = new Game.logger('main');

            if (Game.time % 10 == 0 && Game.cpu.bucket < 9800) {
                logger.log('Bucket:', Game.cpu.bucket);
            }

            var time = Game.cpu.getUsed();

            // Clear gameState cache variable, since it seems to persist between Ticks from time to time.
            gameState.clearCache();

            Game.RoomPlanner = RoomPlanner;

            Game.squads = {};
            Game.exploits = {};
            Game.creepsByRole = {};
            Game.exploitTemp = {};

            // Add data to global Game object.
            for (var squadName in Memory.squads) {
                Game.squads[squadName] = new Squad(squadName);
            }

            // Cache creeps per room and role.
            for (let creepName in Game.creeps) {
                let creep = Game.creeps[creepName];
                creep.enhanceData();
            }

            // Add data to room objects.
            for (let roomName in Game.rooms) {
                Game.rooms[roomName].enhanceData();
            }

            // Always place this memory cleaning code at the very top of your main loop!
            for (var name in Memory.creeps) {
                if (!Game.creeps[name]) {
                    //console.log(Memory.creeps[name].role, name, 'has died. :(');
                    delete Memory.creeps[name];
                }
            }

            // Make sure memory structure is available.
            if (!Memory.timers) {
                Memory.timers = {};
            }

            var initCPUUsage = Game.cpu.getUsed() - time;
            time = Game.cpu.getUsed();

            spawnManager.manageSpawns();

            var spawnCPUUsage = Game.cpu.getUsed() - time;
            time = Game.cpu.getUsed();

            main.manageStructures();

            var linksCPUUsage = Game.cpu.getUsed() - time;
            time = Game.cpu.getUsed();

            main.manageCreeps();

            var creepsCPUUsage = Game.cpu.getUsed() - time;
            time = Game.cpu.getUsed();

            main.manageTowers();

            var towersCPUUsage = Game.cpu.getUsed() - time;
            time = Game.cpu.getUsed();

            main.manageLinks();

            var linksCPUUsage = Game.cpu.getUsed() - time;
            time = Game.cpu.getUsed();

            try {
                main.checkRoomSecurity();
            }
            catch (e) {
                console.log('error in manageResources:');
                console.log(e.stack);
            }

            if (Game.time % 10 == 1) {
                try {
                    structureManager.manageResources();
                }
                catch (e) {
                    console.log('error in manageResources:');
                    console.log(e.stack);
                }
            }

            for (let roomName in Game.rooms) {
                try {
                    Game.rooms[roomName].manageLabs();
                }
                catch (e) {
                    console.log('error in manageLabs:');
                    console.log(e.stack);
                }
            }

            try {
                intelManager.scout();
            }
            catch (e) {
                console.log('Error in intelManager.scout:', e);
            }

            try {
                roleplay.roomSongs();
            }
            catch (e) {
                console.log('Error in roomSongs:', e);
            }

            var statsCPUUsage = Game.cpu.getUsed() - time;
            let totalTime = Game.cpu.getUsed();

            if (collectStats) {
                // Grafana stats
                if (Memory.stats == undefined) {
                  Memory.stats = {};
                }

                var rooms = Game.rooms;
                var spawns = Game.spawns;
                var resources = structureManager.getRoomResourceStates();
                for (let roomKey in rooms) {
                    let room = Game.rooms[roomKey];
                    var isMyRoom = (room.controller ? room.controller.my : 0);
                    if (isMyRoom) {
                        Memory.stats['room.' + room.name + '.myRoom'] = 1;
                        Memory.stats['room.' + room.name + '.energyAvailable'] = room.energyAvailable;
                        Memory.stats['room.' + room.name + '.energyCapacityAvailable'] = room.energyCapacityAvailable;
                        Memory.stats['room.' + room.name + '.controllerProgress'] = room.controller.progress;
                        Memory.stats['room.' + room.name + '.controllerProgressTotal'] = room.controller.progressTotal;
                        var stored = 0;
                        var storedTotal = 0;

                        if (room.storage) {
                            stored = room.storage.store[RESOURCE_ENERGY];
                            storedTotal = room.storage.storeCapacity;
                        }
                        else {
                            var storagePosition = room.getStorageLocation();
                            var spot = room.find(FIND_DROPPED_ENERGY, {
                                filter: (resource) => {
                                    if (resource.resourceType == RESOURCE_ENERGY) {
                                        if (storagePosition && resource.pos.x == storagePosition.x && resource.pos.y == storagePosition.y) {
                                            return true;
                                        }
                                    }
                                    return false;
                                }
                            });

                            if (spot.length > 0) {
                                stored = spot[0].amount;
                            }
                            else {
                                stored = 0;
                            }
                            storedTotal = 0;
                        }

                        if (room.terminal) {
                            stored += room.terminal.store[RESOURCE_ENERGY];
                            storedTotal += room.terminal.storeCapacity;
                        }

                        Memory.stats['room.' + room.name + '.storedEnergy'] = stored;

                        // Log all resources.
                        if (resources[room.name]) {
                            for (var resourceType in resources[room.name].totalResources) {
                                Memory.stats['room.' + room.name + '.resources.' + resourceType] = resources[room.name].totalResources[resourceType];
                            }
                        }

                        // Log spawn activity.
                        let roomSpawns = _.filter(spawns, (spawn) => spawn.room.name == room.name);
                        for (let spawnKey in roomSpawns) {
                            let spawn = roomSpawns[spawnKey];
                            Memory.stats['room.' + room.name + '.spawns.' + spawn.name + '.spawning'] = spawn.spawning && 1 || 0;
                        }

                        // Log remote harvest revenue.
                        var harvestMemory = room.memory.remoteHarvesting;
                        if (harvestMemory) {
                            for (var target in harvestMemory) {
                                if (Game.time % 10000 == 0) {
                                    stats.clearRemoteHarvestStats(room.name, target);
                                }

                                var harvestFlags = _.filter(Game.flags, (flag) => {
                                    if (flag.name.startsWith('HarvestRemote') && utilities.encodePosition(flag.pos) == target) {
                                        if (flag.name.startsWith('HarvestRemote:')) {
                                            let parts = flag.name.split(':');
                                            if (parts[1] && parts[1] != room.name) {
                                                return false;
                                            }
                                        }
                                        return true;
                                    }
                                    return false;
                                });

                                if (harvestFlags.length > 0) {
                                    Memory.stats['room.' + room.name + '.remoteHarvesting.' + target + '.revenue'] = harvestMemory[target].revenue;
                                    Memory.stats['room.' + room.name + '.remoteHarvesting.' + target + '.creepCost'] = -harvestMemory[target].creepCost;
                                    Memory.stats['room.' + room.name + '.remoteHarvesting.' + target + '.buildCost'] = -harvestMemory[target].buildCost;
                                    Memory.stats['room.' + room.name + '.remoteHarvesting.' + target + '.defenseCost'] = -harvestMemory[target].defenseCost;
                                    // Total does not include buildCost, because we get that "for free" from the remote energy source.
                                    Memory.stats['room.' + room.name + '.remoteHarvesting.' + target + '.total'] = harvestMemory[target].revenue - harvestMemory[target].creepCost - harvestMemory[target].defenseCost;
                                }
                            }
                        }
                    }
                    else {
                        Memory.stats['room.' + room.name + '.myRoom'] = undefined;
                    }
                }
                Memory.stats['gcl.progress'] = Game.gcl.progress;
                Memory.stats['gcl.progressTotal'] = Game.gcl.progressTotal;
                Memory.stats['gcl.level'] = Game.gcl.level;
                for (let spawnKey in spawns) {
                    let spawn = spawns[spawnKey];
                    Memory.stats['spawn.' + spawn.name + '.defenderIndex'] = spawn.memory['defenderIndex'];
                }
                let creepCounts = {};
                for (let role in Game.creepsByRole) {
                    Memory.stats['creeps.count.' + role] = _.size(Game.creepsByRole[role]);
                }
            }
            else {
                Memory.stats = {};
            }

            Memory.stats['cpu.CreepManagers'] = spawnCPUUsage;
            Memory.stats['cpu.Towers'] = towersCPUUsage;
            //Memory.stats['cpu.Links'] = linksRunning;
            //Memory.stats['cpu.SetupRoles'] = roleSetup;
            Memory.stats['cpu.Creeps'] = creepsCPUUsage;
            //Memory.stats['cpu.SumProfiling'] = sumOfProfiller;
            Memory.stats['cpu.Start'] = initCPUUsage;
            Memory.stats['cpu.bucket'] = Game.cpu.bucket;
            Memory.stats['cpu.limit'] = Game.cpu.limit;
            Memory.stats['cpu.stats'] = Game.cpu.getUsed() - totalTime;
            Memory.stats['cpu.getUsed'] = Game.cpu.getUsed();

            time = Game.cpu.getUsed();

            if (time > Game.cpu.limit * 1.2) {
                var linePrefix = '                     ';
                new Game.logger('cpu').log('High CPU:', time + '/' + Game.cpu.limit, "\n" + linePrefix + utilities.generateCPUStats());
            }
        };

        if (useProfiler) {
            profiler.wrap(mainLoop);
        }
        else {
            mainLoop();
        }
    }

};

module.exports = main;
