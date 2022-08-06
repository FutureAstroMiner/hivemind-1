import Dispatcher from 'dispatcher/dispatcher';
import BayDestination from 'dispatcher/resource-destination/bay';
import FactoryDestination from 'dispatcher/resource-destination/factory';
import LabDestination from 'dispatcher/resource-destination/lab';
import LinkDestination from 'dispatcher/resource-destination/link';
import NukerDestination from 'dispatcher/resource-destination/nuker';
import PowerSpawnDestination from 'dispatcher/resource-destination/power-spawn';
import SpawnDestination from 'dispatcher/resource-destination/spawn';
import TowerDestination from 'dispatcher/resource-destination/tower';

declare global {
	interface ResourceDestinationTask extends Task {
		resourceType: ResourceConstant;
		amount: number;
	}

	interface StructureDestinationTask extends ResourceDestinationTask {
		target: Id<AnyStoreStructure>;
	}

	interface ResourceDestinationContext {
		resourceType?: string;
		creep?: Creep;
	}
}

export default class ResourceDestinationDispatcher extends Dispatcher<ResourceDestinationTask, ResourceDestinationContext> {
	constructor(readonly room: Room) {
		super();
		this.addProvider(new BayDestination(room));
		this.addProvider(new FactoryDestination(room));
		this.addProvider(new LabDestination(room));
		this.addProvider(new LinkDestination(room));
		this.addProvider(new NukerDestination(room));
		this.addProvider(new PowerSpawnDestination(room));
		this.addProvider(new SpawnDestination(room));
		this.addProvider(new TowerDestination(room));
	}
}
