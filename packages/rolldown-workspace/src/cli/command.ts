export interface Command<TArgs extends { [TName in string]?: ArgumentInfo<TName, any, any, boolean> }, TOpts extends { [TName in string]?: OptionInfo<TName, any, any, boolean> }> {
	readonly args: readonly TArgs[string][];
	readonly opts: readonly TOpts[string][];
	readonly optMap: { [K in string]?: TOpts[string] };
}

export interface ParsedCommand<TArgs extends { [TName in string]?: ArgumentInfo<TName, any, any, boolean> }, TOpts extends { [TName in string]?: OptionInfo<TName, any, any, boolean> }> {
	readonly args: {
		[K in keyof TArgs]: TArgs[K] extends ArgumentInfo<any, infer TValue, infer TDefault, infer TRequired>
			? true extends TRequired
				? TValue
				: (TValue | undefined) & TDefault
			: unknown;
	};
	readonly opts: {
		[K in keyof TOpts]: TOpts[K] extends OptionInfo<any, infer TValue, infer TDefault, infer TMultiple>
			? true extends TMultiple
				? TValue[]
				: (TValue | undefined) & TDefault
			: unknown;
	};
}

export interface RequiredArgumentSetup<TValue> {
	read: (value: string) => TValue;
	required?: true;
}

export interface OptionalArgumentSetup<TValue, TDefault extends TValue | undefined> {
	read: (value: string) => TValue;
	required: false;
	default?: TDefault;
}

export interface ArgumentInfo<TName extends string, TValue, TDefault, TRequired extends boolean> {
	read: (value: string) => TValue;
	required: TRequired;
	name: TName;
	default?: TDefault;
}

export interface BooleanOptionSetup {
	alias?: string[];
	flag?: string;
}

export interface ValueOptionSetup<TValue, TDefault extends TValue | undefined> {
	read: (value: string) => TValue;
	alias?: string[];
	flag?: string;
	default?: TDefault;
	multiple?: false;
}

export interface MultiValueOptionSetup<TValue> {
	read: (value: string) => TValue;
	alias?: string[];
	flag?: string;
	multiple: true;
}

export interface OptionInfo<TName extends string, TValue, TDefault, TMultiple extends boolean> {
	name: TName;
	read?: (value: string) => TValue;
	default?: TDefault;
	multiple: TMultiple;
}

export interface CommandBuilder<TArgs extends { [TName in string]?: ArgumentInfo<TName, any, any, boolean> }> {
	arg<TName extends string, TValue>(
		name: TName,
		setup: RequiredArgumentSetup<TValue>,
	): CommandBuilder<TArgs & { [K in TName]: ArgumentInfo<TName, TValue, undefined, true> }>;

	arg<TName extends string, TValue, TDefault extends TValue | undefined>(
		name: TName,
		setup: OptionalArgumentSetup<TValue, TDefault>,
	): CommandBuilder<TArgs & { [K in TName]: ArgumentInfo<TName, TValue, TDefault, false> }>;

	opt<TName extends string>(
		name: TName,
		setup?: BooleanOptionSetup,
	): CommandBuilderWithArgs<TArgs, { [K in TName]: OptionInfo<TName, boolean, boolean, false> }>;

	opt<TName extends string, TValue, TDefault extends TValue | undefined>(
		name: TName,
		setup: ValueOptionSetup<TValue, TDefault>,
	): CommandBuilderWithArgs<TArgs, { [K in TName]: OptionInfo<TName, TValue, TDefault, false> }>;

	opt<TName extends string, TValue>(
		name: TName,
		setup: MultiValueOptionSetup<TValue>,
	): CommandBuilderWithArgs<TArgs, { [K in TName]: OptionInfo<TName, TValue, [], true> }>;

	build(): Command<TArgs, {}>;
}

export interface CommandBuilderWithArgs<TArgs extends { [TName in string]?: ArgumentInfo<TName, any, any, boolean> }, TOpts extends { [TName in string]?: OptionInfo<TName, any, any, boolean> }> {
	opt<TName extends string>(
		name: TName,
		setup?: BooleanOptionSetup,
	): CommandBuilderWithArgs<TArgs, TOpts & { [K in TName]: OptionInfo<TName, boolean, boolean, false> }>;

	opt<TName extends string, TValue, TDefault extends TValue | undefined>(
		name: TName,
		setup: ValueOptionSetup<TValue, TDefault>,
	): CommandBuilderWithArgs<TArgs, TOpts & { [K in TName]: OptionInfo<TName, TValue, TDefault, false> }>;

	opt<TName extends string, TValue>(
		name: TName,
		setup: MultiValueOptionSetup<TValue>,
	): CommandBuilderWithArgs<TArgs, TOpts & { [K in TName]: OptionInfo<TName, TValue, [], true> }>;

	build(): Command<TArgs, TOpts>;
}

export function buildCommand() {
	const args: ArgumentInfo<string, any, any, boolean>[] = [];
	const opts: OptionInfo<string, any, any, boolean>[] = [];
	const optMap: { [K in string]?: OptionInfo<string, any, any, boolean> } = {};
	const builder = {
		build: (): Command<{}, {}> => ({ args, opts, optMap }),
		arg: (name: string, setup: RequiredArgumentSetup<any> | OptionalArgumentSetup<any, any>) => {
			if (setup.required === true && args.length > 0 && args[args.length - 1].required !== true) {
				throw new Error(`required args must precede any optional args`);
			}

			args.push({
				name,
				read: setup.read,
				required: setup.required ?? true,
				default: (setup as OptionalArgumentSetup<any, any>).default,
			});

			return builder;
		},
		opt: (name: string, setup?: BooleanOptionSetup | ValueOptionSetup<any, any>) => {
			if (setup?.flag && setup.flag.length !== 1) {
				throw new Error(`flag must be a single character but '${setup.flag}' was given`);
			}

			const read = (setup as ValueOptionSetup<any, any> | undefined)?.read;
			const multiple = read ? (setup as ValueOptionSetup<any, any>).multiple ?? false : false;
			const opt = {
				name,
				read,
				multiple,
				default: multiple
					? undefined
					: read
						? (setup as ValueOptionSetup<any, any>).default
						: false,
			};

			const names = [ name ];
			if (setup?.alias) {
				names.push(...setup.alias);
			}

			if (setup?.flag) {
				names.push(setup.flag);
			}

			opts.push(opt);
			names.forEach(optName => {
				if (optMap[optName] !== undefined) {
					throw new Error(`duplicate option name '${optName}'`);
				}

				optMap[optName] = opt;
			});

			return builder;
		},
	};

	return builder as CommandBuilder<{}>;
}

const RE_OPTION = /^\s*?--([^\s]+)\s*$/;
const RE_FLAGS = /^\s*?-([^\s-]+)\s*$/;
const RE_TERMINATOR = /^\s*?--\s*$/;

export function parseArgs<TArgs extends { [TName in string]?: ArgumentInfo<TName, any, any, boolean> }, TOpts extends { [TName in string]?: OptionInfo<TName, any, any, boolean> }>(
	command: Command<TArgs, TOpts>,
	argv: readonly string[] = process.argv.slice(2),
) {
	const args: { [K in string]?: unknown } = {};
	const opts: { [K in string]?: unknown } = {};

	let match;
	let index = 0;
	let argIndex = 0;
	let optionsTerminated = false;

	const parseOption = (opt: OptionInfo<string, any, any, boolean>, variant: string) => {
		if (opt.read) {
			// option requires value
			const next = argv[index + 1];
			if (!next || RE_OPTION.test(next) || RE_FLAGS.test(next)) {
				throw new Error(`missing value for option '${variant}'`);
			}

			if (opt.multiple) {
				(opts[opt.name] = opts[opt.name] as unknown[] ?? []).push(opt.read(next));
			}
			else if (opts[opt.name] === undefined) {
				opts[opt.name] = opt.read(next);
			}
			else {
				throw new Error(`option '${variant}' only accepts a single value`);
			}

			index += 1;
		}
		else {
			// boolean option (switch)
			opts[opt.name] = true;
		}
	};

	for (; index < argv.length; index += 1) {
		if (RE_TERMINATOR.test(argv[index])) {
			optionsTerminated = true;
			continue;
		}

		// parse --options
		if (!optionsTerminated && (match = RE_OPTION.exec(argv[index]))) {
			const opt = command.optMap[match[1]];
			if (!opt) {
				throw new Error(`unrecognized option '--${match[1]}'`);
			}

			parseOption(opt, `--${match[1]}`);
			continue;
		}

		// parse -xyz flags
		if (!optionsTerminated && (match = RE_FLAGS.exec(argv[index]))) {
			const flags = match[1];
			if (flags.length === 1) {
				const opt = command.optMap[flags];
				if (!opt) {
					throw new Error(`unrecognized option '-${flags}'`);
				}

				parseOption(opt, `-${flags}`);
			}
			else {
				let fi = 0;
				for (; fi < match[1].length; fi += 1) {
					const flag = command.optMap[flags[fi]];
					if (!flag) {
						throw new Error(`unrecognized flag '-${flags[fi]}'`);
					}

					if (flag.read) {
						throw new Error(`cannot use option '-${flags[fi]}' in a flag group, it requires a value`);
					}

					// boolean flag
					opts[flag.name] = true;
				}
			}

			continue;
		}

		// parse args
		if (argIndex >= command.args.length) {
			throw new Error(`too many arguments`);
		}

		const arg = command.args[argIndex]!;
		args[arg.name] = arg.read(argv[index]);
		argIndex += 1;
	}

	// did we get enough args?
	const requiredArgCount = command.args.reduce((sum, arg) => sum + (arg!.required ? 1 : 0), 0);
	if (argIndex < requiredArgCount) {
		throw new Error(`too few arguments`);
	}

	// populate option defaults
	command.opts.forEach(opt => {
		if (opts[opt!.name] === undefined) {
			opts[opt!.name] = opt!.multiple ? [] : opt!.default;
		}
	});

	return { args, opts } as ParsedCommand<TArgs, TOpts>;
}
