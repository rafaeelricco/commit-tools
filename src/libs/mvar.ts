export { MVar };

import { MQueue } from "@/libs/queue";
import { Maybe, Just, Nothing } from "@/libs/maybe";

type Value<T> =
  | { tag: "empty" } //
  | { tag: "full"; value: T }
  | { tag: "in_use" };

/*
  A mutable variable that can be full or empty.
  Use state-based coordination of concurrent operations. e.g. block until a condition is true/false.
  MVars are fair. Puts and takes are resolved in the order in which they were made.

  Trying to put on a full MVar blocks until the MVar is empty.
  Trying to take on an empty MVar blocks until the MVar is full.
*/
class MVar<A> {
  // Queued writes and modifications are resolved in the order in which they arrive.
  private waitingEmpty: MQueue<[A, () => void]> = MQueue.new();
  private waitingFull: MQueue<(v: A) => Promise<void>> = MQueue.new();
  private value: Value<A>;

  private constructor(initial: Maybe<A>) {
    this.value = initial.maybe<Value<A>>({ tag: "empty" }, (value) => ({ tag: "full", value }));
  }

  static new<A>(v: A): MVar<A> {
    return new MVar(Just(v));
  }

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

  // Put a value into an empty MVar.
  // If the MVar is full, it blocks until it becomes empty.
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

  // Like put, but doesn't block.
  // Returns whether the put was successful or not.
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
      // yes, there is a new value here.
      const [newVal, trigger] = r.value;
      trigger();
      this._unblockWaitingFull(newVal);
    }
  }

  // Take the value in the MVar, leaving it empty.
  // If the MVar is empty, it blocks until it becomes full.
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

  // Like take, but doesn't block.
  // Returns whether the take was successful or not.
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

  // Modify the value in the MVar. Allows returning a value in the computation too.
  // If the MVar is empty, it blocks until it becomes full.
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

  /* Like 'modify' but without returning a value.
   */
  async modify_(f: (v: A) => Promise<A>): Promise<void> {
    return this.modify((v) => f(v).then((x) => [x, undefined]));
  }

  // Get the value of the MVar without removing it.
  async read(): Promise<A> {
    const v = this.tryRead();
    if (v instanceof Just) {
      return v.value;
    }
    return await this.modify(async (v) => [v, v]);
  }

  // Like read, but doesn't block.
  // Returns the value if the MVar was full.
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
