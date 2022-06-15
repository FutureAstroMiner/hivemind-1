import Dispatcher from 'dispatcher/dispatcher';
import FactoryDestination from 'dispatcher/resource-destination/factory';

declare global {
	interface ResourceDestinationTask extends Task {
		resourceType: ResourceConstant;
		amount: number;
	}

	interface ResourceDestinationContext {
		resourceType?: string;
		creep?: Creep;
	}
}

export default class ResourceDestinationDispatcher extends Dispatcher<ResourceDestinationTask, ResourceDestinationContext> {
	constructor(readonly room: Room) {
		super();
		this.addProvider(new FactoryDestination(room));
	}
}
