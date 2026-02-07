import type { LogLevel, Reporter } from "./Reporter";
import { safeStringifyStruct } from "./stringify";

export function formatTime(timeMs: number): string {
	if (timeMs >= 1_000) {
		return `${(Math.round(timeMs / 100) / 10).toFixed(1)}s`;
	}

	return `${timeMs.toFixed(0)}ms`;
}

const originalTrace = console.trace;
const originalDebug = console.debug;
const originalLog = console.log;
const originalInfo = console.info;
const originalWarn = console.warn;
const originalError = console.error;

export function overrideConsole(reporter: Reporter) {
	const proxy = (level: LogLevel) => (...args: string[]) => {
		const message = args
			.map(arg => typeof arg === "string" ? arg : safeStringifyStruct(arg))
			.join(" ");

		reporter.log("Console", message, level);
	};

	console.trace = proxy("debug");
	console.debug = proxy("debug");
	console.log = proxy("info");
	console.info = proxy("info");
	console.warn = proxy("warn");
	console.error = proxy("error");
}

export function restoreConsole() {
	console.trace = originalTrace;
	console.debug = originalDebug;
	console.log = originalLog;
	console.info = originalInfo;
	console.warn = originalWarn;
	console.error = originalError;
}
