import type { InputConfig } from "./common";
import { createEntity, type Entity, type NameOf } from "./Entity";
import { createEntityContainer, type EntityContainer, type EntityMap } from "./EntityContainer";
import { defineOutput, type AnyOutputDeclaration, type OutputDefinition } from "./OutputDefinition";
import type { AnyPluginDeclaration } from "./PluginDefinition";

export type PipelineDefinition<
	TName extends string,
	TPlugins extends EntityMap<AnyPluginDeclaration>,
	TOutputs extends EntityMap<AnyOutputDeclaration>,
> = Entity<TName, InputConfig, {
	readonly plugins: TPlugins;
	readonly outputs: TOutputs;

	/** @internal */
	readonly pluginContainer: EntityContainer<AnyPluginDeclaration, TPlugins>;

	/** @internal */
	readonly outputContainer: EntityContainer<AnyOutputDeclaration, TOutputs>;

	/** @internal */
	readonly suppressions: Set<string>;

	plugin<TPlugin extends AnyPluginDeclaration>(
		plugin: TPlugin,
	): PipelineDefinition<TName, TPlugins & { [K in NameOf<TPlugin>]: TPlugin }, TOutputs>;

	output<TOutputName extends string, TOutput extends AnyOutputDeclaration>(
		name: TOutputName,
		block?: (output: OutputDefinition<TOutputName, {}>) => TOutput,
	): PipelineDefinition<TName, TPlugins, TOutputs & { [K in NameOf<TOutput>]: TOutput }>;

	suppress(
		code: string,
	): PipelineDefinition<TName, TPlugins, TOutputs>;
}>;

export type AnyPipelineDeclaration = PipelineDefinition<any, any, any>;

export function definePipeline<TName extends string>(
	name: TName,
): PipelineDefinition<TName, {}, {}> {
	const pluginContainer = createEntityContainer<AnyPluginDeclaration>("Plugin");
	const outputContainer = createEntityContainer<AnyOutputDeclaration>("Output");
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
	this: AnyPipelineDeclaration,
): AnyPipelineDeclaration {
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
	this: AnyPipelineDeclaration,
	plugin: AnyPluginDeclaration,
): AnyPipelineDeclaration {
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
	this: AnyPipelineDeclaration,
	name: string,
	block?: (output: AnyOutputDeclaration) => AnyOutputDeclaration,
): AnyPipelineDeclaration {
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
	this: AnyPipelineDeclaration,
	code: string,
): AnyPipelineDeclaration {
	this.suppressions.add(code);
	return this;
}
