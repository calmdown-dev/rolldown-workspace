import type { Reporter } from "~/cli";
import type { Package } from "~/workspace";

import { activity, type Activity } from "./Activity";
import { Builder, type BuildCall, type BuildHandle } from "./Builder";

interface PackageEntry {
	readonly pkg: Package;
	priority: number;
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
		private readonly reporter: Reporter,
		private readonly main: Activity,
	) {}

	private async build() {
		const { main } = this;
		let index = 0;
		try {
			while (index < this.targets.length) {
				main.ensureActive();
				await this.targets[index++].builder.build(main);
			}
		}
		catch {
			while (index < this.targets.length) {
				this.reporter.setStatus(this.targets[index++].builder.pkg, "SKIP");
			}
		}

		return activity.completed;
	}

	private async watch() {
		const { main } = this;
		const watchers: Promise<void>[] = [];
		for (const target of this.targets) {
			main.ensureActive();
			const result = target.builder.watch(
				main,
				handle => this.enqueue(target, handle),
			);

			watchers.push(result.watcher.completed);
			await result.currentBuild.value;
		}

		return activity(async () => {
			await main.completed;
			this.reporter.log("Watch Mode", "stopping watchers...");
			await Promise.allSettled(watchers);
		});
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


	public static async run(
		packages: readonly Package[],
		call: BuildCall,
		main: Activity = activity.untilSignal("SIGTERM", "SIGINT"),
	) {
		// gather package priorities (depth-first), also check for dependency cycles
		const visited = new Map<Package, number>();
		const visiting = new WeakSet<Package>();

		let cycleStart: Package | null = null;
		let cycleInfo = "";

		const visit = (pkg: Package, priority: number) => {
			const prevPriority = visited.get(pkg);
			if (prevPriority !== undefined) {
				if (priority > prevPriority) {
					visited.set(pkg, priority);
				}

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
			visited.set(pkg, priority);

			return true;
		};

		packages.forEach(pkg => visit(pkg, 0));

		// resolve individual targets
		const { reporter } = call;
		const targetEntries: TargetEntry[] = [];
		for (const [ pkg, priority ] of visited.entries()) {
			reporter.addPackage(pkg);

			const targets = await Builder.getTargets(pkg, call);
			if (targets.length === 0) {
				reporter.setStatus(pkg, "SKIP");
				reporter.setMessage(pkg, pkg.buildConfigPath ? "no targets defined" : "no build config");
				continue;
			}

			for (const target of targets) {
				targetEntries.push({
					priority,
					builder: new Builder(pkg, target, reporter),
				});
			}
		}

		targetEntries.sort((a, b) => b.priority - a.priority);

		// start the dispatcher
		const dispatcher = new Dispatcher(targetEntries, reporter, main);
		return (call.isWatching ? dispatcher.watch() : dispatcher.build());
	}
}

function noop() {}
