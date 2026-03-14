import type { InputOptions, OutputOptions } from "rolldown";

import type { Reporter } from "~/cli";

export type InputConfig = Omit<InputOptions, "cwd" | "input" | "onLog" | "plugins">;
export type OutputConfig = Omit<OutputOptions, "plugins">;

export interface BuildTarget {
	readonly name: string;
	readonly input: InputOptions;
	readonly outputs: OutputOptions[];
}

/** @internal */
export interface BuildTask {
	(context: BuildContext): Promise<readonly BuildTarget[]>;
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
	readonly isDebugging: boolean;
}

export enum Env {
	Development = "dev",
	Staging = "stag",
	Production = "prod",
}


let currentContext!: BuildContext;

export function setContext(context: BuildContext) {
	currentContext = context;
}


interface UtilityConfigurator {
	(context?: BuildContext): boolean;
	(current: boolean, context: BuildContext): boolean;
}

function utilityConfigurator(block: (context: BuildContext) => boolean): UtilityConfigurator {
	return (arg0: BuildContext | boolean | undefined, arg1?: BuildContext) => {
		const context = typeof arg0 === "boolean" ? arg1! : arg0 ?? currentContext;
		return block(context);
	};
}

export const inDevelopment = utilityConfigurator(context => context.env === Env.Development);
export const inStaging = utilityConfigurator(context => context.env === Env.Staging);
export const inProduction = utilityConfigurator(context => context.env === Env.Production);
export const inWatchMode = utilityConfigurator(context => context.isWatching);
export const inDebugMode = utilityConfigurator(context => context.isDebugging);

export function inEnv(env0: Env, ...more: Env[]): UtilityConfigurator;
export function inEnv(...envs: Env[]) {
	return utilityConfigurator(context => envs.includes(context.env));
}
