export interface NodeError extends Error {
	readonly code?: string;
}

export function isENOENT(ex: unknown): ex is NodeError {
	return (ex as NodeError | null)?.code === "ENOENT";
}

export function isObject(value: unknown): value is Record<PropertyKey, unknown> {
	return value !== null && typeof value === "object";
}

export function isString(value: unknown): value is string {
	return typeof value === "string";
}

export function isArrayOf<T>(value: unknown, guard: (item: unknown) => item is T): value is T[] {
	return Array.isArray(value) && (value.length === 0 || guard(value[0]));
}
