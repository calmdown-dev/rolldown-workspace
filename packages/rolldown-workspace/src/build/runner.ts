import { buildCommand, formatTime, overrideConsole, parseArgs, Reporter } from "~/cli";
import { Env } from "~/factory";
import { getNodeFileSystem } from "~/FileSystem";
import { Package, Workspace, type DiscoverWorkspaceOptions } from "~/workspace";

import { Dispatcher } from "./Dispatcher";

export interface BuildOptions extends DiscoverWorkspaceOptions {
	/** the CLI arguments without exec path or filename, defaults to: `process.argv.slice(2)` */
	argv?: readonly string[];

	/** the environment to build, overrides CLI args */
	env?: Env;

	/** whether to run in debug mode, overrides CLI args */
	debug?: boolean;

	/** whether to run in watch mode, overrides CLI args */
	watch?: boolean;
}

const ENV_MAP: { [K in string]?: Env } = {
	dev: Env.Development,
	development: Env.Development,
	stag: Env.Staging,
	staging: Env.Staging,
	prod: Env.Production,
	production: Env.Production,
};

const command = buildCommand()
	.opt("env", {
		alias: [ "environment" ],
		flag: "e",
		read: (value: string) => {
			const env = ENV_MAP[value.toLowerCase()];
			if (env === undefined) {
				throw new Error(`'${value}' is not a valid environment name`);
			}

			return env;
		},
	})
	.opt("watch", { flag: "w" })
	.opt("debug", { flag: "d" })
	.build();

export async function build(options?: BuildOptions) {
	const totalStartTime = Date.now();
	const reporter = new Reporter(process.stdout);
	let isWatching = false;
	let isDebug = false;

	try {
		const argv = options?.argv ?? process.argv.slice(2);
		const cwd = options?.cwd ?? process.cwd();
		const cmd = parseArgs(command, argv);
		isWatching = options?.watch ?? cmd.opts.watch;
		isDebug = options?.debug ?? cmd.opts.debug;

		// setup reporter
		overrideConsole(reporter);
		reporter.isDebug = isDebug;

		// detect environment
		let env = options?.env ?? cmd.opts.env;
		if (env === undefined) {
			let tmp;
			tmp ??= process.env.BUILD_ENV;
			tmp ??= process.env.NODE_ENV;
			tmp ??= process.env.ENVIRONMENT;
			env = ENV_MAP[tmp?.toLowerCase() ?? ""] ?? Env.Production;
		}

		// get file system API
		const fs = options?.fs ?? (await getNodeFileSystem());

		// discover package we started in
		const startPackage = await Package.discover({ ...options, cwd, fs });
		if (!startPackage) {
			throw new Error(`no package found at: ${cwd}`);
		}

		// discover the whole workspace, if any
		const workspace = await Workspace.discover({ ...options, cwd, fs });
		let packages;

		// when run in the workspace root, build everything unless it has an override build config
		if (workspace && workspace.workspaceRoot === startPackage && !startPackage.buildConfigPath) {
			packages = workspace.packages;
		}
		else {
			if (!startPackage.buildConfigPath) {
				throw new Error(`package '${startPackage.declaration.name}' has no build config`);
			}

			packages = [ startPackage ];
		}

		// build!
		await Dispatcher.run(packages, {
			reporter,
			env,
			isWatching,
			isDebug,
		});
	}
	catch (ex: any) {
		reporter.logError("Error", ex);
	}
	finally {
		reporter.finish();
		reporter.println();

		if (!isWatching) {
			const totalTimeTaken = Date.now() - totalStartTime;
			reporter.println(`done in ${formatTime(totalTimeTaken)}`);
		}
	}
}
