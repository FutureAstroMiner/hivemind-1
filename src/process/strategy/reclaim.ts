declare global {
  interface RoomMemory {
    isReclaimableSince: number,
  }
}

import hivemind from 'hivemind';
import Process from 'process/process';

let lastReclaimCleanup = Game.time;

export default class ReclaimProcess extends Process {
  /**
   * Sends builders to destroyed rooms we still have control over.
   */
  run() {
    this.markReclaimableRooms();
    this.cleanReclaimMemory();
  }

  /**
   * Keeps a record of reclaimable rooms.
   */
  markReclaimableRooms() {
    for (const room of Game.myRooms) {
      if (this.needsReclaiming(room)) {
        this.updateReclaimTimer(room);
        continue;
      }

      if (this.hasJustFinishedReclaiming(room)) {
        delete room.memory.isReclaimableSince;
      }
    }
  }

  needsReclaiming(room: Room): boolean {
    if (this.hasSpawn(room)) return false;
    if (this.isExpansionTarget(room)) return false;

    return true;
  }

  hasSpawn(room: Room): boolean {
    return room.find(FIND_MY_STRUCTURES, {
      filter: structure => structure.structureType === STRUCTURE_SPAWN
    }).length > 0;
  }

  isExpansionTarget(room: Room): boolean {
    if (!Memory.strategy) return false;
    if (!Memory.strategy.expand) return false;
    if (!Memory.strategy.expand.currentTarget) return false;

    return room.name === Memory.strategy.expand.currentTarget.roomName;
  }

  updateReclaimTimer(room: Room) {
    if (!room.memory.isReclaimableSince) room.memory.isReclaimableSince = Game.time;

    for (const username in room.enemyCreeps) {
      if (!hivemind.relations.isAlly(username)) {
        room.memory.isReclaimableSince = Game.time;
        break;
      }
    }
  }

  hasJustFinishedReclaiming(room: Room): boolean {
    if (!room.memory.isReclaimableSince) return false;
    if (!room.roomManager) return false;
    if (!room.roomManager.checkWallIntegrity()) return false;

    return true;
  }

  cleanReclaimMemory() {
    if (!hivemind.hasIntervalPassed(1000, lastReclaimCleanup)) return;
    lastReclaimCleanup = Game.time;

    for (const roomName in Memory.rooms || {}) {
      if (Game.rooms[roomName] && Game.rooms[roomName].isMine()) continue;
      if (!Memory.rooms[roomName].isReclaimableSince) continue;

      delete Memory.rooms[roomName].isReclaimableSince;
    }
  }

}
