import type { WriteStream } from "node:tty";
import { EOL } from "node:os";

import type { LogLevel as RolldownLogLevel } from "rolldown";

import { AbortError } from "~/AbortError";
import type { Package } from "~/workspace";

export type LogLevel = RolldownLogLevel | "error";

export interface PackageInfo {
	readonly pkg: Package;
	status: StatusKind;
	buildStartTime: number;
	buildEndTime: number;
	message?: string;
}

export type StatusKind =
	| "FAIL"
	| "BUSY"
	| "IDLE"
	| "PASS"
	| "SKIP";


const ANSI_RED = "0;31m";
const ANSI_GREEN = "0;32m";
const ANSI_CYAN = "0;36m";
const ANSI_YELLOW = "0;33m";
const ANSI_HI_BLACK = "0;90m";
const ANSI_WHITE = "0;37m";
const ANSI_BOLD = "1m";

const StatusColor: Record<StatusKind, string> = {
	FAIL: ANSI_RED,
	BUSY: ANSI_CYAN,
	IDLE: ANSI_YELLOW,
	PASS: ANSI_GREEN,
	SKIP: ANSI_YELLOW,
};

const LogLevelColor: Record<LogLevel, string> = {
	debug: ANSI_HI_BLACK,
	info: ANSI_WHITE,
	warn: ANSI_YELLOW,
	error: ANSI_RED,
};

export class Reporter {
	public isDebug = false;

	private readonly isFormatted: boolean = !/^(true|1)$/i.test(process.env.CI ?? "");
	private readonly packages = new Map<Package, PackageInfo>();
	private updateHandle: ReturnType<typeof setTimeout> | null = null;
	private linesToClear = 0;
	private lastLogTitle = "";
	private isFinished = false;

	public constructor(
		private readonly output: WriteStream,
	) {}

	public log(title: string, message: string, level: LogLevel = "info") {
		let output = "";
		if (this.lastLogTitle !== title) {
			output = `${EOL}${this.format(title, ANSI_BOLD)}${EOL}┌${"─".repeat(title.length - 1)}${EOL}`;
			this.lastLogTitle = title;
		}

		const formatted = message
			.split(/(?:\r\n|\n|\r)+/g)
			.map(line => this.format(line, LogLevelColor[level]))
			.join(`${EOL}| `);

		output += `│ ${formatted}${EOL}`;
		this.writeOutput(output);
	}

	public logError(title: string, ex: Error) {
		if (ex instanceof AbortError) {
			return;
		}

		this.log(title, (this.isDebug ? ex.stack : null) ?? ex.toString(), "error");
	}

	public addPackage(pkg: Package, status: StatusKind = "IDLE", message?: string) {
		const info = this.getInfoFor(pkg);
		info.status = status;
		info.message = message;

		this.scheduleUpdate();
	}

	public packageBuildStarted(pkg: Package) {
		const info = this.getInfoFor(pkg);
		info.status = "BUSY";
		info.buildStartTime = Date.now();

		this.scheduleUpdate();
	}

	public packageBuildSucceeded(pkg: Package) {
		const info = this.getInfoFor(pkg);
		info.status = "PASS";
		info.buildEndTime = Date.now();

		this.scheduleUpdate();
	}

	public packageBuildFailed(pkg: Package) {
		const info = this.getInfoFor(pkg);
		info.status = "FAIL";
		info.buildEndTime = Date.now();

		this.scheduleUpdate();
	}

	public finish() {
		this.writeOutput("", true);
		this.linesToClear = 0;
		this.isFinished = true;
	}

	public println(text = "") {
		this.writeOutput(text + EOL);
	}


	private format(text: string, ansiCode: string) {
		return this.isFormatted ? `\u001b[${ansiCode}${text}\u001b[0m` : text;
	}

	private getInfoFor(pkg: Package) {
		let info = this.packages.get(pkg);
		if (!info) {
			this.packages.set(pkg, info = {
				pkg,
				status: "IDLE",
				buildStartTime: 0,
				buildEndTime: 0,
			});
		}

		return info;
	}

	private scheduleUpdate() {
		this.updateHandle ??= setTimeout(() => {
			this.updateHandle = null;
			this.writeOutput("");
		}, 50);
	}

	private writeOutput(text: string, includeTree = this.isFormatted) {
		let seq = text;
		if (this.linesToClear > 0) {
			// go up n-lines and clear down
			seq = `\u001b[${this.linesToClear}A\r\u001b[0J${seq}`;
			this.linesToClear = 0;
		}

		if (includeTree && !this.isFinished) {
			const tree = this.formatTree();
			seq += tree.output;
			this.linesToClear = tree.lineCount;
		}

		this.output.write(seq);
	}

	private formatTree() {
		const isRoot = ({ pkg }: PackageInfo) => (
			pkg.upstreamDependents.length === 0 ||
			pkg.upstreamDependents.every(dep => !this.packages.has(dep))
		)

		return this.packages
			.values()
			.filter(isRoot)
			.reduce(
				(acc, info) => {
					const tmp = this.formatTreeNode(info.pkg);
					acc.lineCount += tmp.lineCount;
					acc.output += tmp.output;
					return acc;
				},
				{
					lineCount: 1,
					output: EOL,
				},
			);
	}

	private formatTreeNode(
		pkg: Package,
		prefix: string = "",
		li0: string = "",
		li1: string = "",
	) {
		const info = this.packages.get(pkg);
		let label = this.format("IDLE", StatusColor.IDLE);
		let extra = "";

		if (info) {
			label = this.format(info.status, StatusColor[info.status]);

			if (info.buildStartTime > 0 && info.buildEndTime >= info.buildStartTime) {
				extra += ` (${formatTime(info.buildEndTime - info.buildStartTime)})`;
			}

			if (info.message) {
				extra += ` · ${info.message}`;
			}
		}

		const { length } = pkg.downstreamDependencies;
		let index = 0;
		let isLast;
		let result;

		let lineCount = 1;
		let output = `${label} ${this.format(prefix + li0, ANSI_HI_BLACK)}${this.format(pkg.declaration.name, ANSI_BOLD)}${extra}${EOL}`;

		for (; index < length; index += 1) {
			isLast = index + 1 === length;
			result = this.formatTreeNode(
				pkg.downstreamDependencies[index],
				prefix + li1,
				isLast ? "╰─ " : "├─ ",
				isLast ? "   " : "│  ",
			);

			lineCount += result.lineCount;
			output += result.output;
		}

		return { lineCount, output };
	}
}

export function formatTime(timeMs: number): string {
	if (timeMs >= 1_000) {
		return `${(Math.round(timeMs / 100) / 10).toFixed(1)}s`;
	}

	return `${timeMs.toFixed(0)}ms`;
}
