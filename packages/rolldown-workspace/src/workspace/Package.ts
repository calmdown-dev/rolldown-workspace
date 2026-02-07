import * as path from "node:path";

import { defaultFileSystem, type FileSystem } from "~/FileSystem";

export interface PackageDeclaration {
	[key: string]: unknown;
	readonly name: string;
	readonly version?: string;
	readonly workspaces?: readonly string[];
	readonly dependencies?: DependencyMap;
	readonly devDependencies?: DependencyMap;
	readonly peerDependencies?: DependencyMap;
	readonly optionalDependencies?: DependencyMap;
}

export type DependencyMap = { [TName in string]?: string };

export interface DiscoverPackageOptions {
	/** the directory where to start the discovery, defaults to `process.cwd()` */
	cwd?: string;

	/** the file system override to use, defaults to `node:fs/promises` */
	fs?: FileSystem;

	/** sets a "jail" directory to which the discovery algorithm will be constrained, defaults to `undefined` i.e. unconstrained search */
	jail?: string;

	/** glob pattern to match build config filed, defaults to: `build.config.{js,mjs}` */
	buildConfigGlob?: string;
}

export class Package {
	/**
	 * list of downstream workspace dependencies, i.e. other ws packages this one depends on, but not any 3rd-party ones
	 */
	public readonly downstreamDependencies: Package[] = [];

	/**
	 * list of upstream workspace dependents, i.e. other ws packages that depend on this one, but not any 3rd-party ones
	 */
	public readonly upstreamDependents: Package[] = [];

	private constructor(
		/** the absolute path to the base directory of this Package */
		public readonly directory: string,

		/** the raw contents of package.json for this Package */
		public readonly declaration: PackageDeclaration,

		/** path to the build config of this Package, if any */
		public readonly buildConfigPath?: string,
	) {}


	private static readonly cache = new Map<string, Package | null>();

	public static async discover(options?: DiscoverPackageOptions) {
		const fs = options?.fs ?? await defaultFileSystem();
		const visitedDirs: string[] = [];
		let cacheEntry: Package | null = null;

		try {
			// walk up to find the nearest package.json file
			const jail = options?.jail ? path.resolve(options?.jail) : "";
			let declPath!: string;
			let declJson: string | undefined;
			let cwd = options?.cwd ? path.resolve(options.cwd) : process.cwd();
			let depth = 0;

			while (cwd.startsWith(jail) && ++depth < 128) {
				// check cache
				const cachedPackage = Package.cache.get(cwd);
				if (cachedPackage !== undefined) {
					return cachedPackage;
				}

				// attempt to load package.json
				try {
					visitedDirs.push(cwd);
					declPath = path.join(cwd, "./package.json");
					declJson = await fs.readFile(declPath, "utf8");
					break;
				}
				catch (ex) {
					// ignore ENOENT errors - package.json simply doesn't exist in cwd
					if (!isENOENT(ex)) {
						throw ex;
					}
				}

				const parentDir = path.join(cwd, "..");
				if (parentDir === cwd) {
					break;
				}

				cwd = parentDir;
			}

			if (!declJson) {
				return null;
			}

			// parse and validate the declaration
			let declaration: PackageDeclaration;
			try {
				declaration = JSON.parse(declJson);
			}
			catch (ex) {
				throw new Error(`could not parse 'package.json' file at: ${declPath}`, { cause: ex });
			}

			if (!isObject(declaration)) {
				throw new Error(`expected a JSON object in: ${declPath}`);
			}

			if (!isString(declaration.name)) {
				throw new Error(`name must be a string in: ${declPath}`);
			}

			if (declaration.workspaces !== undefined && !isArrayOf(declaration.workspaces, isString)) {
				throw new Error(`workspaces must be an array of strings in: ${declPath}`);
			}

			// look for build config
			const buildConfigGlob = options?.buildConfigGlob ?? "build.config.{js,mjs}";
			const iterator = fs.glob(buildConfigGlob, { cwd });
			let buildConfigPath: string | undefined;
			try {
				for await (const hint of iterator) {
					if (buildConfigPath) {
						throw new Error(`multiple build config files found in: ${cwd}`);
					}

					buildConfigPath = path.join(cwd, hint);
				}
			}
			finally {
				await iterator.return?.();
			}

			return (cacheEntry = new Package(cwd, declaration, buildConfigPath));
		}
		catch (ex) {
			throw ex as Error;
		}
		finally {
			visitedDirs.forEach(dir => {
				Package.cache.set(dir, cacheEntry!);
			});
		}
	}
}

interface NodeError extends Error {
	readonly code?: string;
}

function isENOENT(ex: unknown): ex is NodeError {
	return (ex as NodeError | null)?.code === "ENOENT";
}

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
	return value !== null && typeof value === "object";
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function isArrayOf<T>(value: unknown, guard: (item: unknown) => item is T): value is T[] {
	return Array.isArray(value) && (value.length === 0 || guard(value[0]));
}
