export { Queue, MQueue };

import { List } from "@/libs/list";
import { Maybe, Just, Nothing } from "@/libs/maybe";

// Immutable queue with amortised O(1) push and pop.
class Queue<T> {
  private constructor(
    public readonly length: number,
    private front: List<T>,
    private back: List<T>,
  ) {}

  static new<T>(): Queue<T> {
    return new Queue(0, List.empty(), List.empty());
  }

  static fromArray<T>(xs: T[]): Queue<T> {
    let queue = Queue.new<T>();
    for (const x of xs) {
      queue = queue.enqueue(x);
    }
    return queue;
  }

  isEmpty(): boolean {
    return this.length == 0;
  }

  toArray(): T[] {
    return this.front.toArray().concat(this.back.toArray().reverse());
  }

  // Add to the back of the queue
  enqueue(v: T): Queue<T> {
    return new Queue(this.length + 1, this.front, List.cons(v, this.back));
  }

  // Take from the front of the queue
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

    return this.front
      .head()
      .unwrap(reverseBack, v => Just([v, new Queue(this.length - 1, this.front.tail(), this.back)]));
  }
}

// Mutable queue with amortised O(1) enqueue and dequeue.
class MQueue<T> {
  private constructor(private queue: Queue<T>) {}

  static new<T>(): MQueue<T> {
    return new MQueue(Queue.new());
  }

  static fromArray<T>(xs: T[]): MQueue<T> {
    return new MQueue(Queue.fromArray(xs));
  }

  isEmpty(): boolean {
    return this.queue.isEmpty();
  }

  toArray(): T[] {
    return this.queue.toArray();
  }

  get length(): number {
    return this.queue.length;
  }

  // Add to the back of the queue
  enqueue(v: T): void {
    this.queue = this.queue.enqueue(v);
  }

  // Take from the front of the queue
  dequeue(): Maybe<T> {
    return this.queue.dequeue().unwrap(
      () => Nothing<T>(),
      ([v, queue]) => {
        this.queue = queue;
        return Just(v);
      },
    );
  }
}
