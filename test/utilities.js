import test from 'ava';
import _ from 'lodash';

global._ = _;

require('./mock/constants');
const RoomPosition = require('./mock/room-position');

global.RoomPosition = RoomPosition;

/* eslint-disable import/order */
const utilities = require('../src/utilities');
/* eslint-enable import/order */

test.beforeEach(() => {
	global.Memory = {};
});
test.afterEach(() => {
	delete global.Memory;
});

test('encodePosition', t => {
	const pos = new RoomPosition(1, 2, 'E1S1');
	t.true(typeof utilities.encodePosition(pos) === 'string');
});

test('decodePosition', t => {
	const pos = new RoomPosition(1, 2, 'E1S1');
	const encoded = utilities.encodePosition(pos);
	const decoded = utilities.decodePosition(encoded);
	t.deepEqual(pos, decoded);
});

test('getBestOption', t => {
	const options = [
		{weight: 0, priority: 2, id: 'higher'},
		{weight: 5, priority: 1, id: 'lowest'},
	];

	t.is(utilities.getBestOption(options).id, 'higher', 'Higher priority gets chosen even if weight of another option is higher.');
	options.push({weight: 1, priority: 2, id: 'highest'});
	t.is(utilities.getBestOption(options).id, 'highest', 'Within the same priority, higher weight wins.');
});

test('generateCreepBody', t => {
	t.deepEqual(utilities.generateCreepBody({move: 0.5, carry: 0.5}, 100), ['move', 'carry']);
	t.deepEqual(utilities.generateCreepBody({move: 0.5, carry: 0.5}, 200), ['move', 'carry', 'move', 'carry']);
	const limitedBody = utilities.generateCreepBody({move: 0.5, carry: 0.5}, 500, {move: 2});
	t.is(_.filter(limitedBody, part => part === 'move').length, 2);
});

test('serializePositionPath', t => {
	const path = [
		new RoomPosition(1, 2, 'E1N1'),
		new RoomPosition(2, 3, 'E2N1'),
	];
	const encoded = utilities.serializePositionPath(path);
	t.is(encoded.length, 2);
	t.is(typeof encoded[0], 'string');
});

test('deserializePositionPath', t => {
	const path = [
		new RoomPosition(1, 2, 'E1N1'),
		new RoomPosition(2, 3, 'E2N1'),
	];
	const encoded = utilities.serializePositionPath(path);
	const decoded = utilities.deserializePositionPath(encoded);
	t.deepEqual(path, decoded);
});

test('generateEvenSequence', t => {
	const numbers = utilities.generateEvenSequence(3, 2);
	t.deepEqual(numbers, [8, 4, 2, 6, 1, 5, 3, 7]);
});

test('throttle', t => {
	global.Game = {
		cpu: {
			bucket: 5000,
		},
	};
	t.true(utilities.throttle(0, 5000, 8000));
	t.false(utilities.throttle(0, 3000, 5000));
});

test('getThrottleOffset', t => {
	const a = utilities.getThrottleOffset();
	const b = utilities.getThrottleOffset();
	t.is(typeof a, 'number', 'Throttle offsets should be numbers');
	t.not(a, b, 'Subsequent calls should yield different offsets.');
});
