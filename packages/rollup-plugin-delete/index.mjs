import * as fs from "node:fs/promises";
import * as path from "node:path";

const PLUGIN_NAME = "Delete";

/**
 * @typedef {Object} DeleteTarget
 * @property {string|string[]} include glob pattern(s) of files to include
 * @property {string|string[]} [exclude] glob pattern(s) to exclude (optional)
 * @property {"before"|"after"} [trigger="before"] when to run the operation (defaults to "before")
 */

/**
 * @typedef {Object} DeleteOptions
 * @property {(string|DeleteTarget)|(string|DeleteTarget)[]} targets desired delete operations
 * @property {boolean} [dryRun=false] whether to perform a dry run, only logging actions without executing them (defaults to false)
 * @property {boolean} [runOnce=true] when in watch mode, controls whether to only delete files on the first build (defaults to true)
 */

/**
 * @param {DeleteOptions} options
 */
export default function DeletePlugin(options) {
	const targets = toArray(options?.targets ?? []).map(it => typeof it === "string" ? { include: it } : it);

	const exec = (context, message, block) => {
		if (options?.dryRun) {
			message && context.info({
				plugin: PLUGIN_NAME,
				pluginCode: "DRY_RUN",
				message,
			});

			return;
		}

		return block();
	};

	const execTarget = async (context, cwd, target) => {
		const include = toArray(target.include);
		const globOptions = {
			cwd,
			exclude: toArray(target.exclude ?? []),
			withFileTypes: true,
		};

		const entries = [];
		for (const includePattern of include) {
			for await (const entry of fs.glob(includePattern, globOptions)) {
				entries.push(entry);
			}
		}

		entries.sort(directoriesLast);
		for (const entry of entries) {
			const entryPath = path.join(entry.parentPath, entry.name);
			if (entry.isFile()) {
				await exec(context, `would delete file ${entryPath}`, () => fs.unlink(entryPath));
			}
			else if (entry.isSymbolicLink()) {
				await exec(context, `would delete symlink ${entryPath}`, () => fs.unlink(entryPath));
			}
			else if (entry.isDirectory()) {
				try {
					await exec(context, `would delete directory ${entryPath}`, () => fs.rmdir(entryPath));
				}
				catch (ex) {
					// ignore errors when directory is not empty
					if (ex?.code !== "ENOTEMPTY") {
						throw ex;
					}
				}
			}
		}
	};

	let cwd = undefined;
	let isFirstBeforeRun = true;
	let isFirstAfterRun = true;
	return {
		name: PLUGIN_NAME,
		async buildStart() {
			if (options.runOnce !== false && !isFirstBeforeRun) {
				return;
			}

			isFirstBeforeRun = false;
			cwd = process.cwd();
			for (const target of targets) {
				const { trigger } = target;
				if (trigger === "before" || trigger === undefined) {
					await execTarget(this, cwd, target);
				}
			}
		},
		async closeBundle() {
			if (options.runOnce !== false && !isFirstAfterRun) {
				return;
			}

			isFirstAfterRun = false;
			for (const target of targets) {
				if (target.trigger === "after") {
					await execTarget(this, cwd, target);
				}
			}
		},
	};
}

function toArray(oneOrMore) {
	return Array.isArray(oneOrMore) ? oneOrMore : [ oneOrMore ];
}

function directoriesLast(a, b) {
	// delete files first
	if (a.isDirectory()) {
		if (!b.isDirectory()) {
			return 1;
		}
	}
	else if (b.isDirectory()) {
		return -1;
	}

	// delete directories last, upwards
	return b.parentPath.length - a.parentPath.length;
}
