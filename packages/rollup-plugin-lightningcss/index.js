import * as path from "node:path";

import { transform } from "lightningcss";

const PLUGIN_NAME = "LightningCss";

const RE_MODULE = /\.module\.css$/i;

/**
 * @typedef {Object} LightningCssPluginOptions
 * @property {string|string[]} [include] glob pattern(s) of files to include, defaults to `**‍/*.css`
 * @property {string|string[]} [exclude] glob pattern(s) to exclude (optional)
 * @property {Omit<import("lightningcss").TransformOptions, "code" | "filename" | "sourceMap" | "minify">} [lightningcss] custom inline LightningCSS options
 */

/**
 * @param {LightningCssPluginOptions} pluginOptions
 */
export default function LightningCssPlugin(pluginOptions) {
	const lightningCssConfig = {
		...pluginOptions?.lightningcss,
		cssModules: pluginOptions?.lightningcss.cssModules ?? true,
	};

	const chunkMap = new Map();
	const modulesEnabled = Boolean(lightningCssConfig.cssModules);
	let root;

	return {
		name: PLUGIN_NAME,
		buildStart(inputOptions) {
			root = inputOptions.cwd ?? process.cwd();
		},
		transform: {
			filter: {
				id: {
					include: pluginOptions?.include ?? "**/*.css",
					exclude: pluginOptions?.exclude,
				},
			},
			handler(code, moduleId) {
				let chunk = chunkMap.get(moduleId);
				if (chunk) {
					return chunk.transformResult;
				}

				// prepare a buffer with the CSS code
				const codeBuffer = Buffer.from(code, "utf8");

				// Because we don't know the output options yet (there may also be more than one
				// output), we have to pre-transform CSS modules to know the exports ahead of time.
				let jsCode;
				if (modulesEnabled && RE_MODULE.test(moduleId)) {
					const { exports } = transform({
						...lightningCssConfig,
						filename: moduleId,
						code: codeBuffer,
						projectRoot: root,
						minify: false,
						sourceMap: false,
					});

					const classMap = Object
						.keys(exports)
						.reduce((map, key) => (map[key] = exports[key].name, map), {});

					jsCode = `export default ${JSON.stringify(classMap)};`;
				}
				else {
					jsCode = "export {};";
				}

				// cache the current chunk
				chunkMap.set(moduleId, chunk = {
					moduleId,
					code,
					codeBuffer,
					transformResult: {
						moduleType: "js",
						code: jsCode,
					},
				});

				return chunk.transformResult;
			},
		},
		generateBundle(outputOptions, bundleMap) {
			const baseDir = path.resolve(root, outputOptions.dir);
			const baseUrl = outputOptions.sourcemapBaseUrl ? new URL(outputOptions.sourcemapBaseUrl) : null;
			Object
				.values(bundleMap)
				.filter(bundle => bundle.type === "chunk")
				.forEach(bundle => {
					const sourcemapEnabled = outputOptions.sourcemap ?? false;
					const fileName = `${path.parse(bundle.fileName).name}.css`;

					// generate merged CSS chunk
					const chunks = bundle.moduleIds
						.map(moduleId => chunkMap.get(moduleId))
						.filter(Boolean)
						.map(chunk => {
							const result = transform({
								...lightningCssConfig,
								filename: chunk.moduleId,
								code: chunk.codeBuffer,
								projectRoot: root,
								minify: Boolean(outputOptions.minify),
								sourceMap: sourcemapEnabled,
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
							let mappings = null;
							if (sourcemapEnabled) {
								try {
									const sourcemap = JSON.parse(result.map.toString("utf8"));
									if (sourcemap?.version !== 3) {
										throw new Error("expected sourcemap version 3");
									}

									mappings = sourcemap.mappings ?? "";
								}
								catch (ex) {
									this.warn({
										code: "E_SOURCEMAP",
										message: `failed to parse sourcemap, ${ex.message}`,
									});
								}
							}

							return {
								moduleId: chunk.moduleId,
								originalCode: chunk.code,
								transformedCode: result.code.toString("utf8"),
								mappings,
							};
						});

					// merge CSS code
					let code = chunks.map(chunk => chunk.transformedCode).join("\n");

					// merge source mappings if enabled
					if (sourcemapEnabled) {
						const sourcemap = {
							version: 3,
							sources: chunks.map(chunk => normalRelativePath(baseDir, chunk.moduleId)),
							sourcesContent: chunks.map(chunk => chunk.originalCode),
							names: [],
							mappings: chunks
								.map((chunk, sourceIndex) => replaceSourceIndex(chunk.mappings, sourceIndex))
								.join(";"),
						};

						// emit sourcemap chunk
						const sourcemapFileName = `${fileName}.map`;
						this.emitFile({
							type: "prebuilt-chunk",
							fileName: sourcemapFileName,
							code: JSON.stringify(sourcemap),
						});

						code += `\n/*# sourceMappingURL=${baseUrl ? new URL(sourcemapFileName, baseUrl) : sourcemapFileName} */`;
					}

					// emit CSS chunk
					this.emitFile({
						type: "prebuilt-chunk",
						fileName,
						code,
					});
				});

			// reset cache
			chunkMap.clear();
		}
	};
}

function normalRelativePath(from, to) {
	const relative = path.relative(from, to).replace(/\\/g, "/");
	return path.posix.normalize(relative);
}

const VLQ_ENCODE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const VLQ_DECODE = Array.prototype.reduce.call(VLQ_ENCODE, (map, char, id) => (map[char] = id, map), {});

// source index replacer for v3 sourcemap mappings
// assumes a valid v3 mapping, otherwise the result will most likely get mangled
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
