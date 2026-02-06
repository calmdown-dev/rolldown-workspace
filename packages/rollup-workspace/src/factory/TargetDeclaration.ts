import type { OutputOptions, Plugin } from "rollup";

import { Builder } from "~/build/Builder";

import type { BuildContext, BuildTarget, LogSuppression } from "./common";
import { createEntity, type AnyEntity, type Entity, type NameOf } from "./Entity";
import { createEntityContainer, type EntityContainer, type EntityMap } from "./EntityContainer";
import type { OutputConfig } from "./OutputDeclaration";
import { declarePipeline, type AnyPipelineDeclaration, type PipelineDeclaration } from "./PipelineDeclaration";
import type { AnyPluginDeclaration } from "./PluginDeclaration";

export type TargetDeclaration<
	TName extends string,
	TConfig extends OutputConfig,
	TPipelines extends EntityMap<AnyPipelineDeclaration>,
> = Entity<TName, TConfig, {
	readonly pipelines: TPipelines;

	/** @internal */
	readonly entries?: { [K in string]: string };

	/** @internal */
	readonly pipelineContainer: EntityContainer<AnyPipelineDeclaration, TPipelines>;

	/** @internal */
	entry(
		unit: string,
		entryPath: string,
	): Target<TName, TConfig, TPipelines>;

	pipeline<TPipelineName extends string, TPipeline extends AnyPipelineDeclaration>(
		name: TPipelineName,
		block: (pipeline: PipelineDeclaration<TPipelineName, TConfig, {}, {}>) => TPipeline,
	): TargetDeclaration<TName, TConfig, TPipelines & { [K in NameOf<TPipeline>]: TPipeline }>;

	build(
		block: (target: Target<TName, TConfig, TPipelines>) => void,
	): void;
}>;

export type Target<
	TName extends string,
	TConfig extends OutputConfig,
	TPipelines extends EntityMap<AnyPipelineDeclaration>,
> = Omit<TargetDeclaration<TName, TConfig, TPipelines>, "pipeline" | "override" | "build"> & {
	entry(
		unit: string,
		entryPath: string,
	): Target<TName, TConfig, TPipelines>;
};

export type AnyTargetDeclaration = (
	TargetDeclaration<any, any, any>
);

export type AnyTarget = (
	Target<any, any, any>
);

export function declareTarget<TName extends string, TTarget extends AnyTargetDeclaration>(
	name: TName,
	block: (target: TargetDeclaration<TName, OutputConfig, {}>) => TTarget,
): TTarget {
	const pipelineContainer = createEntityContainer<AnyPipelineDeclaration>("Pipeline");
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
	this: AnyTargetDeclaration,
): AnyTargetDeclaration {
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
	this: AnyTargetDeclaration,
	unit: string,
	entryPath: string,
): AnyTargetDeclaration {
	if (!this.isFinal) {
		throw new Error("Cannot add entries to an unfinalized Target.");
	}

	this.entries![unit] = entryPath;
	return this;
}

function onPipeline(
	this: AnyTargetDeclaration,
	name: string,
	block: (pipeline: AnyPipelineDeclaration) => AnyPipelineDeclaration,
): AnyTargetDeclaration {
	const pipeline = block(declarePipeline(name));
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

const DEFAULT_CONFIG: OutputOptions = {
	dir: "./dist",
	entryFileNames: "[name].js",
	format: "es",
	sourcemap: true,
};

function onBuild(
	this: AnyTargetDeclaration,
	block: (target: AnyTarget) => void,
): void {
	const target = this.finalize();
	Builder.addBuildTask(async context => {
		block(target);
		if (!hasEntries(target) || await isDisabled(target, context)) {
			return [];
		}

		const targetConfig = await target.getConfig(DEFAULT_CONFIG, context);
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

				const outputConfig = await output.getConfig(pipelineConfig, context);
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
					input: target.entries,
					plugins: pipelinePlugins,
					onLog(level, log) {
						const isSuppressed = log.pluginCode !== undefined && suppressions.some(it => it.code === log.pluginCode && (!it.plugin || it.plugin === log.plugin));
						if (isSuppressed) {
							return;
						}

						if (level !== "debug" || context.isDebug) {
							const message = `${log.pluginCode ? `[${log.pluginCode}]` : ""}${log.message}`;
							context.reporter.log(context.moduleName, message, level);
						}
					},
				},
			};
		});
	});
}

function hasEntries(
	target: AnyTargetDeclaration,
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
	container: EntityContainer<AnyPluginDeclaration>,
	context: BuildContext,
	suppressions: LogSuppression[],
): Promise<Plugin[]> {
	return container.collect(async plugin => {
		if (await isDisabled(plugin, context)) {
			return null;
		}

		const pluginConfig = await plugin.getConfig(undefined, context);
		const pluginFactory = await plugin.loadPlugin(context);
		const rollupPlugin = pluginFactory(pluginConfig);

		plugin.suppressions.forEach(code => suppressions.push({
			code,
			plugin: rollupPlugin.name,
		}));

		return rollupPlugin;
	});
}
