import { pathToFileURL } from "node:url";

import { rollup } from "rollup";

import type { BuildContext, BuildTarget, BuildTask } from "~/factory";
import type { FileSystem, Watcher } from "~/types";
import type { Package } from "~/workspace";

export type BuildCall = Omit<BuildContext, "cwd" | "moduleName">;

export type ChangeCallback = () => void;

const EMPTY_SET: ReadonlySet<string> = new Set();
const noop = () => {};

export class Builder {
	private readonly watchers = new Map<string, Watcher>();
	private watchFiles: ReadonlySet<string> = EMPTY_SET;
	private onFileChange: ChangeCallback = noop;
	private isWatching = false;

	public constructor(
		private readonly pkg: Package,
		private readonly fs: FileSystem,
	) {}

	public async build(call: BuildCall, signal?: AbortSignal) {
		const { pkg } = this;
		const { reporter } = call;
		let bundle;

		reporter.packageBuildStarted(pkg);
		try {
			process.chdir(pkg.directory);

			const watchFiles = new Set<string>();
			const targets = await this.getTargets(call);
			for (const target of targets) {
				signal?.throwIfAborted();
				bundle = await rollup(target.input);
				for (const output of target.outputs) {
					signal?.throwIfAborted();
					await bundle.write(output);
				}

				bundle.watchFiles.forEach(it => watchFiles.add(it));

				await bundle.close();
				bundle = undefined;
			}

			reporter.packageBuildSucceeded(pkg);
			this.setWatchFiles(watchFiles);
		}
		catch (ex: any) {
			reporter.packageBuildFailed(pkg);
			reporter.logError(pkg.declaration.name, ex);
			await bundle?.close();
		}
	}

	public startWatching(callback: ChangeCallback) {
		if (this.isWatching) {
			return;
		}

		const { watchers } = this;
		this.watchFiles.forEach(path => {
			const watcher = this.fs.watch(path);
			watcher.on("change", callback);
			watchers.set(path, watcher);
		});

		this.onFileChange = callback;
		this.isWatching = true;
	}

	public stopWatching() {
		if (!this.isWatching) {
			return;
		}

		this.watchers.values().forEach(watcher => watcher.close());
		this.watchers.clear();
		this.watchFiles = EMPTY_SET;
		this.onFileChange = noop;
		this.isWatching = false;
	}

	private setWatchFiles(nextWatchFiles: ReadonlySet<string>) {
		if (!this.isWatching) {
			this.watchFiles = nextWatchFiles;
			return;
		}

		const { watchers } = this;
		const prevWatchFiles = this.watchFiles;

		// watchers to close
		prevWatchFiles.difference(nextWatchFiles).forEach(path => {
			const watcher = watchers.get(path);
			if (watchers.delete(path)) {
				watcher!.close();
			}
		});

		// watchers to open
		nextWatchFiles.difference(prevWatchFiles).forEach(path => {
			const watcher = this.fs.watch(path);
			watcher.on("change", this.onFileChange);
			watchers.set(path, watcher);
		});

		this.watchFiles = nextWatchFiles;
	}

	private async getTargets(call: BuildCall) {
		const { pkg } = this;
		let targets = Builder.targets.get(pkg);
		if (targets) {
			return targets;
		}

		const tasks: BuildTask[] = [];
		if (pkg.buildConfigPath) {
			try {
				Builder.currentTasks = tasks;

				const url = pathToFileURL(pkg.buildConfigPath).href;
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

	private static readonly targets = new WeakMap<Package, readonly BuildTarget[]>();
	private static currentTasks: BuildTask[] | null = null;

	/** @internal */
	public static addBuildTask(task: BuildTask) {
		if (!Builder.currentTasks) {
			throw new Error("build configs must be loaded via the build API");
		}

		Builder.currentTasks.push(task);
	}
}
