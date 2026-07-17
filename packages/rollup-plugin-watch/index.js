import * as FS from "node:fs/promises";
import * as Path from "node:path";

const PLUGIN_NAME = "Watch";

/**
 * @typedef {Object} WatchPluginOptions
 * @property {string|string[]} paths list of paths or globs (relative to cwd) to add to the watch list
 */

/**
 * A plugin to add extra files to the watch list, triggering rebuilds on changes.
 * @param {WatchPluginOptions} pluginOptions
 */
export default function WatchPlugin(pluginOptions) {
	return {
		name: PLUGIN_NAME,
		buildStart: {
			order: "pre",
			async handler() {
				const cwd = process.cwd();
				const patterns = toArray(pluginOptions?.paths ?? []);

				for await (const path of FS.glob(patterns, { cwd })) {
					const resolved = Path.resolve(cwd, path);
					this.addWatchFile(resolved);
				}
			},
		},
	};
}

function toArray(oneOrMore) {
	return Array.isArray(oneOrMore) ? oneOrMore : [ oneOrMore ];
}
