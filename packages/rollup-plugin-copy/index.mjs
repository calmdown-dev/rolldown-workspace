import * as fs from "node:fs/promises";
import * as path from "node:path";

const PLUGIN_NAME = "Copy";

const SL_IGNORE = "ignore";
const SL_COPY_FILE = "copy-file";
const SL_LINK_ABSOLUTE = "link-absolute";
const SL_LINK_RELATIVE = "link-relative";

/**
 * @typedef {Object} CopyTarget
 * @property {string} destination - Where files should be copied or linked
 * @property {string} [baseDir] - Base directory for relative paths (optional)
 * @property {string|string[]} include - Glob pattern(s) of files to include
 * @property {string|string[]} [exclude] - Glob pattern(s) to exclude (optional)
 * @property {"before"|"after"} [trigger="after"] - When to run the operation (defaults to "after")
 */

/**
 * @typedef {Object} CopyOptions
 * @property {boolean} [dryRun=false] - If true, only logs actions without executing
 * @property {"ignore"|"copy-file"|"link-absolute"|"link-relative"} [symLinks="ignore"] - How to handle symlinks (defaults to "ignore")
 * @property {CopyTarget[]} targets - List of copy/link operations
 */

/**
 * @param {CopyOptions} options
 */
export default function CopyPlugin(options) {
	const targets = options?.targets ?? [];
	const symLinks = [ SL_IGNORE, SL_COPY_FILE, SL_LINK_ABSOLUTE, SL_LINK_RELATIVE ].find(it => options?.symLinks === it) ?? SL_IGNORE;

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

		const baseDir = target.baseDir ? path.join(cwd, target.baseDir) : null;
		for (const entry of entries) {
			const srcPath = path.join(entry.parentPath, entry.name);
			const dstDir = baseDir
				? path.join(cwd, target.destination, path.relative(baseDir, path.dirname(srcPath)))
				: path.join(cwd, target.destination);

			const dstPath = path.join(dstDir, entry.name);

			if (entry.isFile()) {
				await exec(context, null, () => fs.mkdir(dstDir, { recursive: true }));
				await exec(context, `Would copy file "${srcPath}" to "${dstPath}".`, () => fs.copyFile(srcPath, dstPath));
				context.addWatchFile(srcPath);
			}
			else if (entry.isSymbolicLink() && symLinks !== SL_IGNORE) {
				const linkedPath = await resolveSymLink(srcPath);
				if (!linkedPath) {
					continue;
				}

				await exec(context, null, () => fs.mkdir(dstDir, { recursive: true }));
				switch (symLinks) {
					case SL_COPY_FILE:
						await exec(context, `Would copy file "${linkedPath}" to "${dstPath}" resolved from symlink "${srcPath}".`, () => fs.copyFile(linkedPath, dstPath));
						break;

					case SL_LINK_ABSOLUTE:
						await exec(context, `Would create symlink "${dstPath}" pointing to "${linkedPath}" resolved from symlink "${srcPath}".`, () => fs.symlink(linkedPath, dstPath));
						break;

					case SL_LINK_RELATIVE: {
						const linkTargetPath = path.relative(dstPath, linkedPath);
						await exec(context, `Would create symlink "${dstPath}" pointing to "${linkTargetPath}" resolved from symlink "${srcPath}".`, () => fs.symlink(linkTargetPath, dstPath));
						break;
					}
				}

				context.addWatchFile(linkedPath);
			}
		}
	};

	let cwd = undefined;
	return {
		name: PLUGIN_NAME,
		async buildStart() {
			cwd = process.cwd();
			for (const target of targets) {
				if (target.trigger === "before") {
					await execTarget(this, cwd, target);
				}
			}
		},
		async closeBundle() {
			for (const target of targets) {
				const { trigger } = target;
				if (trigger === "after" || trigger === undefined) {
					await execTarget(this, cwd, target);
				}
			}
		},
	};
}

function toArray(oneOrMore) {
	return Array.isArray(oneOrMore) ? oneOrMore : [ oneOrMore ];
}

async function resolveSymLink(linkPath, maxDepth = 8) {
	const visited = new Set();

	let current = linkPath;
	let depth = 0;
	do {
		const st = await fs.stat(current);
		if (!st.isSymbolicLink()) {
			return current;
		}

		const target = await fs.readlink(current, "utf8");
		visited.add(current);

		current = path.join(path.dirname(current), target);
	}
	while (!visited.has(current) && ++depth < maxDepth);

	// cycle detected or depth exceeded
	return null;
}
