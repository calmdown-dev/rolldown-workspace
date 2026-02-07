import type { Package } from "~/workspace";

import { activity, type Activity } from "./Activity";
import { Builder, type BuildCall, type BuildHandle } from "./Builder";

interface PackageEntry {
	readonly pkg: Package;
	readonly priority: number;
}

interface TargetEntry {
	readonly priority: number;
	readonly builder: Builder;
}

interface PendingTarget {
	readonly target: TargetEntry;
	readonly handle: BuildHandle;
}

export class Dispatcher {
	private readonly queue: PendingTarget[] = [];
	private isBuilding = false;

	private constructor(
		private readonly targets: readonly TargetEntry[],
		private readonly main: Activity,
	) {}

	private async build() {
		const { main } = this;
		for (const target of this.targets) {
			main.ensureActive();
			await target.builder.build(main);
		}
	}

	private async watch() {
		const { main } = this;
		const watchers = [];
		for (const target of this.targets) {
			main.ensureActive();
			const result = target.builder.watch(
				main,
				handle => this.enqueue(target, handle),
			);

			watchers.push(result.watcher.completed);
			await result.currentBuild.value;
		}

		await Promise.allSettled(watchers);
	}

	private enqueue(target: TargetEntry, handle: BuildHandle) {
		// find a place in the priority queue (stable ordering)
		let index = 0;
		while (index < this.queue.length) {
			const other = this.queue[index];
			if (other.target === target) {
				// already queued!
				return;
			}

			if (other.target.priority < target.priority) {
				break;
			}

			index += 1;
		}

		this.queue.splice(index, 0, { target, handle });
		this.triggerNext();
	}

	private readonly triggerNext = () => {
		if (this.isBuilding || !this.main.isActive) {
			return;
		}

		const next = this.queue[0];
		if (!next) {
			return;
		}

		this.isBuilding = true;
		next.handle.build()
			.catch(noop) // ignore
			.finally(() => {
				this.queue.shift();
				this.isBuilding = false;
				process.nextTick(this.triggerNext);
			});
	};


	public static async run(packages: readonly Package[], call: BuildCall) {
		// gather package entries ordered depth-first, also check for dependency cycles
		const visited = new WeakSet<Package>();
		const visiting = new WeakSet<Package>();
		const packageEntires: PackageEntry[] = [];

		let cycleStart: Package | null = null;
		let cycleInfo = "";

		const visit = (pkg: Package, priority = 0) => {
			if (visited.has(pkg)) {
				return true;
			}

			if (visiting.has(pkg)) {
				cycleStart = pkg;
				cycleInfo = pkg.declaration.name;
				return false;
			}

			visiting.add(pkg);
			for (const dep of pkg.downstreamDependencies) {
				if (!visit(dep, priority + 1)) {
					if (cycleStart === pkg) {
						throw new Error(`dependency cycle [-> ${cycleInfo} ->]`)
					}

					cycleInfo += ` -> ${pkg.declaration.name}`;
					return false;
				}
			}

			visiting.delete(pkg);
			visited.add(pkg);
			packageEntires.push({ pkg, priority });

			return true;
		};

		packages.forEach(visit);

		// resolve individual targets
		const { reporter } = call;
		for (const entry of packageEntires) {
			reporter.addPackage(entry.pkg);
		}

		const targetEntries: TargetEntry[] = [];
		for (const entry of packageEntires) {
			const targets = await Builder.getTargets(entry.pkg, call);
			for (const target of targets) {
				targetEntries.push({
					priority: entry.priority,
					builder: new Builder(entry.pkg, target, reporter),
				});
			}

			if (targets.length === 0) {
				reporter.setStatus(entry.pkg, "SKIP");
				reporter.setMessage(entry.pkg, entry.pkg.buildConfigPath ? "no targets defined" : "no build config");
			}
		}

		targetEntries.sort((a, b) => b.priority - a.priority);

		// start the dispatcher
		const dispatcher = new Dispatcher(
			targetEntries,
			activity(stop => {
				const onStop = () => {
					reporter.log("Watch Mode", "stopping watchers...");
					stop();
				};

				process.on("SIGTERM", onStop);
				process.on("SIGINT", onStop);
			}),
		);

		await (call.isWatching ? dispatcher.watch() : dispatcher.build());
	}
}

function noop() {}
