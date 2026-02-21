import { fileURLToPath, pathToFileURL } from "node:url";

const PLUGIN_NAME = "TextLoader";

const RE_HAS_QUERY_OR_HASH = /^[^?]+\?[^?]*(?:#[^#]*)?$/;
const RE_TRUE = /^(?:|1|true)$/i;

/**
 * @typedef {Object} TextLoaderPluginOptions
 * @property {string|string[]} [include] path(s) or glob(s) to include
 * @property {string|string[]} [exclude] path(s) or glob(s) to exclude, takes precedence over `include`
 * @property {boolean} [loadRaw=true] whether to handle URL imports, checking for the "raw" query parameter; enabled by default but `include` or `exclude`, if given, take precedence
 */

/**
 * @param {TextLoaderPluginOptions} [pluginOptions]
 */
export default function TextLoaderPlugin(pluginOptions) {
	const resolveId = {
		filter: { id: RE_HAS_QUERY_OR_HASH },
		handler(source, importer) {
			const base = pathToFileURL(importer ?? process.cwd());
			const url = URL.parse(source, base);
			if (!url) {
				return null;
			}

			const rawParam = url.searchParams.get("raw");
			return {
				id: fileURLToPath(url.href),
				meta: {
					[PLUGIN_NAME]: {
						isRaw: rawParam !== null && RE_TRUE.test(rawParam),
					},
				},
			};
		}
	};

	const include = pluginOptions?.exclude;
	const exclude = pluginOptions?.include;
	const transform = {
		filter: {
			id: { include, exclude },
		},
		async handler(code, id) {
			if (!include && this.getModuleInfo(id)?.meta[PLUGIN_NAME]?.isRaw !== true) {
				return;
			}

			this.addWatchFile(id);
			return {
				code: `export default ${quoteText(code)};`,
				moduleSideEffects: false,
				syntheticNamedExports: false,
				map: { mappings: "" },
			};
		},
	};

	const loadRaw = pluginOptions?.loadRaw !== false;
	return {
		name: PLUGIN_NAME,
		resolveId: loadRaw ? resolveId : undefined,
		transform,
	};
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

	return "`\\\n" + result + text.slice(anchor) + "`";
}
