import { AbortError } from "~/AbortError";

export interface Activity {
	readonly isActive: boolean;
	readonly completed: Promise<void>;
	ensureActive(): void;
}

export function activity(block: (stop: () => void) => void | Promise<void>): Activity {
	let isStopped = false;
	const completed = new Promise<void>(resolve => {
		const stop = () => {
			isStopped = true;
			resolve();
		};

		block(stop)?.then(stop, stop);
	});

	return {
		get isActive() {
			return !isStopped;
		},
		completed,
		ensureActive: () => {
			if (isStopped) {
				throw new AbortError("the activity was stopped");
			}
		},
	};
}
