import * as Path from "node:path";

import { parse as parseYAML } from "yaml";

import { defaultFileSystem } from "~/FileSystem";

import { isArrayOf, isENOENT, isObject, isString } from "./common";
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

const YAML_PARSE_OPTIONS: Parameters<typeof parseYAML>[2] & {} = {
	stringKeys: true,
};

export class Workspace {
	private constructor(
		public readonly packages: readonly Package[] = [],
		public readonly workspaceRoot: Package,
	) {}


	public static async discover(options?: DiscoverWorkspaceOptions): Promise<DiscoverWorkspaceResult> {
		const fs = options?.fs ?? await defaultFileSystem();

		// find the root package first
		let root: Package | null = null;
		let workspaces: string[] | null = null;
		let currentPackage: Package | null = null;
		let cwd = options?.cwd ? Path.resolve(options.cwd) : process.cwd();
		let depth = 0;

		while (true) {
			const pkg = await Package.discover({ ...options, cwd, fs });
			if (!pkg) {
				break;
			}

			currentPackage ??= pkg;

			// consider packages declaring the "workspaces" field as root
			const decl = pkg.declaration.workspaces;
			const patterns = Array.isArray(decl)
				? decl // NPM, Yarn Berry flavors
				: isObject(decl) && Array.isArray(decl.packages)
					? decl.packages // Yarn Classic flavor
					: null;

			if (isArrayOf(patterns, isString)) {
				root = pkg;
				workspaces = patterns;
				break;
			}

			// look for a "pnpm-workspace.yaml" file in the same directory (PNPM flavor)
			try {
				const yaml = await fs.readFile(Path.join(cwd, "pnpm-workspace.yaml"), "utf8");
				const pnpm = parseYAML(yaml, YAML_PARSE_OPTIONS);
				if (isArrayOf(pnpm.packages, isString)) {
					root = pkg;
					workspaces = pnpm.packages;
					break;
				}
			}
			catch (ex) {
				// ignore ENOENT errors - pnpm-workspace.yaml simply doesn't exist in cwd
				if (!isENOENT(ex)) {
					throw ex;
				}
			}

			// we found a package, just not the workspace root -> continue from its directory to
			// skip directories already searched by Package.discover
			const parentDir = Path.join(pkg.directory, "..");
			if (parentDir === cwd || ++depth >= 128) {
				break;
			}

			cwd = parentDir;
		}

		if (!root) {
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

		for await (const pathHint of fs.glob(workspaces!, { cwd })) {
			pending.push(
				(async () => {
					const pkg = await Package.discover({
						...options,
						cwd: Path.join(cwd, pathHint),
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
				if (upstream === downstream) {
					return;
				}

				const hasRef = followDeps.some(depKind => {
					const ref = upstream.declaration[depKind]?.[downstream.declaration.name];
					return typeof ref === "string" && refFilter(ref);
				});

				if (hasRef) {
					upstream.downstreamDependencies.push(downstream);
					downstream.upstreamDependents.push(upstream);
				}
			});
		});

		return {
			currentPackage,
			workspace: new Workspace(Array.from(packages), root),
		};
	}
}
