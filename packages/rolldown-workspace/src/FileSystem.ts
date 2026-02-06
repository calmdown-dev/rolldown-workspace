export interface FileSystem {
	glob: (
		patterns: string | readonly string[],
		options: GlobOptions,
	) => AsyncIterableIterator<string, undefined, any>;

	readFile: (
		path: string,
		encoding: "utf8",
	) => Promise<string>;
}

export interface GlobOptions {
	cwd: string;
}

export async function getNodeFileSystem(): Promise<FileSystem> {
	const fsPromises = await import("node:fs/promises");
	return {
		glob: fsPromises.glob,
		readFile: fsPromises.readFile,
	};
}
