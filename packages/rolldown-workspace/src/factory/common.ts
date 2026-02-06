import type { InputOptions, OutputOptions } from "rolldown";

import type { Reporter } from "~/cli";

import type { Configurator } from "./Entity";

export type InputConfig = Omit<InputOptions, "cwd" | "input" | "onLog" | "plugins">;
export type OutputConfig = Omit<OutputOptions, "plugins">;

/** @internal */
export interface BuildTask {
	(context: BuildContext): Promise<readonly BuildTarget[]>;
}

/** @internal */
export interface BuildTarget {
	readonly name: string;
	readonly input: InputOptions;
	readonly outputs: OutputOptions[];
}

/** @internal */
export interface LogSuppression {
	readonly code: string;
	readonly plugin?: string;
}

export interface BuildContext {
	readonly reporter: Reporter;
	readonly cwd: string;
	readonly env: Env;
	readonly moduleName: string;
	readonly isWatching: boolean;
	readonly isDebug: boolean;
}

export enum Env {
	Development = "dev",
	Staging = "stag",
	Production = "prod",
}

export function inEnv(...envs: Env[]): Configurator<boolean> {
	return (_, context) => envs.includes(context.env);
}
