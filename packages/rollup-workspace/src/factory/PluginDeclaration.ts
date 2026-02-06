import type { PluginImpl } from "rollup";

import type { BuildContext } from "./common";
import { createEntity, type Entity } from "./Entity";

export type PluginDeclaration<TName extends string, TConfig extends object> = Entity<TName, TConfig, {
	/** @internal */
	readonly loadPlugin: PluginLoader<TConfig>;

	/** @internal */
	readonly suppressions: Set<string>;

	suppress(
		code: string,
	): PluginDeclaration<TName, TConfig>;
}>;

export interface PluginLoader<TConfig extends object> {
	(context: BuildContext): Promise<PluginImpl<TConfig>>;
}

export type AnyPluginDeclaration = (
	PluginDeclaration<any, any>
);

export function declarePlugin<TName extends string, TConfig extends object>(
	name: TName,
	loadPlugin: PluginLoader<TConfig>,
): PluginDeclaration<TName, TConfig> {
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
