---
description: TypeScript conventions — type safety, functional primitives, domain modeling.
globs: "*.ts, *.tsx"
alwaysApply: false
---

Favour static types, explicit data flow, immutability, pure functions, composition, exhaustive matching, monadic error handling (`Result`/`Maybe`/`Future`), strict generics, and branded values over raw primitives.

## Type Design

- Use **branded classes** for entity IDs. Don't use `string & { __brand }` intersections — they allow name collisions, leak `__brand` into intellisense, and accept raw strings without constructors.
  ```ts
  class MyId {
    // @ts-expect-error _tag's existence prevents structural comparison
    private readonly _tag: null = null;
    constructor(public value: string) {}
  }
  ```
- Use **discriminated unions** to make invalid states unrepresentable. Don't use bags of optional properties when combinations create impossible states.
  ```ts
  type State = { status: "loading" } | { status: "error"; error: Error } | { status: "success"; data: { id: string } };
  ```
- Use **exhaustive `switch`** with a `never` default on discriminated unions. This forces handling new variants at compile time.
  ```ts
  default: {
    const _exhaustiveCheck: never = config;
    throw new Error(`Unknown: ${JSON.stringify(_exhaustiveCheck)}`);
  }
  ```
- Don't use **empty objects** (e.g. `ConversationId.empty()`) to represent absence. Use `Maybe<T>` with `Nothing()` instead.
- Use **`as const` objects** instead of `enum`. Derive the type with `type X = (typeof X)[keyof typeof X]`.
  ```ts
  const PackStatus = { Draft: "Draft", Approved: "Approved", Shipped: "Shipped" } as const;
  type PackStatus = (typeof PackStatus)[keyof typeof PackStatus];
  ```
- **Declare return types** on top-level module functions. Exception: JSX components returning JSX.
- **Avoid `any`**. Use strict generics to preserve type information:
  ```ts
  function parse<T>(data: { result: T }): T {
    return data.result;
  }
  ```

## Domain Modeling

- Co-locate `static schema` on entity ID classes for native serialization/deserialization.
  ```ts
  class MessageId {
    static schema = idSchema(this);
    readonly _tag: "MessageId";
  }
  ```
- Model rich content (LLM outputs, conversation events) with `s.discriminatedUnion` + `s.variant`. Don't use giant bags of optional properties.
  ```ts
  const schema_AgentExecutionTrace = s.discriminatedUnion([
    s.variant({ type: "text", text: s.string }),
    s.variant({ type: "tool_call", name: s.string, input: s.json, result: schema_Result(schema_Error, s.json) }),
    s.variant({ type: "error", message: s.string, code: s.optional(s.string) })
  ]);
  ```
- Embed **immutable snapshots** in event payloads when referencing mutable external data (e.g. a property's price at the time of booking).
  ```ts
  const schema_UserActions = s.discriminatedUnion([
    s.variant({ type: "view_property", property: schema_PropertySnapshot }),
    s.variant({ type: "start_booking", property: schema_PropertySnapshot, draftId: DraftId.schema }),
    s.variant({ type: "confirm_booking", draftId: DraftId.schema })
  ]);
  ```
- Bundle related state into **union-driven state machines**. Don't use loose boolean flags (`isStreaming`, `isError`, `isLoading`) spread across stores.

  ```ts
  type Stream<E, R> =
    | { type: "not_started" }
    | { type: "streaming"; results: R[] }
    | { type: "done"; results: R[] }
    | { type: "error"; error: E };

  type VoiceConnection =
    | { type: "disconnected" }
    | { type: "connecting" }
    | { type: "transcribing"; transcription: string }
    | { type: "error"; error: FetchErrorResponse };

  type UserInput = { type: "text"; content: string } | { type: "voice"; connection: VoiceConnection };

  interface ActiveConversation {
    id: ConversationId;
    messages: Array<Message>;
    inputMode: UserInput;
    streamingResponse: Stream<Error, string>;
  }
  ```

---

## Maybe — Representing Absence

Use `Maybe<T>` instead of `null`/`undefined`. Construct with `Just(value)` or `Nothing()`.

- Pattern match with `instanceof Just` / `instanceof Nothing` + `satisfies never` in default. Don't use `isJust()`/`isNothing()` — they don't narrow types.
  ```ts
  switch (true) {
    case maybeUser instanceof Just:
      console.log(maybeUser.value);
      break;
    case maybeUser instanceof Nothing:
      console.log("No user");
      break;
    default:
      maybeUser satisfies never;
  }
  ```
- Use `.map(fn)` for transforms. Use `.chain(fn)` (flatMap) when `fn` returns `Maybe<T>` — avoids `Maybe<Maybe<T>>`.
- Use `.withDefault(fallback)` or `.maybe(default, fn)` for default values.
- Use `.alt(other)` to chain fallback Maybe values: `primary.alt(secondary).alt(fallback)`.
- Use `fromNullable()` for `null` and `fromOptional()` for `undefined` at system boundaries.
- Use `catMaybes(arr)` to filter out `Nothing` values, `mapMaybe(arr, fn)` to map+filter in one pass.
- Don't use `.expect()` for recoverable absence — it throws. Use `.withDefault()` or `.maybe()`.
- Don't mix `fromNullable` and `fromOptional` — they handle different nullish types.

---

## Result — Typed Error Handling

Use `Result<E, T>` for fallible operations. Return `Failure(error)` instead of throwing. Never `throw` unless it's a catastrophic programmer bug.

- Construct with `Success<E, T>(value)` or `Failure<E, T>(error)` — callable without `new`.
- Use `.either(onError, onSuccess)` for exhaustive fold.
  ```ts
  const handle = (result: Result<Error, User>): string =>
    result.either(
      (e) => e.message,
      (user) => user.name
    );
  ```
- Use `.chain(fn)` for monadic sequencing — short-circuits on first `Failure`.
  ```ts
  parseJson(input).chain(validate).chain(transform);
  ```
- Use `.map(fn)` for pure transforms on `Success`, `.mapFailure(fn)` to transform error types.
- Don't mix `Result` with `try/catch`. Don't use `.unwrap()` outside boundaries — it throws on `Failure`.
- `traverse` works with `List`, `traverse_` works with `Array`. Both short-circuit on first `Failure`.

---

## RemoteData — UI State Machine

Use `RemoteData<E, T>` to model async UI state. Don't use `{ loading: bool; error: Error | null; data: T | null }` — it allows impossible combinations.

- States: `NotAsked()`, `Loading()`, `Failed(error)`, `Ready(value)`.
- Pattern match with `instanceof` + `satisfies never`.
  ```ts
  switch (true) {
    case state instanceof Ready:
      render(state.value);
      break;
    case state instanceof Failed:
      showError(state.error);
      break;
    case state instanceof Loading:
      showSpinner();
      break;
    case state instanceof NotAsked:
      break;
    default:
      state satisfies never;
  }
  ```
- `.map(fn)` transforms only `Ready`; preserves `Loading`/`Failed`/`NotAsked`.
- `.chain(fn)` for `RemoteData`-returning functions — avoids double wrapping.
- `NotAsked` means "haven't asked yet". For "asked but empty", use `Ready([])`.
- Don't check `isReady` without `instanceof` — boolean flags don't narrow types.

---

## Future — Lazy Async Computation

Use `Future<E, T>` instead of `Promise` for lazy, cancelable async.

- Create with `Future.create<E, T>((reject, resolve) => { ... return cancelFn })`. Return the cancel function.
  ```ts
  const future = Future.create<never, number>((reject, resolve) => {
    const timer = setTimeout(() => resolve(42), 1000);
    return () => clearTimeout(timer);
  });
  ```
- Use `Future.createUncancellable` for inherently uncancellable operations.
- Nothing executes until `.fork(onError, onSuccess)` is called. `fork` returns a cancel function — store it if cancellation is needed.
- Don't use `Future.attemptP` for cancellable operations — it loses cancellation semantics. Use it only for wrapping simple Promises: `Future.attemptP(() => someAsyncFn())`.
- Don't double-wrap Promises: `Future.attemptP(() => fn())`, not `Future.attemptP(async () => { const r = await fn(); return r; })`.
- Use `.chain(fn)` for sequential async composition.
  ```ts
  fetchUser(id)
    .chain((user) => fetchPosts(user.id).map((posts) => ({ user, posts })))
    .fork(handleError, ({ user, posts }) => render(user, posts));
  ```
- Use `Future.parallel(limit, futures)` for bounded concurrency. Use `Future.concurrently({...})` for named concurrent operations.
- Use `.chainRej(fn)` to recover from errors. `.mapRej(fn)` transforms errors but stays rejected.
- Use `Future.bracket(acquire, release, use)` for guaranteed resource cleanup (locks, connections, file descriptors).
- Use `Future.race(a, b)` for timeouts.
- Convert to Promise with `await future.promise(e => new Error(String(e.message)))`.
- `attemptP` always produces `Future<Error, T>` — use `.mapRej()` to narrow the error type.

---

## Collections

### List — Singly Linked List

- Use `List<T>` for O(1) prepend and immutable functional sequences.
- Don't append onto linked lists — O(n²). Build with `List.cons(item, list)` + `.reverse()` at the end, or `List.from(arr)`.
- `.head()` returns `Maybe<T>` — always handle `Nothing`.

### TreeMap / TreeSet — Ordered Collections

- Use `TreeMap`/`TreeSet` with explicit comparators for ordered, persistent collections. Replace unordered JS `Map`/`Set` when iteration order matters.
  ```ts
  const map = TreeMap.new<string, number>((x, y) =>
    x > y ? 1
    : x < y ? -1
    : 0
  );
  // Or use stringMap factory / Comparable interface
  const map = stringMap<User>();
  const map = TreeMap.new_<UserId, User>();
  ```
- `.get(key)` returns `Maybe<T>` — always handle `Nothing`.
- Use `.unionWith(other, mergeFn)` for merging with conflict resolution.
- Use `.difference(other)` and `.intersectionWith(other, fn)` for set operations.
- Comparator must return `-1 | 0 | 1`. Boolean won't work.
- `TreeMap` is sorted by comparator, not insertion order.
- `TreeSet`: `.insert()`, `.remove()`, `.union()` mutate in place. Use `TreeSet.from()` to clone first.
- Use `.has()` for O(log n) membership. Don't use `.values().includes()` — that's O(n).

### MVar & BoundedBuffer — Async Coordination

- Use `MVar<T>` for async synchronization. `put(v)` blocks if full, `take()` blocks if empty. Resolves in FIFO order.
- Use `BoundedBuffer<T>` for backpressure queues with max capacity. `enqueue(v)` blocks if full, `dequeue()` blocks if empty.

  ```ts
  const textBuffer = new BoundedBuffer<string>(100);
  const endSignal = MVar.newEmpty<null>();

  model.onToken((token) => {
    textBuffer.enqueue(token);
  });
  model.onDone(() => {
    endSignal.put(null);
  });

  for await (const text of iterable) {
    await ttsService.synthesize(text);
  }
  ```

- Don't use unbounded arrays for streaming — memory leak risk. Don't use boolean flags for "done" state — use `MVar` to block until populated.

---

## Parsing & Validation

### Decoders — Validating Incoming Data

- Never cast `JSON.parse(x) as T`. Validate with a decoder returning `Result<string, T>`.
  ```ts
  const result = Decoder.decode(JSON.parse(input), Decoder.string);
  ```
- Build object decoders with `Decoder.object({ ... })`.
- Use `Decoder.optional()` for fields that may not exist (`V | undefined`).
- Use `Decoder.nullable()` for fields where value may be `null` (`V | null`).
- Use `Decoder.optionalNullable()` for fields that may be absent OR null.
- Use `Decoder.optionalMaybe()` for missing → `Maybe<V>`.
- Use `Decoder.oneOf()` + `Decoder.stringLiteral()` for discriminated JSON unions.
- Always derive types from decoders: `type User = Decoder.Infer<typeof userDecoder>`. Don't cast with `as` after decode.
- Use `.chain()` for version-dependent decoding.
- Use `Decoder.objectMap()` for `{ [key: string]: T }` shapes. Don't use `Decoder.object()` for dynamic keys.

### Encoders — Formatting Output Data

- Use `E.object<T>({...})` for structured serialization.
- Use `E.optional(encoder)` to omit fields when `undefined`.
- Transform inputs with `.rmap(fn)` (contravariant — transforms input before encoding).
  ```ts
  const dateEncoder = E.string.rmap((d: Date) => d.toISOString());
  const userIdEncoder = E.string.rmap((id: UserId) => id.value);
  ```
- Use `E.oneOf<T>(selector)` for dynamic encoder selection.
- Use `E.both(enc1, enc2)` to merge encoder outputs.
- Must call `.run(value)` to execute — `Encoder<A>` is a description, not a result.
- Don't use `E.maybe()` for optional fields — it produces `{ just: V }` structure. Use `E.optional()`.
- `E.EncoderOptional` only works within `E.object()` field definitions.

### Schemas — Bidirectional Mapping

- A `Schema` is a combined `Decoder` + `Encoder`. Build with `s.string.dimap(decode, encode)`.
- Keep schemas as `static schema` on domain classes to prevent serialization drift.
  ```ts
  class MessageId {
    private readonly _tag: null = null;
    constructor(public value: string) {}
    static schema = s.string.dimap(
      (v) => new MessageId(v),
      (id) => id.value
    );
  }
  ```
- Use `s.discriminatedUnion` + `s.variant` for sum types. Always use `as const` on variant discriminants.
  ```ts
  const Message = s.discriminatedUnion([
    s.variant({ type: "error" as const, code: s.number, message: s.string }),
    s.variant({ type: "success" as const, value: s.string })
  ]);
  type Message = s.Infer<typeof Message>;
  ```
- Use `s.optional()` for missing keys. Use `s.nullable()` for present-but-null values. Don't combine into `s.optional(s.maybe(x))` — creates `Maybe<Maybe<T>>`.
