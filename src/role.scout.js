var utilities = require('utilities');
var intelManager = require('manager.intel');
var strategyManager = require('manager.strategy');

/**
 * Makes this creep move between rooms to gather intel.
 */
Creep.prototype.performScout = function () {
  if (!this.memory.scoutTarget) {
    // Just stand around somewhere.
    let target = new RoomPosition(25, 25, this.pos.roomName);
    if (this.pos.getRangeTo(target) > 3) {
      this.moveToRange(target, 3);
    }
    return true;
  }

  if (typeof this.room.visual !== 'undefined') {
    this.room.visual.text(this.memory.scoutTarget, this.pos);
  }

  if (!this.moveToRoom(this.memory.scoutTarget)) {
    this.chooseScoutTarget();
    return false;
  }

  return true;
};

/**
 * Chooses which of the possible scout target rooms to travel to.
 */
Creep.prototype.chooseScoutTarget = function () {
  this.memory.scoutTarget = null;
  if (!Memory.strategy) {
    return false;
  }
  let memory = Memory.strategy;

  let best = null;
  for (let roomName in memory.roomList) {
    let info = memory.roomList[roomName];
    if (roomName == this.pos.roomName) continue;

    if (info.origin == this.memory.origin && info.scoutPriority > 0) {
      if (!best || best.scoutPriority < info.scoutPriority) {
        // Check distance / path to room.
        let path = this.calculateRoomPath(roomName);

        if (path) {
          best = info;
        }
      }
    }
  }

  if (best) {
    this.memory.scoutTarget = best.roomName;
  }

  if (!this.memory.scoutTarget) {
    this.memory.scoutTarget = this.memory.origin;
  }
};

Room.prototype.calculateRoomPath = function (targetRoom) {
  let roomName = this.name;

  let openList = {};
  let closedList = {};

  openList[roomName] = {
    range: 0,
    dist: Game.map.getRoomLinearDistance(roomName, targetRoom),
    origin: roomName,
    path: [],
  };

  // A* from here to targetRoom.
  // @todo Avoid unsafe rooms.
  let finalPath = null;
  while (_.size(openList) > 0) {
    let minDist = null;
    let nextRoom = null;
    for (let rName in openList) {
      let info = openList[rName];
      if (!minDist || info.range + info.dist < minDist) {
        minDist = info.range + info.dist;
        nextRoom = rName;
      }
    }

    if (!nextRoom) {
      break;
    }

    let info = openList[nextRoom];

    // We're done if we reached targetRoom.
    if (nextRoom == targetRoom) {
      finalPath = info.path;
    }

    // Add unhandled adjacent rooms to open list.
    if (Memory.rooms[nextRoom] && Memory.rooms[nextRoom].intel && Memory.rooms[nextRoom].intel.exits) {
      for (let i in Memory.rooms[nextRoom].intel.exits) {
        let exit = Memory.rooms[nextRoom].intel.exits[i];
        if (openList[exit] || closedList[exit]) continue;

        if (Memory.rooms[exit] && Memory.rooms[exit].intel) {
          let intel = Memory.rooms[exit].intel;
          if (intel.inaccessible) continue;
          if (intel.structures && _.size(intel.structures[STRUCTURE_KEEPER_LAIR]) > 0) continue;

          // Don't send scouts through rooms owned by other players, either.
          if (intel.owner && intel.owner != 'Mirroar') {
              continue;
          }
        }

        let path = [];
        for (let i in info.path) {
          path.push(info.path[i]);
        }
        path.push(exit);

        openList[exit] = {
          range: info.range + 1,
          dist: Game.map.getRoomLinearDistance(exit, targetRoom),
          origin: info.origin,
          path: path,
        };
      }
    }

    delete openList[nextRoom];
    closedList[nextRoom] = true;
  }

  return finalPath;
};

/**
 * Makes a creep behave like a scout.
 */
Creep.prototype.runScoutLogic = function () {
  if (!this.memory.scoutTarget) {
    this.chooseScoutTarget();
  }

  this.performScout();
};
