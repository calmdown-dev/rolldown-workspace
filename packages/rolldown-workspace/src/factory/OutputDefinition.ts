import type { OutputConfig } from "./common";
import { createEntity, type Entity, type NameOf } from "./Entity";
import { createEntityContainer, type EntityContainer, type EntityMap } from "./EntityContainer";
import type { AnyPluginDefinition } from "./PluginDefinition";

export type OutputDefinition<
	TName extends string,
	TPlugins extends EntityMap<AnyPluginDefinition>,
> = Entity<TName, OutputConfig, {
	readonly plugins: TPlugins;

	/** @internal */
	readonly pluginContainer: EntityContainer<AnyPluginDefinition, TPlugins>;

	plugin<TPlugin extends AnyPluginDefinition>(
		plugin: TPlugin,
	): OutputDefinition<TName, TPlugins & { [K in NameOf<TPlugin>]: TPlugin }>;
}>;

export type AnyOutputDefinition = OutputDefinition<any, any>;

export function defineOutput<TName extends string>(
	name: TName,
): OutputDefinition<TName, {}> {
	const pluginContainer = createEntityContainer<AnyPluginDefinition>("Plugin");
	return createEntity(name, {
		plugins: pluginContainer.entityMap,
		pluginContainer,
		finalize: onFinalize,
		plugin: onPlugin,
	});
}

function onFinalize(
	this: AnyOutputDefinition,
): AnyOutputDefinition {
	const pluginContainer = this.pluginContainer.finalize();
	return {
		...this,
		isFinal: true,
		plugins: pluginContainer.entityMap,
		pluginContainer,
	};
}

function onPlugin(
	this: AnyOutputDefinition,
	plugin: AnyPluginDefinition,
): AnyOutputDefinition {
	if (this.isFinal) {
		this.pluginContainer.add(plugin);
		return this;
	}

	const pluginContainer = this.pluginContainer.add(plugin);
	return {
		...this,
		plugins: pluginContainer.entityMap,
		pluginContainer,
	};
}
