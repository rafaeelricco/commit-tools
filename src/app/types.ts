// Common types for the application
// Add domain-specific types as the project grows.

import * as s from "@/json/schema";

type Schema<T> = s.Schema<T>;

// Schema for an id-like type wrapper with a value field.
function idSchema<E extends { value: string }>(ctr: new (value: string) => E): Schema<E> {
  return s.string.dimap(
    v => new ctr(v),
    v => v.value,
  );
}

function compareWithValue<T extends { value: string }>(a: T, b: T) {
  return (
    a.value > b.value ? 1
    : a.value === b.value ? 0
    : -1
  );
}

export { idSchema, compareWithValue };
