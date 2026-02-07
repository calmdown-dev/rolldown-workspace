import * as path from "node:path";

import { defaultFileSystem } from "~/FileSystem";

import { DiscoverPackageOptions, Package } from "./Package";

export interface DiscoverWorkspaceOptions extends DiscoverPackageOptions {
	/** list of package names to exclude from discovery, defaults to `[ "build-logic" ]` */
	exclude?: string[];

	/** the kinds of dependencies to follow, defaults to: `Runtime, Development, Peer` */
	followDeps?: DependencyKind[];

	/** filters the refs to consider as workspace refs, defaults to: `ref => ref.startsWith("workspace:")` */
	refFilter?: (ref: string) => boolean;
}

export interface DiscoverWorkspaceResult {
	currentPackage: Package | null;
	workspace: Workspace | null;
}

export enum DependencyKind {
	Runtime = "dependencies",
	Development = "devDependencies",
	Peer = "peerDependencies",
	Optional = "optionalDependencies",
}

const DEFAULT_REF_FILTER = (ref: string) => ref.startsWith("workspace:");
const DEFAULT_FOLLOW_DEPS = [
	DependencyKind.Runtime,
	DependencyKind.Development,
	DependencyKind.Peer,
];

export class Workspace {
	private constructor(
		public readonly packages: readonly Package[] = [],
		public readonly workspaceRoot: Package,
	) {}


	public static async discover(options?: DiscoverWorkspaceOptions): Promise<DiscoverWorkspaceResult> {
		const fs = options?.fs ?? await defaultFileSystem();

		// find the root package first
		let currentPackage: Package | null = null;
		let cwd = options?.cwd ? path.resolve(options.cwd) : process.cwd();
		let depth = 0;
		let root;

		while (true) {
			root = await Package.discover({ ...options, cwd, fs });
			if (!root) {
				break;
			}

			currentPackage ??= root;
			if (root.declaration.workspaces) {
				break;
			}

			// we found a package, just not the workspace root one -> continue from its directory to
			// skip directories already searched by Package.discover
			const parentDir = path.join(root?.directory ?? cwd, "..");
			if (parentDir === cwd || ++depth >= 128) {
				break;
			}

			cwd = parentDir;
		}

		if (!root?.declaration.workspaces) {
			return {
				currentPackage,
				workspace: null,
			};
		}

		// discover individual packages
		const exclude = options?.exclude ?? [ "build-logic" ];
		const pending: Promise<void>[] = [];
		const packages = new Set<Package>([ root ]);
		cwd = root.directory;

		for await (const pathHint of fs.glob(root.declaration.workspaces, { cwd })) {
			pending.push(
				(async () => {
					const pkg = await Package.discover({
						...options,
						cwd: path.join(cwd, pathHint),
					});

					if (pkg && !exclude.includes(pkg.declaration.name)) {
						packages.add(pkg);
					}
				})(),
			);
		}

		await Promise.all(pending);

		// build dependency graph
		const refFilter = options?.refFilter ?? DEFAULT_REF_FILTER;
		const followDeps = options?.followDeps ?? DEFAULT_FOLLOW_DEPS;
		packages.forEach(upstream => {
			packages.forEach(downstream => {
				followDeps.forEach(depKind => {
					const ref = upstream.declaration[depKind]?.[downstream.declaration.name];
					if (ref && refFilter(ref)) {
						upstream.downstreamDependencies.push(downstream);
						downstream.upstreamDependents.push(upstream);
					}
				});
			});
		});

		return {
			currentPackage,
			workspace: new Workspace(Array.from(packages), root),
		};
	}
}
