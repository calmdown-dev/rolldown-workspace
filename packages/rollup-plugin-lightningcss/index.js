import * as path from "node:path";

import { transform } from "lightningcss";

const PLUGIN_NAME = "LightningCss";

const RE_MODULE = /\.module\.css$/i;

/**
 * @typedef {Object} LightningCssPluginOptions
 * @property {string|string[]} [include] glob pattern(s) of files to include, defaults to `**‍/*.css`
 * @property {string|string[]} [exclude] glob pattern(s) to exclude (optional)
 * @property {Omit<import("lightningcss").TransformOptions, "code" | "filename">} [lightningcss] custom inline LightningCSS options
 */

/**
 * @param {LightningCssPluginOptions} pluginOptions
 */
export default function LightningCssPlugin(pluginOptions) {
	const chunkMap = new Map();
	const filter = {
		id: {
			include: pluginOptions?.include ?? "**/*.css",
			exclude: pluginOptions?.exclude,
		},
	};

	const lightningCssConfig = {
		...pluginOptions?.lightningcss,
		cssModules: pluginOptions?.lightningcss.cssModules ?? true,
		sourceMap: pluginOptions?.lightningcss.sourceMap ?? true,
		minify: pluginOptions?.lightningcss.minify ?? true,
	};

	const modulesEnabled = !!lightningCssConfig.cssModules;
	const sourcemapEnabled = !!lightningCssConfig.sourceMap;

	let cwd;
	return {
		name: PLUGIN_NAME,
		transform: {
			filter,
			handler(code, moduleId) {
				let chunk = chunkMap.get(moduleId);
				if (chunk) {
					return chunk.js;
				}

				const filename = path.basename(moduleId);
				const isModule = modulesEnabled && RE_MODULE.test(filename);
				const result = transform({
					...lightningCssConfig,
					filename,
					code: Buffer.from(code, "utf8"),
				});

				// forward warnings to Rollup
				for (const warning of result.warnings) {
					this.warn({
						code: warning.type,
						message: warning.message,
						loc: {
							column: warning.loc.column,
							line: warning.loc.line,
							file: warning.loc.filename,
						},
					});
				}

				// get sourcemap if enabled
				let sourcemap = null;
				if (sourcemapEnabled) {
					try {
						sourcemap = JSON.parse(result.map.toString("utf8"));
						if (sourcemap?.version !== 3) {
							throw new Error("expected sourcemap version 3");
						}
					}
					catch (ex) {
						this.warn({
							code: "E_SOURCEMAP",
							message: `failed to parse sourcemap, ${ex.message}`,
						});
					}
				}

				// cache the current chunk
				chunkMap.set(moduleId, chunk = {
					moduleId,
					filename,
					css: {
						transformed: result.code.toString("utf8"),
						sourcemap,
					},
					js: {
						moduleType: "js",
						code: isModule
							? `export default ${JSON.stringify(getClassMap(result.exports))};`
							: "export {};",
					},
				});

				return chunk.js;
			},
		},
		renderStart(_outputOptions, inputOptions) {
			cwd = inputOptions.cwd ?? process.cwd();
		},
		generateBundle(outputOptions, bundleMap) {
			const baseDir = path.resolve(cwd, outputOptions.dir);
			const baseUrl = outputOptions.sourcemapBaseUrl ? new URL(outputOptions.sourcemapBaseUrl) : null;
			Object
				.values(bundleMap)
				.filter(bundle => bundle.type === "chunk")
				.forEach(bundle => {
					// generate merged CSS chunk
					const fileName = `${path.parse(bundle.fileName).name}.css`;
					const chunks = bundle.moduleIds
						.map(moduleId => chunkMap.get(moduleId))
						.filter(Boolean);

					let code = chunks.map(chunk => chunk.css.transformed).join("\n");

					// if enabled, also generate merged sourcemap
					if (outputOptions.sourcemap && sourcemapEnabled) {
						const sourcemap = {
							version: 3,
							sources: chunks.map(chunk => normalizePath(path.relative(baseDir, chunk.moduleId))),
							sourcesContent: chunks.map(() => null),
							names: [],
							mappings: chunks
								.map((chunk, sourceIndex) => replaceSourceIndex(chunk.css.sourcemap.mappings, sourceIndex))
								.join(";"),
						};

						const sourcemapFileName = `${fileName}.map`;
						this.emitFile({
							type: "prebuilt-chunk",
							fileName: sourcemapFileName,
							code: JSON.stringify(sourcemap),
						});

						code += `\n/*# sourceMappingURL=${baseUrl ? new URL(sourcemapFileName, baseUrl) : sourcemapFileName} */`;
					}

					this.emitFile({
						type: "prebuilt-chunk",
						fileName,
						code,
					});
				});

			chunkMap.clear();
		}
	};
}

const VLQ_ENCODE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const VLQ_DECODE = Array.prototype.reduce.call(VLQ_ENCODE, (map, char, id) => (map[char] = id, map), {});

/**
 * quick and dirty source index replacer within a v3 sourcemap string
 * assumes a valid v3 mapping, otherwise the result will likely be mangled
 */
function replaceSourceIndex(mapping, newSourceIndex) {
	const newSourceIndexVLQ = encodeVLQ(newSourceIndex);
	const { length } = mapping;
	let result = "";
	let index = 0;

	const endOfSegmentOrLine = () => {
		const char = mapping[index];
		if (char !== "," && char !== ";") {
			return false;
		}

		result += char;
		index += 1;
		return true;
	};

	const nextValue = () => {
		const anchor = index;
		while (index < length && ((VLQ_DECODE[mapping[index++]] ?? 0) & 0b100000) > 0) ;

		return mapping.slice(anchor, index);
	};

	while (index < length) {
		if (endOfSegmentOrLine()) {
			continue; // empty line
		}

		result += nextValue(); // transpiled column
		if (endOfSegmentOrLine()) {
			continue; // single field segment
		}

		nextValue();
		result += newSourceIndexVLQ; // replaced source index
		result += nextValue(); // original line
		result += nextValue(); // original column

		if (endOfSegmentOrLine()) {
			continue; // four fields segment
		}

		result += nextValue(); // name index
		endOfSegmentOrLine();
	}

	return result;
}

function encodeVLQ(value) {
	let remainder = value < 0 ? ((-value << 1) | 1) : (value << 1); // zig-zag
	let digit;
	let vlq = "";

	do {
		digit = remainder & 0b11111;
		remainder >>>= 5;
		if (remainder > 0) {
			digit |= 0b100000;
		}

		vlq += VLQ_ENCODE[digit];
	}
	while (remainder > 0);

	return vlq;
}

function getClassMap(exports) {
	return Object
		.keys(exports)
		.reduce((map, key) => (map[key] = exports[key].name, map), {});
}

function normalizePath(value) {
	return path.posix.normalize(value.replace(/\\/g, "/"));
}
