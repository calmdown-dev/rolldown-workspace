import { defineConfig } from "rolldown";
import { dts } from "rolldown-plugin-dts";

export default defineConfig({
	input: "./src/index.ts",
	output: {
		dir: "./dist",
		format: "es",
		cleanDir: true,
		codeSplitting: false,
		minify: true,
	},
	platform: "node",
	tsconfig: "./tsconfig.json",
	external: [ "rolldown" ],
	plugins: [
		dts(),
	],
});
