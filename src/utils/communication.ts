import hivemind from 'hivemind';

const swcSegmentId = 90;
const ALLIES = hivemind.relations.allies;
const logIncomingRequests = false;

export const enum RequestType {
	RESOURCE = 0,
	DEFENSE = 1,
	ATTACK = 2,
	EXECUTE = 3,
	HATE = 4,
	FUNNEL = 5,
}
interface ResourceRequest {
	requestType: RequestType.RESOURCE;
	resourceType: ResourceConstant;
	maxAmount?: number;
	roomName: string;
	priority?: number;
	timeout?: number;
}
interface FunnelRequest {
	requestType: RequestType.FUNNEL;
	goalType: number;
	maxAmount?: number;
	roomName: string;
	priority?: number;
	timeout?: number;
}
interface DefenseRequest {
	requestType: RequestType.DEFENSE;
	roomName: string;
	priority?: number;
	timeout?: number;
}
interface HateRequest {
	requestType: RequestType.HATE;
	playerName: string;
	priority?: number;
	timeout?: number;
}
interface AttackRequest {
	requestType: RequestType.ATTACK;
	roomName: string;
	playerName: string;
	priority?: number;
	timeout?: number;
}
export type Request = ResourceRequest | DefenseRequest | HateRequest | AttackRequest | FunnelRequest;
type RequestCallback = (request: Request) => void;

const RequestTypeString = {
	[RequestType.RESOURCE]: 'RESOURCE',
	[RequestType.DEFENSE]: 'DEFENSE',
	[RequestType.ATTACK]: 'ATTACK',
	[RequestType.EXECUTE]: 'EXECUTE',
	[RequestType.HATE]: 'HATE',
	[RequestType.FUNNEL]: 'FUNNEL',
};

let allyRequests: Request[];
let requestArray: Request[] = [];
const simpleAllies = {
	checkAllies(callback: RequestCallback) {
		const allies = [...ALLIES];
		if (allies.length === 0) return;
		const currentAllyName = allies[Game.time % ALLIES.length];

		if (allyRequests === undefined) {
			if (RawMemory.foreignSegment && RawMemory.foreignSegment.username === currentAllyName) {
				try {
					allyRequests = JSON.parse(RawMemory.foreignSegment.data) as Request[];
				}
				catch {
					console.log('failed to parse', currentAllyName, 'request segment');
					allyRequests = null;
				}

				if (allyRequests && _.isArray(allyRequests) && allyRequests.length > 0 && logIncomingRequests) {
					let requestListString = currentAllyName + ':<br/>';
					for (const r of allyRequests) {
						requestListString += RequestTypeString[r.requestType] + ' - ';
						switch (r.requestType) {
							case RequestType.RESOURCE: {
								requestListString += 'resourceType: ' + r.resourceType + ', maxAmount: ' + r.maxAmount + ', room: ' + r.roomName + ', priority: ' + r.priority + '<br/>';
								break;
							}

							case RequestType.DEFENSE: {
								requestListString += 'room: ' + r.roomName + ', priority: ' + r.priority + '<br/>';
								break;
							}

							case RequestType.ATTACK: {
								requestListString += 'room: ' + r.roomName + ', priority: ' + r.priority + ', playerName: ' + r.playerName + '<br/>';
								break;
							}

							case RequestType.HATE: {
								requestListString += 'playerName: ' + r.playerName + ', priority: ' + r.priority + '<br/>';
								// No default
							}

								break;
						}
					}

					console.log(requestListString);
				}
				else if (logIncomingRequests) {
					let requestString = currentAllyName + ':<br/>';
					requestString += RawMemory.foreignSegment.data;
					console.log(requestString);
				}
			}
			else {
				allyRequests = null;
				// Console.log("Simple allies either has no segment or has the wrong name?");
			}
		}

		if (allyRequests) {
			for (const request of allyRequests) {
				callback(request);
			}
		}

		const nextAllyName = allies[(Game.time + 1) % ALLIES.length];
		RawMemory.setActiveForeignSegment(nextAllyName, swcSegmentId);
	},

	// Call before making any requests
	startOfTick() {
		requestArray = [];
		allyRequests = undefined;
	},

	// Call after making all your requests
	endOfTick() {
		if (hivemind.segmentMemory.getSavedSegmentsThisTick() >= 10) return;

		RawMemory.segments[swcSegmentId] = JSON.stringify(requestArray);
		RawMemory.setPublicSegments([swcSegmentId]);
	},

	// Priority is unbounded. It's up to you and your allies to sort out what you want it to mean
	requestHelp(roomName: string, priority?: number) {
		requestArray.push({
			requestType: RequestType.DEFENSE,
			roomName,
			priority: priority || 0,
		});
	},

	requestResource(roomName: string, resourceType: ResourceConstant, priority?: number) {
		requestArray.push({
			requestType: RequestType.RESOURCE,
			resourceType,
			roomName,
			priority: priority || 0,
			maxAmount: 5000,
		});
	},
};

export {simpleAllies};
