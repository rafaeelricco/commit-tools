export { Queue, MQueue };

import { List } from "@/libs/list";
import { Maybe, Just, Nothing } from "@/libs/maybe";

/**
 * Immutable queue with amortised O(1) enqueue and dequeue.
 *
 * Implemented as two singly-linked lists: a `front` list for dequeues
 * and a `back` list for enqueues. When the front empties, the back is
 * reversed in place to become the new front — at most once per element
 * across the queue's lifetime, giving amortised constant time.
 *
 * Use `Queue<T>` for persistent queues that can be safely shared across
 * async boundaries. For in-place mutation, prefer `MQueue<T>`.
 */
class Queue<T> {
  private constructor(
    public readonly length: number,
    private front: List<T>,
    private back: List<T>
  ) {}

  /** Create an empty queue. */
  static new<T>(): Queue<T> {
    return new Queue(0, List.empty(), List.empty());
  }

  /** Create a queue containing the elements of `xs`, preserving order. */
  static fromArray<T>(xs: T[]): Queue<T> {
    let queue = Queue.new<T>();
    for (const x of xs) {
      queue = queue.enqueue(x);
    }
    return queue;
  }

  /** True when the queue contains no elements. */
  isEmpty(): boolean {
    return this.length == 0;
  }

  /** Return the queue's elements as an array, front to back. */
  toArray(): T[] {
    return this.front.toArray().concat(this.back.toArray().reverse());
  }

  /** Return a new queue with `v` added to the back. */
  enqueue(v: T): Queue<T> {
    return new Queue(this.length + 1, this.front, List.cons(v, this.back));
  }

  /**
   * Remove the front element. Returns `Just([v, rest])` with the front
   * value and the remaining queue, or `Nothing()` if empty.
   */
  dequeue(): Maybe<[T, Queue<T>]> {
    // Here, if the front of the queue is empty we reverse
    // the back and make it the front. This is how we achieve
    // amortised O(1) time.
    const reverseBack = (): Maybe<[T, Queue<T>]> => {
      const front = this.back.reverse();
      if (front.isEmpty()) return Nothing();
      const queue = new Queue(this.length, front, List.empty());
      return queue.dequeue();
    };

    return this.front.head().unwrap(reverseBack, (v) => Just([v, new Queue(this.length - 1, this.front.tail(), this.back)]));
  }
}

/**
 * Mutable wrapper around `Queue<T>` with amortised O(1) enqueue and dequeue.
 *
 * Used internally by `MVar` to track waiters. Reach for it directly when a
 * local producer/consumer needs in-place mutation without threading a new
 * queue value through every call site.
 */
class MQueue<T> {
  private constructor(private queue: Queue<T>) {}

  /** Create an empty mutable queue. */
  static new<T>(): MQueue<T> {
    return new MQueue(Queue.new());
  }

  /** Create a mutable queue containing the elements of `xs`, preserving order. */
  static fromArray<T>(xs: T[]): MQueue<T> {
    return new MQueue(Queue.fromArray(xs));
  }

  /** True when the queue contains no elements. */
  isEmpty(): boolean {
    return this.queue.isEmpty();
  }

  /** Return the queue's elements as an array, front to back. */
  toArray(): T[] {
    return this.queue.toArray();
  }

  /** Number of elements currently in the queue. */
  get length(): number {
    return this.queue.length;
  }

  /** Add `v` to the back of the queue. */
  enqueue(v: T): void {
    this.queue = this.queue.enqueue(v);
  }

  /**
   * Remove and return the front element. Returns `Just(v)` if a value
   * was removed, `Nothing()` if the queue was empty.
   */
  dequeue(): Maybe<T> {
    return this.queue.dequeue().unwrap(
      () => Nothing<T>(),
      ([v, queue]) => {
        this.queue = queue;
        return Just(v);
      }
    );
  }
}
