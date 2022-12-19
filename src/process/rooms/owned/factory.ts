import Process from 'process/process';
import settings from 'settings-manager';

export default class ManageFactoryProcess extends Process {
	room: Room;

	/**
	 * Manages which reactions take place in a room's labs.
	 * @constructor
	 *
	 * @param {object} parameters
	 *   Options on how to run this process.
	 */
	constructor(parameters: RoomProcessParameters) {
		super(parameters);
		this.room = parameters.room;
	}

	/**
	 * Sets appropriate reactions for each room depending on available resources.
	 */
	run() {
		if (!this.room.factory || !this.room.factoryManager) return;
		if (this.room.factory.cooldown > 0) return;

		const jobs = this.room.factoryManager.getJobs();
		let product: FactoryProductConstant;
		for (product in jobs) {
			if (!this.room.factoryManager.hasAllComponents(product)) continue;
			if (!this.room.factoryManager.isRecipeAvailable(product, jobs[product])) continue;

			if (this.room.factory.produce(product as CommodityConstant) === OK && settings.get('notifyFactoryProduction')) Game.notify('Produced ' + product + ' in ' + this.room.name + '.');
		}
	}
}
