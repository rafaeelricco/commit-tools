/*
    This module holds useful type-level functions.
*/
export { type UnionPick, absurd };

// Exhaustiveness guard for discriminated unions.
//
// Call in the `default` branch of a switch (or any unreachable position) to
// force the compiler to verify every variant was handled. Adding a new variant
// makes `value` no longer assignable to `never`, turning the missed case into
// a compile-time error.
//
//    switch (x.type) {
//      case "a": return ...
//      case "b": return ...
//      default: return absurd(x, "UserEvent");
//    }
function absurd(value: never, label: string): never {
  throw new Error(`${label}: unhandled variant ${JSON.stringify(value)}`);
}

type UnionToIntersection<U> = (U extends any ? (k: U) => void : never) extends (k: infer I) => void ? I : never;

type UnionToOvlds<U> = UnionToIntersection<U extends any ? (f: U) => void : never>;

type PopUnion<U> = UnionToOvlds<U> extends (a: infer A) => void ? A : never;

type IsUnion<T> = [T] extends [UnionToIntersection<T>] ? false : true;

// Convert a union to a tuple
//
//    UnionToTuple<A | B> == [ A , B ]
//
type UnionToTuple<T, A extends unknown[] = []> =
  IsUnion<T> extends true ? UnionToTuple<Exclude<T, PopUnion<T>>, [PopUnion<T>, ...A]> : [T, ...A];

// Pick an option from a union
//
//    UnionPick<A | B | C, 0> == A
//
type UnionPick<T, N extends keyof UnionToTuple<T>> = UnionToTuple<T>[N];
