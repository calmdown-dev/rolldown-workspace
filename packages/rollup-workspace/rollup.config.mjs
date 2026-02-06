import pluginDelete from "@calmdown/rollup-plugin-delete";
import pluginTerser from "@rollup/plugin-terser";
import pluginTypeScript from "@rollup/plugin-typescript";
import pluginBundleDts from "rollup-plugin-dts";
import pluginExternals from "rollup-plugin-node-externals";

const terserOptions = {
	compress: {
		ecma: 2020,
		module: true,
		passes: 3,
	},
	format: {
		comments: false,
	},
	mangle: {
		module: true,
		toplevel: true,
	},
};

export default [
	{
		input: "./src/index.ts",
		output: {
			file: "./dist/index.mjs",
			format: "es",
		},
		plugins: [
			pluginDelete({
				targets: [
					{
						trigger: "before",
						include: "./dist/**/*",
					},
				],
			}),
			pluginExternals(),
			pluginTypeScript(),
			pluginTerser(terserOptions),
		],
	},
	{
		input: "./src/index.ts",
		output: {
			file: "./dist/index.d.ts",
			format: "es",
		},
		plugins: [
			pluginExternals(),
			pluginTypeScript(),
			pluginBundleDts(),
		],
	},
];
