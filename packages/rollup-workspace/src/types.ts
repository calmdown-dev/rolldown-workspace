export interface FileSystem {
	glob: (
		patterns: string | readonly string[],
		options: GlobOptions,
	) => AsyncIterableIterator<string, undefined, any>;

	readFile: (
		path: string,
		encoding: "utf8",
	) => Promise<string>;

	watch: (
		path: string,
	) => Watcher;
}

export interface GlobOptions {
	cwd: string;
}

export interface Watcher {
	close: () => void;
	on: (type: "change", listener: () => void) => void;
}
