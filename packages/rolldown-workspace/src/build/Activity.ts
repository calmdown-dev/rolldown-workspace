import { AbortError } from "~/AbortError";

export interface Activity {
	readonly isActive: boolean;
	readonly completed: Promise<void>;
	ensureActive(): void;
}

export function activity(block: (stop: () => void) => void | Promise<unknown>): Activity {
	let isActive = true;
	const completed = new Promise<void>(resolve => {
		const stop = () => {
			isActive = false;
			resolve();
		};

		block(stop)?.then(stop, stop);
	});

	return {
		get isActive() {
			return isActive;
		},
		completed,
		ensureActive,
	};
}

activity.completed = {
	isActive: false,
	completed: Promise.resolve(),
	ensureActive,
} as Activity;

function ensureActive(this: Activity) {
	if (!this.isActive) {
		throw new AbortError("the activity was stopped");
	}
}
