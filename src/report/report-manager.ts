import container from 'utils/container';

declare global {
	interface ReportClasses {}

	type ReportType = keyof ReportClasses;
}

export default class ReportManager {
	currentReport: ReportType;

	setCurrentReport(reportType?: ReportType) {
		this.currentReport = reportType;
	}

	visualizeCurrentReport() {
		if (this.currentReport) {
			// @todo We need to register a list of reports somewhere.
			const report = container.get(this.currentReport);
			report.visualize();
			return;
		}

		const visual = new RoomVisual();

		visual.text('Type `report()` in console to get information...', 1, 48, {
			align: 'left',
		});
	}
}

global['report'] = function(reportType: ReportType = 'HelpReport') {
	container.get('ReportManager').setCurrentReport(reportType);
}
