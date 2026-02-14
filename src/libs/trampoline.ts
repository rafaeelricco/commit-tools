export { type Trampoline, tailRecursive, end, fix };

type Trampoline<A> = End<A> | Rec<A>;

function run<A>(tramp: Trampoline<A>): A {
  let result: Trampoline<A> = tramp;
  while (result instanceof Rec) {
    result = result.fun();
  }

  return result.value;
}

const rec = <A>(f: () => Trampoline<A>): Trampoline<A> => new Rec(f);

const end = <A>(v: A): Trampoline<A> => new End(v);

class End<A> {
  value: A;
  constructor(v: A) {
    this.value = v;
  }
  run(): A {
    return run(this);
  }
  map<B>(f: (v: A) => B): Trampoline<B> {
    return end(f(this.value));
  }
}

class Rec<A> {
  fun: () => Trampoline<A>;
  constructor(f: () => Trampoline<A>) {
    this.fun = f;
  }
  run(): A {
    return run(this);
  }
  map<B>(f: (v: A) => B): Trampoline<B> {
    const v = this.fun();
    return rec(() => v.map(f));
  }
}

type Fun<A extends unknown[], B> = (...args: A) => B;

function fix<A extends unknown[], R>(
  f: Fun<
    [Fun<A, Trampoline<R>>, (r: R) => Trampoline<R>],
    Fun<A, Trampoline<R>>
  >
): Fun<A, R> {
  let lazy_f: Fun<A, Trampoline<R>> = (..._: A) => {
    throw new Error('recursion error');
  };
  const recurse: Fun<A, Trampoline<R>> = (...args: A) =>
    rec(() => lazy_f(...args));
  lazy_f = f(recurse, end);
  return (...args: A) => lazy_f(...args).run();
}

function tailRecursive<A extends unknown[], R>(
  f: Fun<A, Trampoline<R>>
): Fun<A, Trampoline<R>> {
  return (...args: A) => rec(() => f(...args));
}
