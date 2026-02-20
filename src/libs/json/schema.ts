// A Schema<A> contains information to encode and decode a value.
//
// This allows us to have safe coversion to and from JSON
export {
  Schema,
  type Infer,
  type SchemaDef,
  type SchemaOptional,
  type Variant,
  object,
  pair,
  triple,
  map,
  boolean,
  number,
  string,
  array,
  json,
  both,
  maybe,
  nullable,
  optional,
  optionalNullable,
  optionalMaybe,
  optionalDefault,
  stringLiteral,
  stringEnum,
  stringified,
  oneOf,
  discriminatedUnion,
  variant,
  from,
  decode,
  encode,
  decoder,
  encoder,
  recursive
};

import * as decoder from "@/libs/json/decoder";
import * as encoder from "@/libs/json/encoder";
import { Result } from "@/libs/result";
import { Decoder, DecoderDef } from "@/libs/json/decoder";
import * as D from "@/libs/json/decoder";
import { Encoder, EncoderDef } from "@/libs/json/encoder";
import { Json } from "@/libs/json/types";
import * as E from "@/libs/json/encoder";
import { Maybe, Nullable } from "@/libs/maybe";
import { filterMap, mapValues } from "@/libs/helpers/object";

// Infer the type from a schema definition
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Infer<A extends Schema<any>> = A extends Schema<infer B> ? B : never;

class Schema<A> {
  decoder: Decoder<A>;
  encoder: Encoder<A>;

  constructor(decoder: Decoder<A>, encoder: Encoder<A>) {
    this.decoder = decoder;
    this.encoder = encoder;
  }

  dimap<W>(p: (v: A) => W, s: (v: W) => A): Schema<W> {
    return new Schema(this.decoder.map(p), this.encoder.rmap(s));
  }

  chain<W>(p: (v: A) => Decoder<W>, s: (v: W) => A): Schema<W> {
    return new Schema(this.decoder.chain(p), this.encoder.rmap(s));
  }
}

function decode<A>(schema: Schema<A>, input: unknown): Result<string, A> {
  return D.decode(input, schema.decoder);
}

function encode<A>(schema: Schema<A>, input: A): Json {
  return schema.encoder.run(input);
}

// Create a Schema
function from<A>(decoder: Decoder<A>, encoder: Encoder<A>): Schema<A> {
  return new Schema(decoder, encoder);
}

type SchemaDef<A> = {
  [D in keyof A]: Schema<A[D]> | SchemaOptional<A[D]>;
};

const json: Schema<Json> = new Schema(D.json, E.json);
const boolean: Schema<boolean> = new Schema(D.boolean, E.boolean);
const number: Schema<number> = new Schema(D.number, E.number);
const string: Schema<string> = new Schema(D.string, E.string);

const array = <A>(schema: Schema<A>): Schema<Array<A>> => new Schema(D.array(schema.decoder), E.array(schema.encoder));

const both = <T, U>(left: Schema<T>, right: Schema<U>): Schema<[T, U]> =>
  new Schema(D.both(left.decoder, right.decoder), E.both(left.encoder, right.encoder));

// Schema for an object field that may not be present.
class SchemaOptional<A> {
  constructor(
    readonly decoder: D.DecoderOptional<A>,
    readonly encoder: E.EncoderOptional<A>
  ) {}

  dimap<W>(p: (v: A) => W, s: (v: W) => A): SchemaOptional<W> {
    return new SchemaOptional(this.decoder.map(p), this.encoder.rmap(s));
  }
}

// An object field that may be absent.
const optional = <A>(s: Schema<A>): SchemaOptional<A | undefined> =>
  new SchemaOptional(D.optional(s.decoder), E.optional(s.encoder));

const optionalNullable = <A>(schema: Schema<NonNullable<A>>): SchemaOptional<Nullable<A>> =>
  new SchemaOptional(D.optionalNullable(schema.decoder), E.optionalNullable(schema.encoder));

const optionalMaybe = <A>(schema: Schema<A>): SchemaOptional<Maybe<A>> =>
  new SchemaOptional(D.optionalMaybe(schema.decoder), E.optionalMaybe(schema.encoder));

// When decoding, if the field is absent, then the default will be used.
// When encoding, the field is required.
const optionalDefault = <A>(def: A, schema: Schema<A>): SchemaOptional<A> =>
  new SchemaOptional(D.optionalDefault(def, schema.decoder), E.optional(schema.encoder));

function object<A>(def: SchemaDef<A>): Schema<A> {
  const pdef = {} as DecoderDef<A>;
  const sdef = {} as EncoderDef<A>;
  for (const key in def) {
    const schema = def[key];
    pdef[key] = schema.decoder;
    sdef[key] = schema.encoder;
  }

  const decoder: Decoder<A> = D.object(pdef);
  const encoder: Encoder<A> = E.object(sdef);
  return new Schema(decoder, encoder);
}

const pair = <L, R>(l: Schema<L>, r: Schema<R>): Schema<[L, R]> => {
  const decoder = D.pair(l.decoder, r.decoder);
  const encoder = E.pair(l.encoder, r.encoder);
  return new Schema(decoder, encoder);
};

const triple = <A, B, C>(a: Schema<A>, b: Schema<B>, c: Schema<C>): Schema<[A, B, C]> => {
  const decoder = D.triple(a.decoder, b.decoder, c.decoder);
  const encoder = E.triple(a.encoder, b.encoder, c.encoder);
  return new Schema(decoder, encoder);
};

const map = <A>(s: Schema<A>): Schema<Map<string, A>> =>
  array(pair(string, s)).dimap(
    (xs) => xs.reduce((acc, [k, v]) => acc.set(k, v), new Map<string, A>()),
    (m) => Array.from(m.entries())
  );

const maybe = <A>(s: Schema<A>): Schema<Maybe<A>> => new Schema(D.maybe(s.decoder), E.maybe(s.encoder));

const nullable = <A>(s: Schema<A>): Schema<Nullable<A>> => new Schema(D.nullable(s.decoder), E.nullable(s.encoder));

const stringLiteral = <T extends string>(str: T): Schema<T> =>
  new Schema(
    D.stringLiteral(str),
    E.string.rmap((input) => {
      if (input != str) {
        throw new Error(`Cannot encode '${input}'. Expected literal '${str}'"`);
      }
      return input;
    })
  );

const stringEnum = <const T extends string[]>(strs: T): Schema<T[number]> =>
  new Schema(D.stringEnum(strs), E.stringEnum(strs));

const oneOf = <V>(f: (v: V) => Schema<V>, ss: Array<Schema<V>>): Schema<V> =>
  new Schema(
    D.oneOf(ss.map((s) => s.decoder)),
    E.oneOf((v) => f(v).encoder)
  );

const discriminatedUnion = <const Variants extends readonly Variant<any>[]>(
  vars: Variants
): Schema<Infer<Variants[number]["schema"]>> => {
  type Ty = Infer<Variants[number]["schema"]>;
  const d: D.Decoder<Ty> = D.oneOf(vars.map((v) => v.schema.decoder));
  const e: E.Encoder<Ty> = E.oneOf<Ty>((v) => {
    const found = vars.find((variant) => matches(variant.pattern, v));
    if (found == undefined) {
      throw new Error(`Invalid discriminant in union type: '${v}'`);
    }

    return found.schema.encoder;
  });

  return new Schema<Ty>(d, e);
};

// Check whether a value matches a pattern.
const matches = (pattern: Record<string, string>, val: unknown): boolean => {
  if (typeof val !== "object" || val === null) {
    return false;
  }

  for (const key in pattern) {
    if (!(key in val)) {
      return false;
    }
    if (pattern[key] != undefined && pattern[key] !== (val as any)[key]) {
      return false;
    }
  }

  return true;
};

// One option in a sum type.
// Includes the pattern that differentiates it from the other options in the type.
class Variant<T> {
  constructor(
    readonly pattern: Record<string, string>,
    readonly schema: Schema<T>
  ) {}
}

type VariantDef<T extends string, A> = {
  [D in keyof A]: Schema<A[D]> | SchemaOptional<A[D]> | (A[D] & T);
};

const variant = <const T extends string, const A>(def: VariantDef<T, A>): Variant<A> => {
  const pattern = filterMap(def, (_, v): string | undefined => (typeof v == "string" ? v : undefined)) as Record<
    string,
    string
  >;

  if (Object.keys(pattern).length == 0) {
    throw new Error(
      "Invalid variant definition. No discriminant identified. Discriminant must be provided as a string"
    );
  }

  const schemaDef: SchemaDef<A> = mapValues(def, (_, value) =>
    // @ts-expect-error hard to prove the types, but this is correct.
    typeof value == "string" ? stringLiteral<T>(value) : value
  );

  const schema: Schema<A> = object(schemaDef);

  return new Variant(pattern, schema);
};

// Schema for a stringified JSON representation.
const stringified = <T>(inner: Schema<T>): Schema<T> =>
  new Schema(D.stringified(inner.decoder), E.stringified(inner.encoder));

const recursive = <T>(f: (s: Schema<T>) => Schema<T>): Schema<T> => {
  const baseEncoder: Encoder<T> = new Encoder((_) => {
    throw new Error("A recursive encoder cannot immediately call itself.");
  });
  const baseDecoder: Decoder<T> = decoder.fail("A recursive decoder cannot immediately call itself.");
  const base: Schema<T> = new Schema(baseDecoder, baseEncoder);
  const top = f(base);
  // @ts-expect-error assigning to read-only prop
  base.encoder.run = top.encoder.run;
  // @ts-expect-error assigning to read-only prop
  base.decoder.run = top.decoder.run;
  return top;
};
