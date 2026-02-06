import * as path from "node:path";

const PLUGIN_NAME = "TextLoader";

/**
 * @typedef {Object} TextLoaderOptions
 * @property {string|string[]} include - Glob pattern(s) of files to include
 * @property {string|string[]} [exclude] - Glob pattern(s) to exclude (optional)
 */

/**
 * @param {TextLoaderOptions} pluginOptions
 */
export default function TextLoaderPlugin(pluginOptions) {
	const include = toArray(pluginOptions.include);
	const exclude = toArray(pluginOptions.exclude ?? []);
	return {
		name: PLUGIN_NAME,
		async transform(code, id) {
			if (!include.some(pattern => path.matchesGlob(id, pattern))) {
				// the import did not match any include pattern
				return null;
			}

			if (exclude.some(pattern => path.matchesGlob(id, pattern))) {
				// the import matched an exclude pattern
				return null;
			}

			return {
				code: `export default ${quoteText(code)};`,
				moduleSideEffects: false,
				syntheticNamedExports: false,
				map: { mappings: "" },
			};
		},
	};
}

function toArray(oneOrMore) {
	return Array.isArray(oneOrMore) ? oneOrMore : [ oneOrMore ];
}

function quoteText(text) {
	const { length } = text;
	let result = "";
	let index = 0;
	let anchor = 0;

	for (; index < length; index += 1) {
		if (text[index] === "`") {
			result += text.slice(anchor, index) + "\\`";
			anchor = index + 1;
		}
	}

	return "`\\" + result + text.slice(anchor) + "`";
}
