import { pathToFileURL } from "node:url";

import { rolldown, watch } from "rolldown";

import type { Reporter } from "~/cli";
import type { BuildContext, BuildTarget, BuildTask } from "~/factory";
import type { Package } from "~/workspace";

import { activity, type Activity } from "./Activity";
import { deferred, type CompletableDeferred, type Deferred } from "./Deferred";

export type BuildCall = Omit<BuildContext, "cwd" | "moduleName">;

export interface BuildHandle {
	build: () => Promise<void>;
}

export interface WatchResult {
	readonly currentBuild: Deferred;
	readonly watcher: Activity;
}

export class Builder {
	/** @internal */
	public constructor(
		public readonly pkg: Package,
		private readonly target: BuildTarget,
		private readonly reporter: Reporter,
	) {}

	public async build(main: Activity) {
		const { pkg, reporter, target } = this;
		let bundle;

		reporter.packageBuildStarted(pkg);
		try {
			process.chdir(pkg.directory);
			bundle = await rolldown({
				...target.input,
				cwd: pkg.directory,
			});

			for (const output of target.outputs) {
				main.ensureActive();
				await bundle.write(output);
			}

			await bundle.close();
			bundle = undefined;

			reporter.packageBuildSucceeded(pkg);
		}
		catch (ex: any) {
			reporter.packageBuildFailed(pkg);
			reporter.logError(pkg.declaration.name, ex);
			await bundle?.close();
			throw ex;
		}
	}

	public watch(main: Activity, onBuildPending: (handle: BuildHandle) => void): WatchResult {
		const { pkg, reporter, target } = this;

		process.chdir(pkg.directory);
		const watchOptions = typeof target.input.watch === "object" ? target.input.watch : null;
		const watcher = watch({
			...target.input,
			cwd: pkg.directory,
			output: target.outputs,
			watch: {
				...watchOptions,
				clearScreen: false,
			},
		});

		let currentBuild: CompletableDeferred | null = deferred();
		watcher.on("restart", () => {
			const suspension = deferred();
			onBuildPending({
				build: () => {
					currentBuild ??= deferred();
					suspension.complete();
					return currentBuild.value;
				},
			});

			return suspension.value;
		});

		watcher.on("event", e => {
			switch (e.code) {
				case "START":
					reporter.packageBuildStarted(pkg);
					process.chdir(pkg.directory);
					return undefined;

				case "BUNDLE_END":
					return e.result.close();

				case "END":
					reporter.packageBuildSucceeded(pkg);
					currentBuild?.complete();
					currentBuild = null;
					return undefined;

				case "ERROR":
					reporter.packageBuildFailed(pkg);
					reporter.logError(pkg.declaration.name, e.error);
					currentBuild?.fail(e.error);
					currentBuild = null;
					return undefined;
			}
		});

		return {
			currentBuild,
			watcher: activity(async () => {
				await main.completed;
				await watcher.close();
			}),
		};
	}


	private static readonly targets = new WeakMap<Package, readonly BuildTarget[]>();
	private static currentTasks: BuildTask[] | null = null;

	/** @internal */
	public static addBuildTask(task: BuildTask) {
		if (!Builder.currentTasks) {
			throw new Error("build configs must be loaded via the build API");
		}

		Builder.currentTasks.push(task);
	}

	public static async getTargets(pkg: Package, call: BuildCall) {
		let targets = Builder.targets.get(pkg);
		if (targets) {
			return targets;
		}

		const tasks: BuildTask[] = [];
		if (pkg.buildConfigPath) {
			try {
				Builder.currentTasks = tasks;

				const url = pathToFileURL(pkg.buildConfigPath).href;
				process.chdir(pkg.directory);
				await import(url);
			}
			finally {
				Builder.currentTasks = null;
			}
		}

		const context: BuildContext = {
			...call,
			cwd: pkg.directory,
			moduleName: pkg.declaration.name,
		};

		targets = (await Promise.all(tasks.map(task => task(context)))).flat(1);
		Builder.targets.set(pkg, targets);
		return targets;
	}
}
