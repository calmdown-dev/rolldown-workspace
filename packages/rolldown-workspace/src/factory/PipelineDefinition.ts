import type { InputConfig } from "./common";
import { createEntity, type Entity, type NameOf } from "./Entity";
import { createEntityContainer, type EntityContainer, type EntityMap } from "./EntityContainer";
import { defineOutput, type AnyOutputDefinition, type OutputDefinition } from "./OutputDefinition";
import type { AnyPluginDefinition } from "./PluginDefinition";

export type PipelineDefinition<
	TName extends string,
	TPlugins extends EntityMap<AnyPluginDefinition>,
	TOutputs extends EntityMap<AnyOutputDefinition>,
> = Entity<TName, InputConfig, {
	readonly plugins: TPlugins;
	readonly outputs: TOutputs;

	/** @internal */
	readonly pluginContainer: EntityContainer<AnyPluginDefinition, TPlugins>;

	/** @internal */
	readonly outputContainer: EntityContainer<AnyOutputDefinition, TOutputs>;

	/** @internal */
	readonly suppressions: Set<string>;

	plugin<TPlugin extends AnyPluginDefinition>(
		plugin: TPlugin,
	): PipelineDefinition<TName, TPlugins & { [K in NameOf<TPlugin>]: TPlugin }, TOutputs>;

	output<TOutputName extends string, TOutput extends AnyOutputDefinition>(
		name: TOutputName,
		block?: (output: OutputDefinition<TOutputName, {}>) => TOutput,
	): PipelineDefinition<TName, TPlugins, TOutputs & { [K in NameOf<TOutput>]: TOutput }>;

	suppress(
		code: string,
	): PipelineDefinition<TName, TPlugins, TOutputs>;
}>;

export type AnyPipelineDefinition = PipelineDefinition<any, any, any>;

export function definePipeline<TName extends string>(
	name: TName,
): PipelineDefinition<TName, {}, {}> {
	const pluginContainer = createEntityContainer<AnyPluginDefinition>("Plugin");
	const outputContainer = createEntityContainer<AnyOutputDefinition>("Output");
	return createEntity(name, {
		plugins: pluginContainer.entityMap,
		outputs: outputContainer.entityMap,
		pluginContainer,
		outputContainer,
		suppressions: new Set(),
		finalize: onFinalize,
		plugin: onPlugin,
		output: onOutput,
		suppress: onSuppress,
	});
}

function onFinalize(
	this: AnyPipelineDefinition,
): AnyPipelineDefinition {
	const pluginContainer = this.pluginContainer.finalize();
	const outputContainer = this.outputContainer.finalize();
	return {
		...this,
		isFinal: true,
		plugins: pluginContainer.entityMap,
		pluginContainer,
		outputs: outputContainer.entityMap,
		outputContainer,
	};
}

function onPlugin(
	this: AnyPipelineDefinition,
	plugin: AnyPluginDefinition,
): AnyPipelineDefinition {
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

function onOutput(
	this: AnyPipelineDefinition,
	name: string,
	block?: (output: AnyOutputDefinition) => AnyOutputDefinition,
): AnyPipelineDefinition {
	const output = block
		? block(defineOutput(name))
		: defineOutput(name);

	if (this.isFinal) {
		this.outputContainer.add(output);
		return this;
	}

	const outputContainer = this.outputContainer.add(output);
	return {
		...this,
		outputs: outputContainer.entityMap,
		outputContainer,
	};
}

function onSuppress(
	this: AnyPipelineDefinition,
	code: string,
): AnyPipelineDefinition {
	this.suppressions.add(code);
	return this;
}
