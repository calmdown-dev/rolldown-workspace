import { exec } from "node:child_process";
import * as Path from "node:path";

const PLUGIN_NAME = "Shell";

/**
 * @typedef {Object} ShellPluginCommand
 * @property {string} run the shell command to execute
 * @property {string} [cwd="./"] the working directory in which to execute the command, relative to the package root (defaults to "./")
 * @property {"before"|"after"|"before-and-after"} [trigger="before"] when to run the operation (defaults to "before")
 * @property {boolean} [once=false] when in watch mode, controls whether to only run this command on the first build (defaults to false)
 */

/**
 * @typedef {Object} ShellPluginOptions
 * @property {ShellPluginCommand|ShellPluginCommand[]} commands list of commands to execute
 */

/**
 * A plugin to run arbitrary shell commands during the build.
 *
 * **WARNING**: The plugin makes no effort to ensure the safety of the commands being executed!  \
 * Please carefully consider the potential consequences of the commands before starting a build.
 * @param {ShellPluginOptions} pluginOptions
 */
export default function ShellPlugin(pluginOptions) {
	const commands = toArray(pluginOptions?.commands ?? []);

	const isWindows = process.platform === "win32";
	const shell = isWindows
		? (process.env.ComSpec || "cmd.exe")
		: (process.env.SHELL || "/bin/bash");

	const execArgv = /[/\\](zsh|bash|sh)$/.test(shell)
		? [ "-i", "-l" ]
		: [];

	const execCommand = async (command, cwd) => new Promise((resolve, reject) => {
		const proc = exec(command.run, {
			shell,
			execArgv,
			cwd: Path.resolve(cwd, command.cwd ?? "./"),
			windowsHide: true,
			encoding: "utf8",
		});

		let output = "";
		proc.stdout.on("data", chunk => { output += chunk });
		proc.stderr.on("data", chunk => { output += chunk });

		proc.once("close", code => {
			if (code === 0) {
				resolve();
			}
			else {
				reject(new Error(`Command exited with code ${code}\n\n$ ${command.run}\n\n${output}`));
			}
		});
	});

	let isFirstBeforeRun = true;
	let isFirstAfterRun = true;
	return {
		name: PLUGIN_NAME,
		buildStart: {
			order: "pre",
			async handler() {
				const cwd = process.cwd();
				for (const command of commands) {
					const { trigger, once } = command;
					if (
						(trigger === "before" || trigger === "before-and-after" || trigger === undefined) &&
						(once !== true || isFirstBeforeRun)
					) {
						await execCommand(command, cwd);
					}
				}

				isFirstBeforeRun = false;
			},
		},
		writeBundle: {
			order: "post",
			async handler() {
				const cwd = process.cwd();
				for (const command of commands) {
					const { trigger, once } = command;
					if (
						(trigger === "after" || trigger === "before-and-after") &&
						(once !== true || isFirstAfterRun)
					) {
						await execCommand(command, cwd);
					}
				}

				isFirstAfterRun = false;
			},
		},
	};
}

function toArray(oneOrMore) {
	return Array.isArray(oneOrMore) ? oneOrMore : [ oneOrMore ];
}
