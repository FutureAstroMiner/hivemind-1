'use strict';

var Process = require('process');

var songs = {
  harder: {
    roles: ['harvester', 'harvester.mineral', 'transporter', 'upgrader', 'repairer', 'builder', 'hauler'],
    lines: [
      // 2 x 2 nothing
      'work it', '', 'make it', '', 'do it', '', 'makes us', '', '♪', '♪', '♪', '♬', '♪', '♪', '♪', '♬',
      '', 'harder', '', 'better', '', 'faster', '', 'stronger', '♪', '♪', '♪', '♬', '♪', '♪', '♪', '♬',
      'more than', '', 'hour', '', 'hour', '', 'never', '', '♪', '♪', '♪', '♬', '♪', '♪', '♪', '♬',
      '', 'ever', '', 'after', '', 'work is', '', 'over', '♪', '♪', '♪', '♬', '♪', '♪', '♪', '♬',
      'work it', '', 'make it', '', 'do it', '', 'makes us', '', '♪', '♪', '♪', '♬', '♪', '♪', '♪', '♬',
      '', 'harder', '', 'better', '', 'faster', '', 'stronger', '', '', '', '', '', '', '', '', '',
      'work it', 'harder', 'make it', 'better', 'do it', 'faster', 'makes us', 'stronger', '♪', '♪', '♪', '♬', '♪', '♪', '♪', '♬',
      'more than', 'ever', 'hour', 'after', 'hour', 'work is', 'never', 'over', '♪', '♪', '♪', '♬', '♪', '♪', '♪', '♬',
      'work it', 'harder', 'make it', 'better', 'do it', 'faster', 'makes us', 'stronger', 'more than', 'ever', 'hour', 'after', 'hour', 'work is', 'never', 'over',
      'work it', 'harder', 'make it', 'better', 'do it', 'faster', 'makes us', 'stronger', 'more than', 'ever', 'hour', 'after', 'hour', 'work is', 'never', 'over',
      'work it', 'harder', 'make it', 'better', 'do it', 'faster', 'makes us', 'stronger', 'more than', 'ever', 'hour', 'after', 'hour', 'work is', 'never', 'over',
      'work it', 'harder', 'make it', 'better', 'do it', 'faster', 'makes us', 'stronger', 'more than', 'ever', 'hour', 'after', 'hour', 'work is', 'never', 'over',
      'work it', 'harder', 'make it', 'better', 'do it', 'faster', 'makes us', 'stronger', 'more than', 'ever', 'hour', 'after', 'hour', 'work is', 'never', 'over',
      'work it', 'harder', 'make it', 'better', 'do it', 'faster', 'makes us', 'stronger', 'more than', 'ever', 'hour', 'after', 'hour', 'work is', 'never', 'over',
      // drums
      // drums
      'work it', 'harder', 'make it', 'better', 'do it', 'faster', 'makes us', 'stronger', 'more than', 'ever', 'hour', 'after', 'hour', 'work is', 'never', 'over',
      'work it', 'harder', 'make it', 'better', 'do it', 'faster', 'makes us', 'stronger', 'more than', 'ever', 'hour', 'after', 'hour', 'work is', 'never', 'over',
      'work it', 'harder', 'make it', 'better', 'do it', 'faster', 'makes us', 'stronger', 'more than', 'ever', 'hour', 'after', 'hour', 'work is', 'never', 'over',
      'work it', 'harder', 'make it', 'better', 'do it', 'faster', 'makes us', 'stronger', 'more than', 'ever', 'hour', 'after', 'hour', 'work is', 'never', 'over',
      'work it', 'harder', 'make it', 'better', 'do it', 'faster', 'makes us', 'stronger', 'more than', 'ever', 'hour', 'after', 'hour', 'work is', 'never', 'over',
      'work it', 'harder', '', '', 'do it', 'faster', '', '', 'more than', 'ever', '', '', 'our', 'work is', 'never', 'over',
      'work it', 'harder', 'make it', 'better', 'do it', 'faster', 'makes us', 'stronger', 'more than', 'ever', 'hour', 'after', 'hour', 'work is', 'never', 'over',
    ],
  },
};

var RoomSongsProcess = function (params, data) {
  Process.call(this, params, data);
  this.room = params.room;

  // Initialize memory.
  if (!this.room.memory.roleplay) this.room.memory.roleplay = {};
  if (!this.room.memory.roleplay.roomSong) this.room.memory.roleplay.roomSong = {};
  this.memory = this.room.memory.roleplay.roomSong;
};
RoomSongsProcess.prototype = Object.create(Process.prototype);

RoomSongsProcess.prototype.run = function () {
  // @todo Choose from multiple songs.
  if (!this.memory.name) this.memory.name = 'harder';
  if (!songs[this.memory.name]) return;
  let song = songs[this.memory.name];

  // Increment beat.
  if (!this.memory.currentBeat) this.memory.currentBeat = 0;
  this.memory.currentBeat++;
  if (this.memory.currentBeat >= song.lines.length) this.memory.currentBeat = 0;

  if (!song.lines[this.memory.currentBeat] || song.lines[this.memory.currentBeat] == '') return;

  var creeps = _.filter(room.creeps, (creep) => song.roles.includes(creep.memory.role));
  if (creeps.length <= 0) return;

  var creep = creeps[Math.floor(Math.random() * creeps.length)];
  creep.say(song.lines[this.memory.currentBeat], true);
};

module.exports = RoomSongsProcess;
