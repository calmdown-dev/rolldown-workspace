export interface Deferred<T = void> {
	readonly value: Promise<T>;
	ensurePending(): void;
	getValue(): T;
}

export interface CompletableDeferred<T = void> extends Deferred<T> {
	complete(value: T): void;
	fail(reason: Error): void;
}

interface CompletableDeferredInternal<T> extends CompletableDeferred<T> {
	_pending: boolean;
	_value?: T;
	_reason?: Error;
}

export function deferred<T = void>(): CompletableDeferred<T> {
	let resolveFn: (value: T) => void;
	let rejectFn: (ex: Error) => void;
	const self: CompletableDeferredInternal<T> = {
		_pending: true,
		value: new Promise((resolve, reject) => {
			resolveFn = resolve;
			rejectFn = reject;
		}),
		ensurePending,
		getValue,
		complete: value => {
			self._pending = false;
			self._value = value;
			resolveFn(value);
		},
		fail: reason => {
			self._pending = false;
			self._reason = reason;
			rejectFn(reason);
		},
	};

	return self;
}

deferred.resolved = <T>(value: T): Deferred<T> => {
	const self = deferred<T>();
	self.complete(value);
	return self;
};

deferred.rejected = <T = unknown>(reason: Error): Deferred<T> => {
	const self = deferred<T>();
	self.fail(reason);
	return self;
};

function ensurePending<T>(this: CompletableDeferredInternal<T>) {
	if (!this._pending) {
		throw new Error("the Deferred is not pending");
	}
}

function getValue<T>(this: CompletableDeferredInternal<T>) {
	if (this._pending) {
		throw new Error("the Deferred is still pending");
	}

	if (this._reason) {
		throw this._reason;
	}

	return this._value!;
}
