import type { Plugin } from "rolldown";

import type { BuildContext } from "./common";
import { createEntity, type Entity } from "./Entity";

export type PluginDefinition<TName extends string, TConfig extends object> = Entity<TName, TConfig, {
	/** @internal */
	readonly loadPlugin: PluginLoader<TConfig>;

	/** @internal */
	readonly suppressions: Set<string>;

	suppress(
		code: string,
	): PluginDefinition<TName, TConfig>;
}>;

export interface PluginLoader<TConfig extends object> {
	(context: BuildContext): Promise<(config?: TConfig) => Plugin>;
}

export type AnyPluginDeclaration = (
	PluginDefinition<any, any>
);

export function definePlugin<TName extends string, TConfig extends object>(
	name: TName,
	loadPlugin: PluginLoader<TConfig>,
): PluginDefinition<TName, TConfig> {
	return createEntity(name, {
		suppressions: new Set<string>(),
		loadPlugin,
		suppress: onSuppress,
	});
}

function onSuppress(
	this: AnyPluginDeclaration,
	code: string,
): AnyPluginDeclaration {
	this.suppressions.add(code);
	return this;
}
