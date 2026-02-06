import { createEntity, type Entity, type NameOf } from "./Entity";
import { createEntityContainer, type EntityContainer, type EntityMap } from "./EntityContainer";
import { declareOutput, type AnyOutputDeclaration, type OutputConfig, type OutputDeclaration } from "./OutputDeclaration";
import type { AnyPluginDeclaration } from "./PluginDeclaration";

export type PipelineDeclaration<
	TName extends string,
	TConfig extends OutputConfig,
	TPlugins extends EntityMap<AnyPluginDeclaration>,
	TOutputs extends EntityMap<AnyOutputDeclaration>,
> = Entity<TName, TConfig, {
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
	): PipelineDeclaration<TName, TConfig, TPlugins & { [K in NameOf<TPlugin>]: TPlugin }, TOutputs>;

	output<TOutputName extends string, TOutput extends AnyOutputDeclaration>(
		name: TOutputName,
		block?: (output: OutputDeclaration<TOutputName, TConfig, {}>) => TOutput,
	): PipelineDeclaration<TName, TConfig, TPlugins, TOutputs & { [K in NameOf<TOutput>]: TOutput }>;

	suppress(
		code: string,
	): PipelineDeclaration<TName, TConfig, TPlugins, TOutputs>;
}>;

export type AnyPipelineDeclaration = (
	PipelineDeclaration<any, any, any, any>
);

export function declarePipeline<TName extends string, TConfig extends OutputConfig>(
	name: TName,
): PipelineDeclaration<TName, TConfig, {}, {}> {
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
		? block(declareOutput(name))
		: declareOutput(name);

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
