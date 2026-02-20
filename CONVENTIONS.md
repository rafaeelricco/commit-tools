# Conventions

This file describes preferred practices for code in this codebase. The goal is write code you can only read the type definitions and understand what it does. No need to read the implementation logics and also seize the benefits of run time type checking.

The spirit of the guide is to favour:

- Static over dynamic type checking
- Explicit over implicit data flow
- Immutable over mutable
- Pure over effectful
- Composition over inheritance
- Exhaustive pattern matching over default cases
- Monadic error handling (Result, Maybe, Future) over exceptions (try-catch, throw)
- Strict generics over implicit any
- Typed values over raw primitives

## 1. Guiding Principles & Type Design

### Branded types

Prefer the branded implementation which has the hidden readonly field and the value field.

```typescript
// Bad
type MyId = string & { __brand: "PointId" };
// Issues: name collisions possible, intellisense shows __brand, any string can be assigned without a constructor.

// Good
class MyId {
  // @ts-expect-error _tag's existence prevents structural comparison
  private readonly _tag: null = null;
  constructor(public value: string) {}
}
```

This class implementation has a few advantages over intersections:

- No name collision.
- No non-existent `__brand` property shown through intellisense.
- It limits the operations you can perform on the type.
- You can conveniently add type-specific methods, like `MyId.schema`.

### Discriminated unions

Make invalid states unrepresentable. Optional properties aren't inherently bad, but when multiple optionals create invalid combinations, use discriminated unions instead.

```tsx
// Bad Pattern
interface State {
  status: "loading" | "error" | "success";
  error?: Error;
  data?: { id: string };
}

// Good Pattern
type State = { status: "loading" } | { status: "error"; error: Error } | { status: "success"; data: { id: string } };
```

This ensures impossible states become unrepresentable at the type level, preventing bugs. Exhaustive checking in switch statements forces you to handle all cases logically.

### Exhaustive pattern matching

When using `switch` on discriminated unions, include a default case with the `never` type. This ensures that if a new variant is added to the union, the compiler forces you to handle it.

```tsx
function createChatModel(config: LLMConfig) {
  switch (config.provider) {
    case "anthropic":
      return new ChatAnthropic(config);
    case "openai":
      return new ChatOpenAI(config);
    case "google-genai":
      return new ChatGoogleGenerativeAI(config);
    default: {
      const _exhaustiveCheck: never = config;
      throw new Error(`Unknown provider: ${JSON.stringify(_exhaustiveCheck)}`);
    }
  }
}
```

### Avoid empty objects

Avoid creating "valid" objects that represent an empty state (e.g., `ConversationId.empty()`). This conflates "ID exists" with "ID is missing". Use the Maybe monad to represent absence.

```tsx
// Bad Pattern
const id = ConversationId.empty();
if (id.value === "") { ... }

// Good Pattern
const id: Maybe<ConversationId> = Nothing();
```

### Prefer `as const` over enums

Avoid TypeScript `enum`. Numeric enums generate unexpected reverse mappings, and string enums behave nominally, preventing structural compatibility. Instead, use `as const` objects.

```tsx
// Bad Pattern
enum PackStatus {
  Draft = "Draft",
  Approved = "Approved"
}

// Good Pattern
const PackStatus = {
  Draft: "Draft",
  Approved: "Approved",
  Shipped: "Shipped"
} as const;

type PackStatus = (typeof PackStatus)[keyof typeof PackStatus];
```

For new code, use `as const` objects. Legacy enums can be refactored when making localized changes.

---

### Return types

When declaring functions on the top-level of a module, declare their return types. Exceptions: components returning JSX do not need explicit return types.

```tsx
// Good Pattern
const myFunc = (): string => {
  return "hello";
};
```

Explicitly declaring return types documents contracts, aids future refactoring, and ensures TypeScript catches breaking type changes.

### Strict generics

Avoid `any`. Generic functions should preserve type information through the call chain.

```tsx
// Bad Pattern
function parse(data: any): any {
  return data.result;
}

// Good Pattern
function parse<T>(data: { result: T }): T {
  return data.result;
}
```

Strict generics preserve information routing and generate compile-time errors instead of runtime failures.

---

### Domain-Driven Type Modeling

By combining branded types, discriminated unions, and schemas, we can build a rock-solid domain model where impossible states are entirely unrepresentable.

#### 1. Entity Identifiers

These are the fundamental building blocks for identity. By co-locating the `schema` as a static property, we ensure they serialize and deserialize natively across the network/database boundary.

```tsx
class MessageId {
  static schema = idSchema(this);
  readonly _tag: "MessageId";
}
class ConversationId {
  static schema = idSchema(this);
  readonly _tag: "ConversationId";
}
class AgencyId {
  static schema = idSchema(this);
  readonly _tag: "AgencyId";
}

class PropertyId {
  static schema = idSchema(this);
  readonly _tag: "PropertyId";
}
class DraftId {
  static schema = idSchema(this);
  readonly _tag: "DraftId";
}
```

#### 2. Explicit Message Structures

When modeling complex, varied data structures like LLM outputs or conversational events, use explicit discriminated unions instead of giant bags of optional properties.

For example, representing rich content streams inside an Assistant message:

```tsx
const schema_AgentExecutionTrace = s.discriminatedUnion([
  s.variant({
    type: "text",
    text: s.string
  }),
  s.variant({
    type: "tool_call",
    name: s.string,
    input: s.json,
    result: schema_Result(schema_Error, s.json)
  }),
  s.variant({
    type: "error",
    message: s.string,
    code: s.optional(s.string)
  })
]);
```

The underlying document models can similarly be structured via unions, capturing the exact shape required per variant without ambiguous metadata:

```tsx
const schema_MessageChannel = s.stringEnum(["text", "voice"] as const);

const schema_ConversationEvents = s.discriminatedUnion([
  // 1. User Message
  s.variant({
    type: "user_message",
    id: MessageId.schema,
    conversationId: ConversationId.schema,
    createdAt: schema_Timestamp,
    content: s.string,
    inputMode: schema_MessageChannel
  }),

  // 2. Assistant Message
  s.variant({
    type: "assistant_message",
    id: MessageId.schema,
    conversationId: ConversationId.schema,
    createdAt: schema_Timestamp,
    content: s.array(schema_ContentPart),
    metadata: s.object({
      // Telemetry or backend-specific data stored here
    })
  })
]);

export type Message = s.Infer<typeof schema_Message>;
```

#### 3. Immutable State Transitions

When deriving state from interactions, use distinct user actions rather than mutating generic data blobs. This serves as a deterministic source of truth.

If an action relies on external data that can change (like a Property's price), embed an immutable snapshot inside the event:

```tsx
const schema_PropertySnapshot = s.object({
  id: PropertyId.schema,
  title: s.string,
  price: s.string,
  images: s.optional(s.array(s.string))
});

const schema_UserActions = s.discriminatedUnion([
  s.variant({ type: "view_property", property: schema_PropertySnapshot }),
  s.variant({
    type: "start_booking",
    property: schema_PropertySnapshot,
    draftId: DraftId.schema
  }),
  s.variant({ type: "confirm_booking", draftId: DraftId.schema }),
  s.variant({ type: "cancel_booking", draftId: DraftId.schema })
]);
```

#### 4. Co-locating State Machines

Avoid disjointed standalone variables in global stores or top-level containers. If multiple properties only make sense together, group them into focused, union-driven state containers.

**Avoid this:**

```tsx
// Disparate state spread across the component or store
currentConversationId: string;
allMessages: Message[];
isStreaming: boolean;
streamError: Error | null;
activeVoiceConnection: boolean;
```

**Embrace explicit, co-located architecture:**
Bundle the conversation scope so swapping IDs isn't decoupled from transcripts, and explicitly constrain the streaming status into its own state machine type (`Stream<E, R>`).

```tsx
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

// Unified conversation state
interface ActiveConversation {
  id: ConversationId;
  messages: Array<Message>;
  inputMode: UserInput;
  streamingResponse: Stream<Error, string>;
}
```

This guarantees the UI receives deterministically valid combinations. If we are transcribing voice, we fundamentally cannot be editing text simultaneously, because `UserInput` restricts the shape at the compiler level.

---

## 2. Core Functional Primitives

Instead of ad-hoc checks or throwing exceptions, our architecture enforces data wrappers to encode presence/absence, error states, and asynchronous state logic.

### 1. `Maybe` - Representing Absence

Use `Maybe<T>` to represent values that might not exist.

- Instead of returning `null` or `undefined`, return `Just(value)` or `Nothing()`.
- Unrepresentable States: Never assume non-empty. Enforce exhaustiveness via pattern matching:
  ```typescript
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
- **Combinators**: Use `.map()`, `.chain()` (flatMap), `.withDefault(fallback)`, and `.unwrap(onNothing, onJust)`.
- Use `fromNullable()` and `fromOptional()` at system boundaries.

#### Usage Patterns

#### Creating Maybe values

```typescript
// Bad - using null directly
const user: User | null = findUser(id);
if (user !== null) {
  /* use user */
}

// Good - using Just/Nothing constructors (callable without new)
const user: Maybe<User> = findUser(id) ? Just(foundUser) : Nothing();
```

**Rationale:** Maybe types are self-documenting. The type signature `Maybe<User>` communicates optionality, while `User | null` requires checking implementation.

#### Pattern matching with instanceof

```typescript
// Bad - using isJust/isNothing (loses type narrowing)
if (maybeUser.isJust()) {
  console.log(maybeUser.value); // Type error
}

// Good - instanceof for exhaustive pattern matching
switch (true) {
  case maybeUser instanceof Just:
    console.log(maybeUser.value);
    break;
  case maybeUser instanceof Nothing:
    console.log("No user found");
    break;
  default:
    maybeUser satisfies never;
}
```

**Rationale:** `instanceof` narrows the type, giving access to `value`. The `satisfies never` ensures all cases are handled.

#### Transforming with map

```typescript
// Bad - unwrap, transform, rewrap
const name = maybeUser instanceof Just ? Just(maybeUser.value.name) : Nothing();

// Good - use map
const name = maybeUser.map((user) => user.name);
```

#### Chaining operations (flatMap)

```typescript
// Bad - nested map creating Maybe<Maybe<T>>
const dept: Maybe<Maybe<Department>> = maybeUser.map((user) => findDepartment(user.departmentId));

// Good - chain flattens the nested Maybe
const dept: Maybe<Department> = maybeUser.chain((user) => findDepartment(user.departmentId));
```

#### Providing default values

```typescript
// Good - withDefault for simple defaults
const name = maybeUser.map((u) => u.name).withDefault("Anonymous");

// Good - maybe for default with transformation in one step
const greeting = maybeUser.maybe("Hello, stranger", (user) => `Hello, ${user.name}`);
```

#### Alternative values with alt

```typescript
// Good - alt chains fallbacks
const user = primaryUser.alt(secondaryUser).alt(defaultUser);
```

#### Converting from nullable/optional at boundaries

```typescript
const maybe = fromNullable(nullableValue); // for null
const maybe = fromOptional(undefinedValue); // for undefined
```

#### Filtering arrays with catMaybes and mapMaybe

```typescript
// catMaybes removes Nothings and extracts values
const users = catMaybes(results);

// mapMaybe combines map and filter
const adults = mapMaybe(users, (user) => (user.age >= 18 ? Just(user) : Nothing()));
```

#### Common Mistakes

- **Using `isJust()`/`isNothing()` for control flow**: These methods don't narrow types. Use `instanceof`.
- **Double-wrapping with `map`**: If your function returns `Maybe<T>`, use `chain`, not `map`.
- **Using `expect` in non-invariant cases**: `expect` throws. Use `withDefault` or `maybe` for recoverable absence.
- **Mixing null and undefined**: `fromNullable` only handles `null`. `fromOptional` only handles `undefined`.

---

### 2. `Result` - Typed Error Handling

Use `Result<E, T>` for fallible operations.

- Avoid Exceptions: Never `throw` an error unless it is a catastrophic programmer bug. Return `Failure(error)` instead of throwing.
- Exhaustive Checking: Handle both paths with `.either(onError, onSuccess)`.
- **Combinators**: Short-circuit execution natively with `.chain()` passing only `Success` down the chain. Transform success values with `.map()` and errors with `.mapFailure()`.

#### Usage Patterns

#### Creating Results

```typescript
// Good - callable constructors (no new needed)
const success = Success<string, number>(42);
const failure = Failure<string, number>("validation failed");
```

#### Pattern Matching with either()

```typescript
// Good - exhaustive fold
const handle = (result: Result<Error, User>): string =>
  result.either(
    (e) => e.message, // failure case
    (user) => user.name // success case
  );
```

#### Chaining Dependent Operations

```typescript
// Good - monadic chain short-circuits on first Failure
parseJson(input).chain(validate).chain(transform);
```

#### Transforming with map vs chain

```typescript
// map for pure transformations (T) => W
const doubled = Success<string, number>(21).map((n) => n * 2);

// chain for fallible transformations (T) => Result<E, W>
const result = getUser(id).chain(validateUser);
```

#### Error transformation with mapFailure

```typescript
const domainResult: Result<DomainError, User> = httpResult.mapFailure((httpErr) => ({
  code: httpErr.status,
  message: httpErr.body,
  original: httpErr
}));
```

#### Common Mistakes

- **Using `unwrap` carelessly**: `unwrap` throws on Failure. Use only at boundaries.
- **Mixing Result with exceptions**: Don't `try/catch` around Result operations.
- **`traverse` vs `traverse_`**: `traverse` works with `List`, `traverse_` with `Array`.
- **Forgetting short-circuit semantics**: `chain` and `traverse` stop on first Failure.

---

### 3. `RemoteData` - UI State Machine

Use `RemoteData<E, T>` to model the exact status of asynchronous UI actions or network requests.

- Prevent Impossible Combinations: Replacing three unstructured booleans (`loading`, `error`, `success`) avoids bugs like `loading=true` AND `error!=null`.
- **States**: `NotAsked()`, `Loading({ ...progress })`, `Failed(error)`, and `Ready(value)`.
- Map over `Ready` values using `.map()` while preserving `Loading`/`Failed` states.

#### Usage Patterns

#### Creating RemoteData instances

```typescript
// Bad - boolean flags allowing impossible states
type UserState = { user: User | null; loading: boolean; error: Error | null };

// Good - explicit state representation
type UserState = RemoteData<ApiError, User>;

const initial = NotAsked<ApiError, User>();
const loading = Loading<ApiError, User>();
const failed = Failed<ApiError, User>(new ApiError("Not found"));
const ready = Ready<ApiError, User>(user);
```

#### Pattern matching with instanceof

```typescript
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

#### Mapping and chaining

```typescript
// map transforms only Ready state
const displayName: RemoteData<E, string> = state.map((user) => `${user.firstName} ${user.lastName}`);

// chain sequences RemoteData operations
const posts: RemoteData<ApiError, Post[]> = userState.chain((user) => fetchPosts(user.id));
```

#### Common Mistakes

- **Checking `isReady` without `instanceof`**: Boolean flags don't narrow types.
- **Using `NotAsked` as "no data"**: `NotAsked` means "haven't asked yet". For "asked but empty", use `Ready([])`.
- **Double-wrapping with `map`**: Use `chain` for `RemoteData`-returning functions.

---

### 4. `Future` - Lazy Async Computation

Use `Future<E, T>` instead of `Promise` for predictable, cancelable, and lazily evaluated async flows.

- **Lazy**: Unlike Promises, `Future` does not execute until `.fork(onError, onSuccess)` is called.
- **Initialization**: Create instances via `Future.create` (supplying cancel mechanics) or `Future.attemptP(promiseFn)` (though this loses explicit cancellation).
- **Control flow**: Flatten nested asynchronous chains with `.chain()` instead of callback hell. Use `Future.bracket()` for guaranteed resource cleanup (locks, file descriptors, DB connections) mimicking `try/finally`.
- **Concurrency**: Use `Future.parallel(limit, futures)` to regulate concurrency without flooding APIs. `both()` paired with `.fork` cancels early on sequential rejections.

---

#### Usage Patterns

#### Creating Futures with create()

```typescript
// Bad - attemptP for non-Promise async (loses cancellation)
const future = Future.attemptP(async () => {
  return new Promise((resolve) => setTimeout(() => resolve(42), 1000));
});

// Good - create with cancellation support
const future = Future.create<never, number>((reject, resolve) => {
  const timer = setTimeout(() => resolve(42), 1000);
  return () => clearTimeout(timer);
});
```

#### Uncancellable vs Cancellable

```typescript
// Good - use createUncancellable for inherently uncancellable ops
const future = Future.createUncancellable<never, Data>((reject, resolve) => {
  fetchData().then(resolve).catch(reject);
});
```

#### Avoid double-wrapping Promises

```typescript
// Bad
Future.attemptP(async () => {
  const r = await someAsyncFunction();
  return r;
});

// Good - wrap Promise directly
Future.attemptP(() => someAsyncFunction());
```

#### Chaining async operations

```typescript
fetchUser(id)
  .chain((user) => fetchPosts(user.id).map((posts) => ({ user, posts })))
  .fork(handleError, ({ user, posts }) => render(user, posts));
```

#### Parallel execution

```typescript
// parallel with concurrency limit
const users = Future.parallel(5, ids.map(fetchUser));

// named concurrent operations
const result = Future.concurrently({
  user: fetchUser(userId),
  posts: fetchPosts(userId),
  settings: fetchSettings(userId)
});
```

#### Recovery with chainRej

```typescript
future.chainRej((error) => (error.code === 404 ? Future.resolve(defaultValue) : Future.reject(error)));
```

#### Resource management with bracket

```typescript
Future.bracket(
  acquireConnection(), // acquire
  (conn) => releaseConnection(conn), // release (always runs)
  (conn) => useConnection(conn) // consume
);
```

#### Timeout with race

```typescript
const result = Future.race(
  longOperation(),
  Future.resolveAfter<OperationError, never>(5000, null).chain(() => Future.reject(new TimeoutError()))
);
```

#### Converting to Promise

```typescript
const result = await future.promise((e) => new Error(String(e.message)));
```

#### Common Mistakes

- **Forgetting Futures are lazy**: Nothing executes until `fork` is called.
- **Ignoring the cancel function**: `fork` returns a cancel function. Store it if cancellation is needed.
- **Using `attemptP` for cancellable ops**: Prefer `create`. `attemptP` loses cancellation semantics.
- **Confusing `mapRej` and `chainRej`**: `mapRej` transforms error but stays rejected. `chainRej` can recover.
- **Error type widening with `attemptP`**: Always produces `Future<Error, T>`. Use `mapRej` to narrow.

---

## 3. Persistent Collections & Concurrency

Avoid native `Map`, `Set`, and mutable recursive Arrays when functional semantics are strictly needed or iterations run excessively deep.

### `List` - The Singly Linked List

Use `List<T>` for O(1) prepends and immutable functional sequences.

- Avoid appending onto linked lists because it operates in O(n^2). Build lists functionally using O(1) prepend `List.cons(item, list)` applying `.reverse()` at the end, or generate from native arrays utilizing `List.from(arr)`.
- Safe Retrieval: Always access lists via `.head()` knowing it enforces a `Maybe<T>` return to avoid crash exceptions.

### Ordered Collections (`TreeMap` / `TreeSet`)

Utilize BTree-wrapped persistent representations replacing un-ordered JS Maps to maintain structured iteration priorities and typed interactions.

- Utilize constructors with deterministic string comparators efficiently: `TreeSet.new<number>((a, b) => a - b)`. Domain instances can implement `Comparable` and spawn structured wrappers internally.
- Use boolean properties effectively mapping logic internally without creating deep loops `.intersectionWith()`, `union()`, `difference()`.

#### Usage Patterns

#### Creating Maps with explicit comparators

```typescript
const map = TreeMap.new<string, number>((x, y) =>
  x > y ? 1
  : x < y ? -1
  : 0
);

// Or use stringMap factory
const map = stringMap<User>();

// Or use Comparable interface
const map = TreeMap.new_<UserId, User>();
```

#### Handling Maybe from get()

```typescript
const result = map.get(key);
if (result instanceof Just) {
  console.log(result.value);
}
```

#### Merging with conflict resolution

```typescript
const merged = map1.unionWith(map2, (old, new_) => old + new_);
map.setWith("count", 1, (old, _new) => old + _new);
```

#### Set operations

```typescript
const keysOnlyInA = mapA.difference(mapB);
const common = mapA.intersectionWith(mapB, (a, b) => ({ left: a, right: b }));
```

#### Common Mistakes

- **Forgetting comparator returns -1/0/1**: Boolean won't work.
- **Ignoring `Maybe` from `get()`**: Always handle `Nothing`.
- **Assuming insertion order**: TreeMap is always sorted by comparator.

---

#### Usage Patterns

#### Creating TreeSets

```typescript
// With explicit comparator
const set = TreeSet.new<number>((a, b) => a - b);

// With Comparable interface
const set = TreeSet.new_<Id>();

// From array
const set = TreeSet.from_<Id>(ids);
```

#### Method chaining

```typescript
const set = TreeSet.new<number>((a, b) => a - b)
  .insert(1)
  .insert(2)
  .insert(3);
```

#### Common Mistakes

- **Mutating shared references**: `insert()`, `remove()`, `union()` mutate in place. Use `TreeSet.from()` to clone first.
- **Using `values().includes()` for membership**: O(n). Use `has()` for O(log n) lookup.

---

### Asynchronous Coordination (`MVar` & `BoundedBuffer`)

Use these structures for explicit, state-based coordination of asynchronous operations, rather than relying on raw Promises, flags, or unconstrained arrays.

- **`MVar<T>`**: Inspired by Haskell, a mutable variable that is either full or empty. Ideal for synchronization.
  - `put(v)` blocks if the MVar is already full.
  - `take()` blocks if the MVar is currently empty.
- **`BoundedBuffer<T>`**: An async queue with a maximum capacity (backpressure).
  - `enqueue(v)` blocks if the buffer is full (preventing memory blow-ups).
  - `dequeue()` blocks if the buffer is empty.

#### Usage Patterns

#### Coordinating streams with `MVar` and `BoundedBuffer`

This pattern is highly effective when decoupling a fast producer (like an LLM generating tokens) from a consumer (like a Text-to-Speech service), while enforcing backpressure so memory isn't overwhelmed.

```typescript
// Good - BoundedBuffer for backpressure, MVar for termination signaling
const textBuffer = new BoundedBuffer<string>(100); // Max 100 items
const endSignal = MVar.newEmpty<null>();

// 1. Create an AsyncIterable representing the stream
const iterable: AsyncIterable<string> = {
  [Symbol.asyncIterator]() {
    return {
      async next() {
        return Promise.race([
          textBuffer.dequeue().then((value) => ({ done: false, value })),
          endSignal.take().then(() => ({ done: true, value: undefined }))
        ]);
      }
    };
  }
};

// 2. Producer: asynchronously push items
model.onToken((token) => {
  textBuffer.enqueue(token); // blocks if buffer reaches 100
});
model.onDone(() => {
  endSignal.put(null); // unblocks any pending take()
});

// 3. Consumer: consume the iterable
for await (const text of iterable) {
  await ttsService.synthesize(text);
}
```

#### Common Mistakes

- **Using unconstrained arrays for streaming**: Pushing items into an array without a bound can lead to memory leaks if the producer is much faster than the consumer. Use `BoundedBuffer`.
- **Using boolean flags for "done" state**: A boolean flag requires polling (`setInterval`) to check if a stream has ended. An `MVar` natively blocks until populated, avoiding CPU burn.
- **Forgetting `MVar` fairness**: `MVar` resolves pending operations in FIFO order. If multiple consumers call `take()`, the first one to call it gets the first `put()`.

---

## 4. Safe Boundaries: Parsing & Validation

Our standard avoids magic serialization libraries (`superjson`) and blind `any` casting, preferring granular structural control over external inputs. This section outlines how to use decoders, encoders, and schemas to generate perfectly type-safe code that enforces our domain constraints.

### Decoders: Validating Incoming Data

Type-safe monadic combinators for parsing unknown JSON.

- Never write `const user = JSON.parse(input) as User;`. Validate shape using a decoder returning a `Result<string, T>`.
- Use `Decoder.optional()` for `V | undefined` and `Decoder.nullable()` for `V | null`. Distinguish from `Decoder.optionalNullable()` if a field can be missing OR null.
- Handle discriminated JSON unions powerfully with `Decoder.oneOf()` and `Decoder.stringLiteral()`.
- Always derive Types from Decoder shapes via `type User = Decoder.Infer<typeof userDecoder>`.

#### Usage Patterns

#### Decoding primitives safely

```typescript
// Bad
const data = JSON.parse(input);
const name = data.name; // any

// Good
const result = Decoder.decode(JSON.parse(input), Decoder.string);
// Result<string, string> — must handle both cases
```

#### Building object decoders

```typescript
const userDecoder: Decoder<User> = Decoder.object({
  id: Decoder.number,
  name: Decoder.string,
  email: Decoder.string
});
```

#### Handling optional, nullable, and optionalNullable fields

```typescript
// optional: field may not exist → V | undefined
Decoder.optional(Decoder.string);

// nullable: field exists but value may be null → V | null
Decoder.nullable(Decoder.string);

// optionalNullable: field may be absent OR null
Decoder.optionalNullable(Decoder.string);

// optionalMaybe: field may not exist → Maybe<V>
Decoder.optionalMaybe(Decoder.string);
```

#### Discriminated unions with oneOf and stringLiteral

```typescript
const shapeDecoder: Decoder<Shape> = Decoder.oneOf([
  Decoder.object({
    type: Decoder.stringLiteral("circle"),
    radius: Decoder.number
  }),
  Decoder.object({
    type: Decoder.stringLiteral("rect"),
    width: Decoder.number,
    height: Decoder.number
  })
]);
```

#### Inferring types from decoders

```typescript
const userDecoder = Decoder.object({
  id: Decoder.number,
  name: Decoder.string
});
type User = Decoder.Infer<typeof userDecoder>;
```

#### Sequential decoding with chain

```typescript
const versionedDecoder = Decoder.object({ version: Decoder.number }).chain(({ version }) => {
  switch (version) {
    case 1:
      return v1Decoder;
    case 2:
      return v2Decoder;
    default:
      return Decoder.fail(`Unknown version: ${version}`);
  }
});
```

#### Common Mistakes

- **Forgetting to handle `Result`**: `decode` returns `Result`, not the value.
- **Using `object` for dynamic keys**: Use `objectMap` for `{ [key: string]: T }` shapes.
- **Confusing `optional` vs `nullable`**: `optional` = field may not exist. `nullable` = field exists but value may be `null`.
- **Type assertion after decode**: If decode succeeds, value is already typed. Don't cast with `as`.

---

### Encoders: Formatting Output Data

A contravariant functor enabling reliable serialization of explicit structures back mapping to primitive outputs.

- Transform inputs _before_ encoding with `{Encoder}.rmap(transformFn)`. Example: `E.string.rmap((date: Date) => date.toISOString())`.
- Merge payloads cleanly utilizing `E.both(encoder1, encoder2)`.

#### Usage Patterns

#### Encoding objects

```typescript
const userEncoder = E.object<User>({
  id: E.string,
  name: E.string,
  age: E.number
});
```

#### Optional fields — omit when absent

```typescript
const profileEncoder = E.object<Profile>({
  name: E.string,
  bio: E.optional(E.string)
});
// { name: "Bob" } — no bio field when undefined
```

#### Contravariant mapping with rmap

```typescript
const dateEncoder = E.string.rmap((d: Date) => d.toISOString());
const userIdEncoder = E.string.rmap((id: UserId) => id.value);
```

#### Dynamic encoder selection with oneOf

```typescript
const shapeEncoder = E.oneOf<Shape>((shape) => (shape.type === "circle" ? circleEncoder : rectEncoder));
```

#### Merging encoders with both

```typescript
const combinedEncoder = E.both(baseEncoder, extraEncoder);
combinedEncoder.run([{ id: "1" }, { timestamp: 123 }]);
// { id: "1", timestamp: 123 }
```

#### Common Mistakes

- **Forgetting to call `.run()`**: `Encoder<A>` is a description. Must call `.run(value)` to execute.
- **Using `maybe()` for optional fields**: `maybe()` produces `{ just: V }` structure. For omitting fields, use `optional()`.
- **`rmap` confusion**: `rmap` is contravariant (transforms input). Not covariant.
- **`EncoderOptional` outside `object()`**: Only works within `object()` field definitions.

---

### Schemas: Bidirectional Mapping

A combined bidirectional boundary encapsulating both `Decoder` and `Encoder` in a single construct, ensuring no serialization drift occurs.

- Provide schemas as static members within classes:

  ```typescript
  class MessageId {
    // @ts-expect-error
    private readonly _tag: null = null;
    constructor(public value: string) {}

    static schema = s.string.dimap(
      (v) => new MessageId(v),
      (id) => id.value
    );
  }
  ```

- Make custom types serialize easily bidirectionally natively relying deeply on `Schema.dimap()`.
- Exploit `s.discriminatedUnion` combined with `s.variant` to build fully type-inferred sum-type parsers natively mapped without repeating checks.

#### Usage Patterns

#### Creating object schemas

```typescript
const User = s.object({
  name: s.string,
  age: s.number
});
const decoded = s.decode(User, input);
const encoded = s.encode(User, user);
```

#### Bidirectional transformation with dimap

```typescript
const Timestamp = s.number.dimap(
  (n) => new Date(n), // decode: number → Date
  (d) => d.valueOf() // encode: Date → number
);
```

#### Custom parsing with chain

```typescript
static schema: s.Schema<DateOnly> = s.string.chain(
  (str) => {
    const parts = str.split('-');
    if (parts.length !== 3) return fail('Invalid Date');
    // ...parse and validate
    return always(new DateOnly(year, month, day));
  },
  (date) => date.pretty()
);
```

#### Discriminated unions with variant

```typescript
const Message = s.discriminatedUnion([
  s.variant({
    type: "error" as const,
    code: s.number,
    message: s.string
  }),
  s.variant({
    type: "success" as const,
    value: s.string
  })
]);

type Message = s.Infer<typeof Message>;
```

#### Static schema on classes

```typescript
class POSIX {
  constructor(public readonly value: number) {}

  static schema: s.Schema<POSIX> = s.number.dimap(
    (n) => new POSIX(n),
    (p) => p.value
  );
}
```

#### Common Mistakes

- **Forgetting `as const` on variant discriminants**: `type: 'error'` without `as const` becomes `string`.
- **Using `nullable` for absent fields**: `nullable` expects the key present. Use `optional` for missing keys.
- **Double-wrapping Maybe**: `s.optional(s.maybe(x))` creates `Maybe<Maybe<T>>`. Choose one optionality layer.
- **Schema drift with separate definitions**: Keep schema as static member on the domain class.

---
