import * as fs from "node:fs/promises";
import * as path from "node:path";

const PLUGIN_NAME = "Delete";

/**
 * @typedef {Object} DeleteTarget
 * @property {string|string[]} include - Glob pattern(s) of files to include
 * @property {string|string[]} [exclude] - Glob pattern(s) to exclude (optional)
 * @property {"before"|"after"} [trigger="before"] - When to run the operation (defaults to "before")
 */

/**
 * @typedef {Object} DeleteOptions
 * @property {boolean} [dryRun=false] - If true, only logs actions without executing
 * @property {DeleteTarget[]} targets - List of delete operations
 */

/**
 * @param {DeleteOptions} options
 */
export default function DeletePlugin(options) {
	const targets = options?.targets ?? [];

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
				await exec(context, `Would delete file "${entryPath}".`, () => fs.unlink(entryPath));
			}
			else if (entry.isSymbolicLink()) {
				await exec(context, `Would delete symlink "${entryPath}".`, () => fs.unlink(entryPath));
			}
			else if (entry.isDirectory()) {
				try {
					await exec(context, `Would delete directory "${entryPath}".`, () => fs.rmdir(entryPath));
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
	return {
		name: PLUGIN_NAME,
		async buildStart() {
			cwd = process.cwd();
			for (const target of targets) {
				const { trigger } = target;
				if (trigger === "before" || trigger === undefined) {
					await execTarget(this, cwd, target);
				}
			}
		},
		async closeBundle() {
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
