import type { OutputOptions, Plugin } from "rolldown";

import { Builder } from "~/build/Builder";

import { setContext, type BuildContext, type BuildTarget, type InputConfig, type LogSuppression } from "./common";
import { createEntity, type AnyEntity, type Entity, type NameOf } from "./Entity";
import { createEntityContainer, type EntityContainer, type EntityMap } from "./EntityContainer";
import { definePipeline, type AnyPipelineDefinition, type PipelineDefinition } from "./PipelineDefinition";
import type { AnyPluginDefinition } from "./PluginDefinition";

export type TargetDefinition<
	TName extends string,
	TPipelines extends EntityMap<AnyPipelineDefinition>,
> = Entity<TName, InputConfig, {
	readonly pipelines: TPipelines;

	/** @internal */
	readonly entries?: { [K in string]: string };

	/** @internal */
	readonly pipelineContainer: EntityContainer<AnyPipelineDefinition, TPipelines>;

	/** @internal */
	entry(
		unit: string,
		entryPath: string,
	): Target<TName, TPipelines>;

	pipeline<TPipelineName extends string, TPipeline extends AnyPipelineDefinition>(
		name: TPipelineName,
		block: (pipeline: PipelineDefinition<TPipelineName, {}, {}>) => TPipeline,
	): TargetDefinition<TName, TPipelines & { [K in NameOf<TPipeline>]: TPipeline }>;

	build(
		block: (target: Target<TName, TPipelines>, context: BuildContext) => void,
	): void;
}>;

export type AnyTargetDefinition = TargetDefinition<any, any>;

export type Target<
	TName extends string,
	TPipelines extends EntityMap<AnyPipelineDefinition>,
> = Omit<TargetDefinition<TName, TPipelines>, "pipeline" | "override" | "build"> & {
	entry(
		unit: string,
		entryPath: string,
	): Target<TName, TPipelines>;
};

export type AnyTarget = Target<any, any>;

export function defineTarget<TName extends string, TTarget extends AnyTargetDefinition>(
	name: TName,
	block: (target: TargetDefinition<TName, {}>) => TTarget,
): TTarget {
	const pipelineContainer = createEntityContainer<AnyPipelineDefinition>("Pipeline");
	return block(
		createEntity(name, {
			pipelines: pipelineContainer.entityMap,
			pipelineContainer,
			finalize: onFinalize,
			entry: onEntry,
			pipeline: onPipeline,
			build: onBuild,
		}),
	);
}

function onFinalize(
	this: AnyTargetDefinition,
): AnyTargetDefinition {
	const pipelineContainer = this.pipelineContainer.finalize();
	return {
		...this,
		isFinal: true,
		entries: {},
		pipelines: pipelineContainer.entityMap,
		pipelineContainer,
	};
}

function onEntry(
	this: AnyTargetDefinition,
	unit: string,
	entryPath: string,
): AnyTargetDefinition {
	if (!this.isFinal) {
		throw new Error("Cannot add entries to an unfinalized Target.");
	}

	this.entries![unit] = entryPath;
	return this;
}

function onPipeline(
	this: AnyTargetDefinition,
	name: string,
	block: (pipeline: AnyPipelineDefinition) => AnyPipelineDefinition,
): AnyTargetDefinition {
	const pipeline = block(definePipeline(name));
	if (this.isFinal) {
		this.pipelineContainer.add(pipeline);
		return this;
	}

	const pipelineContainer = this.pipelineContainer.add(pipeline);
	return {
		...this,
		pipelines: pipelineContainer.entityMap,
		pipelineContainer,
	};
}

function onBuild(
	this: AnyTargetDefinition,
	block: (target: AnyTarget, context: BuildContext) => void,
): void {
	const target = this.finalize();
	Builder.addBuildTask(async context => {
		setContext(context);
		block(target, context);
		if (!hasEntries(target) || await isDisabled(target, context)) {
			return [];
		}

		const targetConfig = await target.getConfig({}, context);
		return target.pipelineContainer.collect<BuildTarget>(async pipeline => {
			if (await isDisabled(pipeline, context)) {
				return null;
			}

			const suppressions: LogSuppression[] = Array.from(pipeline.suppressions).map(code => ({ code }));
			const pipelineConfig = await pipeline.getConfig(targetConfig, context);
			const pipelinePlugins = await collectPlugins(pipeline.pluginContainer, context, suppressions);
			const pipelineOutputs = await pipeline.outputContainer.collect<OutputOptions>(async output => {
				if (await isDisabled(output, context)) {
					return null;
				}

				const outputConfig = await output.getConfig({}, context);
				const outputPlugins = await collectPlugins(output.pluginContainer, context, suppressions);
				return {
					...outputConfig,
					plugins: outputPlugins,
				};
			});

			if (pipelineOutputs.length === 0) {
				return null;
			}

			return {
				name: `${target.name} · ${pipeline.name}`,
				outputs: pipelineOutputs,
				input: {
					...pipelineConfig,
					input: target.entries,
					plugins: pipelinePlugins,
					onLog(level, log) {
						const isSuppressed = log.pluginCode !== undefined && suppressions.some(it => it.code === log.pluginCode && (!it.plugin || it.plugin === log.plugin));
						if (isSuppressed) {
							return;
						}

						if (level !== "debug" || context.isDebugging) {
							const message = `${log.pluginCode ? `[${log.plugin}:${log.pluginCode}] ` : ""}${log.message}`;
							context.reporter.log(context.moduleName, message, level);
						}
					},
				},
			};
		});
	});
}

function hasEntries(
	target: AnyTargetDefinition,
): boolean {
	return !!target.entries && Object.keys(target.entries).length > 0;
}

async function isDisabled(
	entity: AnyEntity,
	context: BuildContext,
): Promise<boolean> {
	return !(await entity.getEnabled(true, context));
}

function collectPlugins(
	container: EntityContainer<AnyPluginDefinition>,
	context: BuildContext,
	suppressions: LogSuppression[],
): Promise<Plugin[]> {
	return container.collect(async plugin => {
		if (await isDisabled(plugin, context)) {
			return null;
		}

		const pluginConfig = await plugin.getConfig(undefined, context);
		const pluginFactory = await plugin.loadPlugin(context);
		const rolldownPlugin = pluginFactory(pluginConfig);

		plugin.suppressions.forEach(code => suppressions.push({
			code,
			plugin: rolldownPlugin.name,
		}));

		return rolldownPlugin;
	});
}
