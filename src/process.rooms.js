'use strict';

/* global hivemind PROCESS_PRIORITY_ALWAYS */

const Process = require('./process');
const OwnedRoomProcess = require('./process.rooms.owned');
const RoomIntelProcess = require('./process.rooms.intel');
const RoomPlanner = require('./roomplanner');

const RoomsProcess = function (params, data) {
	Process.call(this, params, data);
};

RoomsProcess.prototype = Object.create(Process.prototype);

RoomsProcess.prototype.run = function () {
	for (const roomName in Game.rooms) {
		const room = Game.rooms[roomName];
		hivemind.runProcess('rooms_intel', RoomIntelProcess, {
			room,
			priority: PROCESS_PRIORITY_ALWAYS,
		});

		// Manage owned rooms.
		// @todo Keep a list of managed rooms in memory so we can notice when
		// a room gets lost or a new one claimed.
		if (room.controller && room.controller.my) {
			// @todo
			hivemind.runProcess('owned_rooms', OwnedRoomProcess, {
				room,
				priority: PROCESS_PRIORITY_ALWAYS,
			});
		}

		// Add roomPlanner to expansion target room.
		if (Memory.strategy && Memory.strategy.expand && Memory.strategy.expand.currentTarget && Memory.strategy.expand.currentTarget.roomName == roomName) {
			room.roomPlanner = new RoomPlanner(roomName);
			room.roomPlanner.runLogic();
		}
	}
};

module.exports = RoomsProcess;
