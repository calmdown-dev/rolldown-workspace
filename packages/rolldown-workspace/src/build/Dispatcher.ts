import { AbortError } from "~/AbortError";
import type { FileSystem } from "~/FileSystem";
import type { Package } from "~/workspace";

import { Builder, type BuildCall } from "./Builder";

interface BuilderEntry {
	readonly pkg: Package;
	readonly priority: number;
	readonly builder: Builder;
	isDirty: boolean;
}

const DEBOUNCE_MS = 100;

export class Dispatcher {
	private readonly controller = new AbortController();
	private readonly queue: BuilderEntry[] = [];
	private isActive = false;

	private constructor(
		private readonly entries: readonly BuilderEntry[],
		private readonly call: BuildCall,
	) {
		const onAbort = () => {
			this.call.reporter.log("Build", "stopping watchers...", "warn");
			this.controller.abort(new AbortError());
		};

		process.on("SIGTERM", onAbort);
		process.on("SIGINT", onAbort);
	}

	private async build() {
		const signal = this.controller.signal;
		signal.throwIfAborted();

		for (const entry of this.entries) {
			await entry.builder.build(this.call, signal);
		}
	}

	private watch() {
		return new Promise<void>(resolve => {
			const signal = this.controller.signal;
			signal.throwIfAborted();
			signal.addEventListener("abort", () => {
				this.entries.forEach(it => it.builder.stopWatching());
				resolve();
			});

			for (const entry of this.entries) {
				entry.builder.startWatching(() => {
					if (entry.isDirty) {
						return;
					}

					entry.isDirty = true;
					setTimeout(this.enqueue, DEBOUNCE_MS, entry);
				});
			}
		});
	}

	private readonly enqueue = (entry: BuilderEntry) => {
		// find a place in the priority queue (stable ordering)
		let index = 0;
		while (index < this.queue.length) {
			const other = this.queue[index];
			if (other === entry) {
				// already queued!
				return;
			}

			if (other.priority < entry.priority) {
				break;
			}

			index += 1;
		}

		this.queue.splice(index, 0, entry);

		// begin build chain, if not already running
		if (!this.isActive) {
			void this.buildNext();
		}
	};

	private readonly buildNext = async () => {
		const signal = this.controller.signal;
		const next = this.queue[0];
		if (!next || signal.aborted) {
			this.isActive = false;
			return;
		}

		this.isActive = true;

		await next.builder.build(this.call, signal);

		this.queue.shift();
		next.isDirty = false;

		await this.buildNext();
	};

	public static async run(
		packages: readonly Package[],
		fs: FileSystem,
		call: BuildCall,
	) {
		// gather entries ordered depth-first, also check for dependency cycles
		const visited = new WeakSet<Package>();
		const visiting = new WeakSet<Package>();
		const entries: BuilderEntry[] = [];

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
			entries.push({
				pkg,
				priority,
				builder: new Builder(pkg, fs),
				isDirty: false,
			});

			return true;
		};

		packages.forEach(visit);
		entries.sort((a, b) => b.priority - a.priority);

		// update reporter
		const { reporter } = call;
		for (const entry of entries) {
			reporter.addPackage(entry.pkg);
		}

		// start dispatching
		const dispatcher = new Dispatcher(entries, call);
		await dispatcher.build();
		if (call.isWatching) {
			await dispatcher.watch();
		}
	}
}
