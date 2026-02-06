import { LogLevel, Reporter } from "./Reporter";

function jsonReplacer(_key: string, value: unknown) {
	switch (typeof value) {
		case "bigint":
			return value.toString() + "n";

		case "symbol":
		case "function":
			return undefined;

		default:
			return value;
	}
}

function stringifyConsoleArg(value: unknown) {
	switch (typeof value) {
		case "undefined":
			return "undefined";

		case "object":
			if (value === null) {
				return "null";
			}

			if (value instanceof Error) {
				return value.stack ?? value.toString();
			}

			return JSON.stringify(value, jsonReplacer, 2);

		case "function":
			return "[function]";

		default:
			return (value as string | number | boolean | bigint | symbol ).toString();
	}
}

export function overrideConsole(reporter: Reporter) {
	const proxy = (level: LogLevel) => (...args: string[]) => {
		reporter.log("Console", args.map(stringifyConsoleArg).join(" "), level);
	};

	console.trace = proxy("debug");
	console.debug = proxy("debug");
	console.log = proxy("info");
	console.info = proxy("info");
	console.warn = proxy("warn");
	console.error = proxy("error");
}
