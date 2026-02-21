import * as fs from "node:fs/promises";
import * as path from "node:path";

const PLUGIN_NAME = "Copy";

const SL_IGNORE = "ignore";
const SL_COPY_FILE = "copy-file";
const SL_LINK_ABSOLUTE = "link-absolute";
const SL_LINK_RELATIVE = "link-relative";

const EK_FILE = "file";
const EK_LINK = "link";
const EK_UNKNOWN = "unknown";

/**
 * @typedef {Object} CopySingleTarget
 * @property {string} srcFile path to the file to be copied
 * @property {string} dstFile path to where the file should be copied to
 * @property {string} [baseDir] base directory for relative paths (defaults to current directory)
 * @property {"before"|"after"} [trigger="after"] when to run the operation (defaults to "after")
 */

/**
 * @typedef {Object} CopyManyTarget
 * @property {string} dstDir directory to where files should be copied or linked
 * @property {string|string[]} include glob pattern(s) of files to include
 * @property {string|string[]} [exclude] glob pattern(s) to exclude (optional)
 * @property {string} [baseDir] base directory for relative paths (defaults to current directory)
 * @property {"before"|"after"} [trigger="after"] when to run the operation (defaults to "after")
 */

/**
 * @typedef {Object} CopyPluginOptions
 * @property {(CopySingleTarget | CopyManyTarget)[]} targets desired copy/link operations
 * @property {boolean} [dryRun=false] whether to perform a dry run, only logging actions without executing them (defaults to false)
 * @property {boolean} [runOnce=true] when in watch mode, controls whether to only delete files on the first build (defaults to true)
 * @property {"ignore"|"copy-file"|"link-absolute"|"link-relative"} [symLinks="ignore"] how to handle symlinks (defaults to "ignore")
 */

/**
 * @param {CopyPluginOptions} pluginOptions
 */
export default function CopyPlugin(pluginOptions) {
	const targets = pluginOptions?.targets ?? [];
	const symLinks = [ SL_IGNORE, SL_COPY_FILE, SL_LINK_ABSOLUTE, SL_LINK_RELATIVE ].find(it => pluginOptions?.symLinks === it) ?? SL_IGNORE;

	const exec = (context, message, block) => {
		if (pluginOptions?.dryRun) {
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
		const baseDir = target.baseDir ? path.resolve(cwd, target.baseDir) : cwd;
		const entries = [];
		if (target.srcFile) {
			// single file
			const src = path.resolve(baseDir, target.srcFile);
			const stats = await fs.stat(src);
			entries.push({
				src,
				dst: path.resolve(baseDir, target.dstFile),
				kind: getKind(stats),
			});
		}
		else {
			// many files
			const include = toArray(target.include);
			const globOptions = {
				cwd,
				exclude: toArray(target.exclude ?? []),
				withFileTypes: true,
			};

			const dstDir = path.resolve(baseDir, target.dstDir);
			for (const includePattern of include) {
				for await (const entry of fs.glob(includePattern, globOptions)) {
					entries.push({
						src: path.join(entry.parentPath, entry.name),
						dst: path.join(dstDir, entry.name),
						kind: getKind(entry),
					});
				}
			}
		}

		for (const entry of entries) {
			const dstDir = path.dirname(entry.dst);
			if (entry.kind === EK_FILE) {
				await exec(context, null, () => fs.mkdir(dstDir, { recursive: true }));
				await exec(context, `would copy file ${entry.src} -> ${entry.dst}`, () => fs.copyFile(entry.src, entry.dst));
				context.addWatchFile(entry.src);
			}
			else if (entry.kind === EK_LINK && symLinks !== SL_IGNORE) {
				const linkedPath = await resolveSymLink(entry.src);
				if (!linkedPath) {
					continue;
				}

				await exec(context, null, () => fs.mkdir(dstDir, { recursive: true }));
				switch (symLinks) {
					case SL_COPY_FILE:
						await exec(context, `would copy file ${linkedPath} -> ${entry.dst} resolved from symlink ${entry.src}`, () => fs.copyFile(linkedPath, entry.dst));
						break;

					case SL_LINK_ABSOLUTE:
						await exec(context, `would create symlink ${entry.dst} pointing to ${linkedPath} resolved from symlink ${entry.src}`, () => fs.symlink(linkedPath, entry.dst));
						break;

					case SL_LINK_RELATIVE: {
						const linkTargetPath = path.relative(entry.dst, linkedPath);
						await exec(context, `would create symlink ${entry.dst} pointing to ${linkTargetPath} resolved from symlink ${entry.src}`, () => fs.symlink(linkTargetPath, entry.dst));
						break;
					}
				}

				context.addWatchFile(linkedPath);
			}
		}
	};

	let cwd = undefined;
	let isFirstBeforeRun = true;
	let isFirstAfterRun = true;
	return {
		name: PLUGIN_NAME,
		async buildStart() {
			if (pluginOptions?.runOnce !== false && !isFirstBeforeRun) {
				return;
			}

			isFirstBeforeRun = false;
			cwd = process.cwd();
			for (const target of targets) {
				if (target.trigger === "before") {
					await execTarget(this, cwd, target);
				}
			}
		},
		async closeBundle() {
			if (pluginOptions?.runOnce !== false && !isFirstAfterRun) {
				return;
			}

			isFirstAfterRun = false;
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

function getKind(entry) {
	if (entry.isFile()) {
		return EK_FILE;
	}

	if (entry.isSymbolicLink()) {
		return EK_LINK;
	}

	return EK_UNKNOWN;
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
