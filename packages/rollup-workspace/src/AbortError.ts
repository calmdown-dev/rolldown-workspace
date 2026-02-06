export class AbortError extends Error {
	public constructor(
		message: string = "operation was aborted",
		options?: ErrorOptions,
	) {
		super(message, options);
	}
}
