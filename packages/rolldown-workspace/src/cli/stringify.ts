export function safeStringifyStruct(
	value: unknown,
	indent: string = "",
	visited: WeakSet<WeakKey> = new WeakSet(),
) {
	switch (typeof value) {
		case "number":
			return value.toString();

		case "string":
			return safeQuoteString(value);

		case "boolean":
			return value ? "true" : "false";

		case "bigint":
			return value.toString() + "n";

		case "symbol":
			return "<symbol>";

		case "function":
			return "<function>";

		case "object": {
			if (value === null) {
				return "null";
			}

			if (visited.has(value)) {
				return "<cycle>";
			}

			visited.add(value);
			if (Array.isArray(value)) {
				return safeStringifyArray(value, indent, visited);
			}

			const proto = Object.getPrototypeOf(value);
			if (proto === Object.prototype) {
				return safeStringifyObject(value as Record<PropertyKey, unknown>, indent, visited);
			}

			return proto?.constructor?.name ?? "<unknown>";
		}
	}
}

function safeQuoteString(str: string) {
	const { length } = str;
	let text = "";
	let index = 0;
	let anchor = 0;

	for (; index < length; index += 1) {
		if (str[index] === "\"") {
			text += str.slice(anchor, index) + "\\\"";
			anchor = index + 1;
		}
	}

	return "\"" + text + str.slice(anchor) + "\"";
}

function safeStringifyArray(
	collection: readonly unknown[],
	indent: string,
	visited: WeakSet<WeakKey>,
) {
	const nextIndent = indent + "  ";
	const { length } = collection;

	let text = "";
	let index = 0;
	for (; index < length; index += 1) {
		text += `\n${nextIndent}${safeStringifyStruct(collection[index], nextIndent, visited)},`;
	}

	return text ? `[${text}\n${indent}]` : "[]";
}

function safeStringifyObject(
	record: Record<PropertyKey, unknown>,
	indent: string,
	visited: WeakSet<WeakKey>,
) {
	const nextIndent = indent + "  ";

	let text = "";
	let key;
	for (key in record) {
		if (Object.hasOwn(record, key)) {
			text += `\n${nextIndent}${safeStringifyStruct(key, "", visited)}: ${safeStringifyStruct(record[key], nextIndent, visited)},`;
		}
	}

	return text ? `{${text}\n${indent}}` : "{}";
}
