export { Future, type Cancel };

import * as F from "fluture";

import { Result, Success, Failure } from "@/libs/result";
import { FutureInstance } from "fluture";

type Cancel = () => void;

type Fut<E, C> = { [K in keyof C]: Future<E, C[K]> };

class Future<E, T> {
  readonly inner: FutureInstance<E, T>;

  static create<E, T>(f: (r: F.RejectFunction<E>, a: F.ResolveFunction<T>) => Cancel | void): Future<E, T> {
    return new Future(
      F.Future((r, a) => {
        const cancel = f(r, a);
        return cancel === undefined ? () => {} : cancel;
      })
    );
  }

  static createUncancellable<E, T>(f: (r: F.RejectFunction<E>, a: F.ResolveFunction<T>) => void): Future<E, T> {
    return new Future(
      F.Future((r, a) => {
        f(r, a);
        return () => {}; // No-op cancel function
      })
    );
  }

  static resolve<E, T>(x: T): Future<E, T> {
    return new Future(F.resolve(x));
  }

  static reject<E, T>(x: E): Future<E, T> {
    return new Future(F.reject(x));
  }

  static attemptP<T>(f: () => Promise<T>): Future<Error, T> {
    return new Future(F.attemptP(f));
  }

  static bracket<E, A, B, C>(acquire: Future<E, A>, release: (_: A) => Future<E, C>, consume: (_: A) => Future<E, B>) {
    return new Future(F.hook(acquire.inner)((x) => release(x).inner)((x) => consume(x).inner));
  }

  static parallel<E, T>(n: number, xs: Array<Future<E, T>>): Future<E, Array<T>> {
    return new Future(F.parallel(n)(xs.map((f) => f.inner)));
  }

  static concurrently<E, C extends { [k: string]: any }>(obj: Fut<E, C>): Future<E, C> {
    const futures: Future<E, Record<string, unknown>>[] = [];

    Object.keys(obj).forEach(<K extends string & keyof C>(key: K) => {
      const fut = obj[key] as Future<E, C[K]>;
      futures.push(fut.map((value) => ({ [key]: value })));
    });

    return Future.parallel(Infinity, futures).map((results) =>
      results.reduce((acc, x) => Object.assign(acc, x), {} as Record<string, unknown>)
    ) as Future<E, C>;
  }

  static mapConcurrently<A, E, T>(f: (_: A) => Future<E, T>, xs: Array<A>): Future<E, Array<T>> {
    return Future.parallel(Infinity, xs.map(f));
  }

  static both<E, A, B>(x: Future<E, A>, y: Future<E, B>): Future<E, [A, B]> {
    return new Future(F.both(x.inner)(y.inner));
  }

  static race<E, T>(x: Future<E, T>, y: Future<E, T>): Future<E, T> {
    return new Future(F.race(x.inner)(y.inner));
  }

  static traverse<A, E, T>(f: (_: A) => Future<E, T>, xs: Array<A>): Future<E, Array<T>> {
    return xs.reduce(
      (acc, x) => acc.chain((ys) => f(x).map((y) => [...ys, y])),
      Future.resolve([]) as Future<E, Array<T>>
    );
  }

  static resolveAfter<E, T>(milliseconds: number, value: T): Future<E, T> {
    return Future.create((_, res) => {
      const timer = setTimeout(() => res(value), milliseconds);
      return function cancel() {
        clearTimeout(timer);
      };
    });
  }

  constructor(inner: FutureInstance<E, T>) {
    this.inner = inner;
  }

  map<W>(f: (_: T) => W): Future<E, W> {
    return new Future(F.map(f)(this.inner));
  }

  mapRej<W>(f: (_: E) => W): Future<W, T> {
    return new Future(F.mapRej(f)(this.inner));
  }

  bimap<F, W>(f: (_: E) => F, g: (_: T) => W): Future<F, W> {
    return this.map(g).mapRej(f);
  }

  chain<W>(f: (_: T) => Future<E, W>): Future<E, W> {
    const g = (x: T): FutureInstance<E, W> => f(x).inner;
    return new Future(F.chain(g)(this.inner));
  }

  chainRej<F>(f: (_: E) => Future<F, T>): Future<F, T> {
    const g = (x: E): FutureInstance<F, T> => f(x).inner;
    return new Future(F.chainRej(g)(this.inner));
  }

  bichain<F, W>(f: (_: E) => Future<F, W>, g: (_: T) => Future<F, W>): Future<F, W> {
    const h = (x: E): FutureInstance<F, W> => f(x).inner;
    const i = (x: T): FutureInstance<F, W> => g(x).inner;
    return new Future(F.bichain(h)(i)(this.inner));
  }

  finally(act: Future<E, void>): Future<E, T> {
    return new Future(F.lastly(act.inner)(this.inner));
  }

  fork(f: (_: E) => void, g: (_: T) => void): Cancel {
    return F.fork(f)(g)(this.inner);
  }

  promise(f: (_: E) => Error): Promise<T> {
    return F.promise(this.mapRej(f).inner);
  }

  promiseR(): Promise<Result<E, T>> {
    const f: Future<never, Result<E, T>> = this.map<Result<E, T>>(Success).chainRej((e) => Future.resolve(Failure(e)));
    return F.promise(f.inner);
  }
}
