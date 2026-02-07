import type { LogLevel as RolldownLogLevel } from "rolldown";

import type { Package } from "~/workspace";

export type LogLevel = RolldownLogLevel | "error";

export type StatusKind =
	| "FAIL"
	| "BUSY"
	| "IDLE"
	| "PASS"
	| "SKIP";

export interface Reporter {
	reportStackTraces: boolean;

	log(title: string, message: string, level?: LogLevel): void;
	logError(title: string, ex: Error): void;
	addPackage(pkg: Package): void;
	setStatus(pkg: Package, status: StatusKind): void;
	setMessage(pkg: Package, message: string): void;
	packageBuildStarted(pkg: Package): void;
	packageBuildSucceeded(pkg: Package): void;
	packageBuildFailed(pkg: Package): void;
	finish(outro?: string): void;
}
