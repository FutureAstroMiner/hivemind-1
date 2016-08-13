var utilities = require('utilities');

var Squad = function(squadName) {
    this.name = squadName;

    if (!Memory.squads[squadName]) {
        Memory.squads[squadName] = {
            composition: {},
            units: {},
            fullySpawned: false,
        };
    }

    this.memory = Memory.squads[squadName];
};

Squad.prototype.addUnit = function (unitType) {
    if (!this.memory.composition[unitType]) {
        this.memory.composition[unitType] = 0;
    }
    if (!this.memory.units[unitType]) {
        this.memory.units[unitType] = [];
    }
    this.memory.composition[unitType]++;

    return this.memory.composition[unitType];
};

Squad.prototype.removeUnit = function (unitType) {
    if (!this.memory.composition[unitType]) {
        return;
    }
    this.memory.composition[unitType]--;

    return this.memory.composition[unitType];
};

Squad.prototype.registerCreeps = function () {
    var squadCreeps = _.filter(Game.creeps, (creep) => creep.memory.squadName == this.name);
    for (var unitType in this.memory.composition) {
        this.memory.units[unitType] = [];
        for (var i in squadCreeps) {
            var creep = squadCreeps[i];
            if (creep.memory.squadUnitType == unitType) {
                this.memory.units[unitType].push(creep.id);
            }
        }
    }
};

Squad.prototype.needsSpawning = function () {
    // @todo Call registerCreeps somewhere globally whenever it makes sense.
    this.registerCreeps();
    for (var unitType in this.memory.composition) {
        if (this.memory.composition[unitType] > this.memory.units[unitType].length) {
            return unitType;
        }
    }

    this.memory.fullySpawned = true;
    return null;
};

Squad.prototype.spawnUnit = function (spawn) {
    var toSpawn = this.needsSpawning();

    if (!toSpawn) return false;

    if (toSpawn == 'ranger') {
        spawn.createManagedCreep({
            role: 'brawler',
            bodyWeights: {move: 0.4, tough: 0.1, ranged_attack: 0.25, heal: 0.25},
            memory: {
                squadName: this.name,
                squadUnitType: toSpawn,
            },
        });
    }
    else if (toSpawn == 'healer') {
        spawn.createManagedCreep({
            role: 'brawler',
            bodyWeights: {move: 0.52, tough: 0.1, heal: 0.38},
            memory: {
                squadName: this.name,
                squadUnitType: toSpawn,
            },
        });
    }
    else if (toSpawn == 'claimer') {
        spawn.createManagedCreep({
            role: 'brawler',
            bodyWeights: {move: 0.52, tough: 0.18, claim: 0.3},
            memory: {
                squadName: this.name,
                squadUnitType: toSpawn,
            },
        });
    }
    else if (toSpawn == 'singleClaim') {
        spawn.createManagedCreep({
            role: 'brawler',
            body: [MOVE, CLAIM],
            memory: {
                squadName: this.name,
                squadUnitType: toSpawn,
            },
        });
    }
    else if (toSpawn == 'builder') {
        spawn.createManagedCreep({
            role: 'brawler',
            bodyWeights: {move: 0.52, carry: 0.38, work: 0.1},
            memory: {
                squadName: this.name,
                squadUnitType: toSpawn,
            },
        });
    }
    else if (toSpawn == 'test') {
        spawn.createManagedCreep({
            role: 'brawler',
            body: [MOVE],
            memory: {
                squadName: this.name,
                squadUnitType: toSpawn,
            },
        });
    }
    else {
        spawn.createManagedCreep({
            role: 'brawler',
            bodyWeights: {move: 0.4, tough: 0.3, attack: 0.2, heal: 0.1},
            memory: {
                squadName: this.name,
                squadUnitType: toSpawn,
            },
        });
    }

    return true;
};

Squad.prototype.getOrders = function () {
    var options = [];

    if (this.memory.fullySpawned) {
        // Check if there is an attack flag for this squad.
        var attackFlags = _.filter(Game.flags, (flag) => flag.name.startsWith('AttackSquad:' + this.name));
        if (attackFlags.length > 0) {
            options.push({
                priority: 5,
                weight: 0,
                target: utilities.encodePosition(attackFlags[0].pos),
            });
        }
    }

    return options;
};

Squad.prototype.setPath = function (pathName) {
    this.memory.pathName = pathName;

    // @todo If there are creeps already spawned, send them on the path.
};

module.exports = Squad;
