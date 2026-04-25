export { MVar };

import { MQueue } from "@/libs/queue";
import { Maybe, Just, Nothing } from "@/libs/maybe";

type Value<T> =
  | { tag: "empty" } //
  | { tag: "full"; value: T }
  | { tag: "in_use" };

/**
 * A mutable variable that is either empty or holds one value of type `A`.
 *
 * Coordinates concurrent operations via FIFO fairness: blocked `put`/`take`/`modify`
 * calls resume in the order they were enqueued, so no waiter is starved.
 *
 * Reach for `MVar` when you need:
 * - a completion/error latch (`MVar<Maybe<Error>>`)
 * - a single-slot mailbox between producer and consumer
 * - atomic mutation of shared state without an external lock (`modify`)
 */
class MVar<A> {
  // Queued writes and modifications are resolved in the order in which they arrive.
  private waitingEmpty: MQueue<[A, () => void]> = MQueue.new();
  private waitingFull: MQueue<(v: A) => Promise<void>> = MQueue.new();
  private value: Value<A>;

  private constructor(initial: Maybe<A>) {
    this.value = initial.maybe<Value<A>>({ tag: "empty" }, (value) => ({ tag: "full", value }));
  }

  /** Create a full `MVar` holding `v`. The first `take` returns immediately; the first `put` blocks until taken. */
  static new<A>(v: A): MVar<A> {
    return new MVar(Just(v));
  }

  /** Create an empty `MVar`. The first `put` returns immediately; the first `take` blocks until populated. */
  static newEmpty<A>(): MVar<A> {
    return new MVar(Nothing());
  }

  private _unblockWaitingFull(x: A): void {
    const r = this.waitingFull.dequeue();
    if (r instanceof Just) {
      this.value = { tag: "in_use" };
      r.value(x); // we trigger the promise, but don't wait.
    } else {
      this.value = { tag: "full", value: x };
    }
  }

  /**
   * Place `v` into the MVar. Resolves once stored.
   * If full or in use, blocks (FIFO) until empty.
   */
  put(v: A): Promise<void> {
    const enqueue = () =>
      new Promise<void>((resolve) => {
        this.waitingEmpty.enqueue([
          v,
          () => {
            this._unblockWaitingFull(v);
            resolve();
          }
        ]);
      });

    switch (this.value.tag) {
      case "empty":
        this._unblockWaitingFull(v);
        return Promise.resolve();
      case "full":
        return enqueue();
      case "in_use":
        return enqueue();
      default:
        return this.value satisfies never;
    }
  }

  /**
   * Non-blocking `put`. Returns `true` if stored, `false` if the MVar
   * was full/in-use (and the value was discarded).
   */
  tryPut(v: A): boolean {
    switch (this.value.tag) {
      case "empty":
        this._unblockWaitingFull(v);
        return true;
      case "full":
        return false;
      case "in_use":
        return false;
      default:
        return this.value satisfies never;
    }
  }

  private _unblockWaitingEmpty(): void {
    this.value = { tag: "in_use" };
    // is there something waiting for it to be emtpy?
    const r = this.waitingEmpty.dequeue();

    if (r instanceof Nothing) {
      // nope, let's just mark it as empty
      this.value = { tag: "empty" };
    } else {
      // hand off to the next pending writer; its trigger closure
      // takes care of placing the value and resolving the put.
      const [, trigger] = r.value;
      trigger();
    }
  }

  /**
   * Remove and return the held value, leaving the MVar empty.
   * If empty or in use, blocks (FIFO) until a value is put.
   */
  take(): Promise<A> {
    const enqueue = () =>
      new Promise<A>((resolve) => {
        this.waitingFull.enqueue((v) => {
          this._unblockWaitingEmpty();
          resolve(v);
          return Promise.resolve();
        });
      });

    switch (this.value.tag) {
      case "empty":
        return enqueue();
      case "full": {
        const value = this.value.value;
        this._unblockWaitingEmpty();
        return Promise.resolve(value);
      }
      case "in_use":
        return enqueue();
      default:
        return this.value satisfies never;
    }
  }

  /**
   * Non-blocking `take`. Returns `Just(v)` if a value was taken,
   * `Nothing()` if the MVar was empty/in-use.
   */
  tryTake(): Maybe<A> {
    switch (this.value.tag) {
      case "empty":
        return Nothing();
      case "full": {
        const value = this.value.value;
        this._unblockWaitingEmpty();
        return Just(value);
      }
      case "in_use":
        return Nothing();
      default:
        return this.value satisfies never;
    }
  }

  /**
   * Atomically transform the held value. `f` receives the current value
   * and returns `[newValue, result]`. The MVar is marked in-use during the
   * call, blocking other consumers.
   *
   * If `f` rejects, the original value is restored — safe under failure.
   */
  async modify<B>(f: (v: A) => Promise<[A, B]>): Promise<B> {
    const resume = async (value: A): Promise<B> => {
      try {
        this.value = { tag: "in_use" };
        const [v, r] = await f(value);
        this._unblockWaitingFull(v);
        return r;
      } catch (e) {
        this._unblockWaitingFull(value); // put value back
        return Promise.reject(e);
      }
    };

    const enqueue = (): Promise<B> => new Promise((resolve, reject) => this.waitingFull.enqueue((value) => resume(value).then(resolve).catch(reject)));

    switch (this.value.tag) {
      case "empty":
        return enqueue();
      case "full":
        return resume(this.value.value);
      case "in_use":
        return enqueue();
      default:
        return this.value satisfies never;
    }
  }

  /** Like `modify`, but `f` returns only the new value; no result is computed. */
  async modify_(f: (v: A) => Promise<A>): Promise<void> {
    return this.modify((v) => f(v).then((x) => [x, undefined]));
  }

  /**
   * Read the held value without removing it.
   * If empty or in use, blocks (FIFO) until a value is put.
   */
  async read(): Promise<A> {
    const v = this.tryRead();
    if (v instanceof Just) {
      return v.value;
    }
    return await this.modify(async (v) => [v, v]);
  }

  /**
   * Non-blocking `read`. Returns `Just(v)` if a value is held,
   * `Nothing()` if the MVar is empty/in-use.
   */
  tryRead(): Maybe<A> {
    switch (this.value.tag) {
      case "empty":
        return Nothing();
      case "full": {
        const value = this.value.value;
        return Just(value);
      }
      case "in_use":
        return Nothing();
      default:
        return this.value satisfies never;
    }
  }
}
