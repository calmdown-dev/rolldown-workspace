import * as path from "node:path";

import { Extractor, ExtractorConfig } from "@microsoft/api-extractor";
import { parseConfigFileTextToJson } from "typescript";

const PLUGIN_NAME = "BundleDts";

/**
 * @typedef {Object} BundleDtsOptions
 * @property {Record<string, string>} entries - Map of output name -> entry .d.ts path (optional)
 * @property {string} baseDir - The base directory of the typescript module aka baseUrl in tsconfig (optional)
 * @property {string} declarationDir - Where to look for .d.ts files (optional)
 * @property {string} [tsconfig="./tsconfig.json"] - Path to tsconfig (defaults to "./tsconfig.json")
 * @property {Object} [compilerOptions] - Custom TypeScript compiler options overrides (optional)
 */

/**
 * @param {BundleDtsOptions} pluginOptions
 */
export default function BundleDtsPlugin(pluginOptions) {
	let cwd = undefined;
	let hasRun = false;
	let entries = [];

	return {
		name: PLUGIN_NAME,
		buildStart(rollupOptions) {
			cwd = process.cwd();
			hasRun = false;
			entries = [];

			if (pluginOptions?.entries) {
				if (pluginOptions.baseDir || pluginOptions.declarationDir) {
					this.warn({
						plugin: PLUGIN_NAME,
						pluginCode: "INVALID_OPTIONS",
						message: "Options `baseDir` and `declarationDir` have no meaning when `entries` map is specified.",
					});
				}

				const entriesMap = pluginOptions?.entries;
				for (const entryId in entriesMap) {
					if (!Object.hasOwn(entriesMap, entryId)) {
						continue;
					}

					entries.push({
						dtsEntryPath: path.join(cwd, getDeclarationPath(entriesMap[entryId])),
						fileName: getDeclarationPath(entryId),
					});
				}
			}
			else {
				if (!pluginOptions.baseDir || !pluginOptions.declarationDir) {
					this.error({
						plugin: PLUGIN_NAME,
						pluginCode: "INVALID_OPTIONS",
						message: "Both `baseDir` and `declarationDir` must be specified.",
					});

					return;
				}

				const baseDir = path.join(cwd, pluginOptions.baseDir);
				const declDir = path.join(cwd, pluginOptions.declarationDir);

				const inputs = getRollupInputs(cwd, baseDir, rollupOptions.input);
				for (const input of inputs) {
					entries.push({
						dtsEntryPath: path.join(declDir, input.dir, `${input.id}.d.ts`),
						fileName: getDeclarationPath(input.id),
					});
				}
			}
		},
		generateBundle() {
			if (hasRun) {
				return;
			}

			for (const entry of entries) {
				entry.assetId = this.emitFile({
					type: "asset",
					fileName: entry.fileName,
					source: "// pending generation\n",
				});
			}
		},
		async writeBundle(outputOptions) {
			if (hasRun) {
				return;
			}

			hasRun = true;

			// load actual tsconfig
			// FUTURE: this doesn't resolve `extends` (!!!)
			const tsconfigPath = path.join(cwd, pluginOptions.tsconfig ?? "./tsconfig.json");
			const tsconfigRaw = await this.fs.readFile(tsconfigPath, "utf8");
			const tsconfigActual = parseConfigFileTextToJson(tsconfigPath, tsconfigRaw);
			if (tsconfigActual.error) {
				throw new Error(`failed to parse tsconfig: ${tsconfigActual.error.messageText}`);
			}

			// fake package info
			const declarationDir = path.join(cwd, pluginOptions.declarationDir);
			const fakePackageJsonPath = path.join(declarationDir, "package.json");
			const fakeTsconfigJsonPath = path.join(declarationDir, "tsconfig.json");
			const packageJson = {
				name: "dts",
			};

			// build a fake config
			const tsconfigOverride = {
				...tsconfigActual.config,
				compilerOptions: {
					...tsconfigActual.config.compilerOptions,
					// override baseUrl to correctly resolve TS' paths mappings
					baseUrl: declarationDir,
					skipLibCheck: true,
					// apply user overrides
					...pluginOptions.compilerOptions,
				},
				exclude: [],
				include: [ "./**/*.d.ts" ],
			};

			for (const entry of entries) {
				const outputPath = path.join(cwd, outputOptions.dir, this.getFileName(entry.assetId));
				const extractorConfig = ExtractorConfig.prepare({
					packageJsonFullPath: fakePackageJsonPath,
					packageJson,
					configObject: {
						mainEntryPointFilePath: entry.dtsEntryPath,
						projectFolder: declarationDir,
						compiler: {
							overrideTsconfig: tsconfigOverride,
							tsconfigFilePath: fakeTsconfigJsonPath,
							skipLibCheck: true,
						},
						dtsRollup: {
							enabled: true,
							omitTrimmingComments: true,
							publicTrimmedFilePath: outputPath,
						},
					},
				});

				const result = Extractor.invoke(extractorConfig, {
					localBuild: true,
					showVerboseMessages: false,
					messageCallback: message => {
						message.handled = true;
						this.warn({
							code: message.messageId,
							message: message.text,
							loc: {
								column: message.sourceFileColumn,
								line: message.sourceFileLine,
								file: message.sourceFilePath,
							},
						});
					},
				});

				if (!result.succeeded) {
					throw new Error(`failed to bundle types for ${entry.dtsEntryPath}`);
				}
			}
		},
	};
}

const RE_TS = /(?<!\.d)\.(tsx?|[mc]ts)$/i;
const EXT_MAP = {
	ts: ".d.ts",
	tsx: ".d.ts",
	mts: ".d.mts",
	cts: ".d.cts",
};

function parseTypeScriptPath(path) {
	const match = RE_TS.exec(path);
	return match
		? {
			base: path.slice(0, match.index),
			ext: match[1].toLowerCase(),
		}
		: null;
}

function getDeclarationPath(path) {
	const ts = parseTypeScriptPath(path);
	if (!ts) {
		return `${path}.d.ts`;
	}

	return `${ts.base}${EXT_MAP[ts.ext]}`;
}

function getRollupInputs(cwd, baseDir, input) {
	switch (typeof input) {
		case "string":
			return [ getRollupInput(cwd, baseDir, input) ];

		case "object":
			return Array.isArray(input)
				? input.map(file => getRollupInput(cwd, baseDir, file))
				: Object.keys(input).map(name => getRollupInput(cwd, baseDir, input[name], name));
	}
}

function getRollupInput(cwd, baseDir, file, name) {
	const parsed = path.parse(file);
	return {
		id: name ?? parsed.name,
		dir: path.relative(baseDir, path.join(cwd, parsed.dir)),
	};
}
