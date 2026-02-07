import type { WriteStream } from "node:tty";

import { buildCommand, formatTime, NoOpReporter, overrideConsole, parseArgs, restoreConsole, StreamReporter } from "~/cli";
import { Env } from "~/factory";
import { Workspace, type DiscoverWorkspaceOptions } from "~/workspace";

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

	/** the output stream to write CLI info to, null completely disables output, defaults to process.stdout */
	stdout?: WriteStream | null;
}

const ENV_MAP: { [K in string]?: Env } = {
	dev: Env.Development,
	development: Env.Development,
	stag: Env.Staging,
	staging: Env.Staging,
	prod: Env.Production,
	production: Env.Production,
};

const BuildCommand = buildCommand()
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
	const reporter = options?.stdout === null
		? NoOpReporter
		: new StreamReporter(options?.stdout ?? process.stdout);

	let isWatching = false;
	let isDebug = false;

	try {
		const cmd = parseArgs(BuildCommand, options?.argv);
		const cwd = options?.cwd ?? process.cwd();
		isWatching = options?.watch ?? cmd.opts.watch;
		isDebug = options?.debug ?? cmd.opts.debug;

		// setup reporter
		reporter.reportStackTraces = isDebug;
		overrideConsole(reporter);

		// detect environment
		let env = options?.env ?? cmd.opts.env;
		if (env === undefined) {
			let tmp;
			tmp ??= process.env.NODE_ENV;
			tmp ??= process.env.BUILD_ENV;
			tmp ??= process.env.ENVIRONMENT;
			env = ENV_MAP[tmp?.toLowerCase() ?? ""] ?? Env.Production;
		}

		// discover the workspace
		const { currentPackage, workspace } = await Workspace.discover({ ...options, cwd });
		let packages;

		// when run in the workspace root, build everything unless it has an override build config
		if (workspace && workspace.workspaceRoot === currentPackage && !currentPackage.buildConfigPath) {
			packages = workspace.packages;
		}
		else if (currentPackage) {
			if (!currentPackage.buildConfigPath) {
				throw new Error(`package '${currentPackage.declaration.name}' has no build config`);
			}

			packages = [ currentPackage ];
		}
		else {
			throw new Error("no package was found");
		}

		const activity = await Dispatcher.run(packages, {
			reporter,
			env,
			isWatching,
			isDebug,
		});

		await activity.completed;
		process.exitCode = 0;
	}
	catch (ex: any) {
		reporter.logError("Error", ex);
		process.exitCode = 1;
	}
	finally {
		let outro = "";
		if (!isWatching) {
			const totalTimeTaken = Date.now() - totalStartTime;
			outro = `done in ${formatTime(totalTimeTaken)}`;
		}

		reporter.finish(outro);
		restoreConsole();
	}
}
