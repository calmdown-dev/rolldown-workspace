import type { Reporter } from "./Reporter";

export const NoOpReporter: Reporter = {
	reportStackTraces: false,
	log: noop,
	logError: noop,
	addPackage: noop,
	setStatus: noop,
	setMessage: noop,
	packageBuildStarted: noop,
	packageBuildSucceeded: noop,
	packageBuildFailed: noop,
	finish: noop,
};

function noop() {}
