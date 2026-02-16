export {
  type RemoteData,
  CallableSuccess as Ready,
  CallableFailure as Failed,
  CallableNotAsked as NotAsked,
  CallableLoading as Loading,
};

import { Nullable, Maybe, Nothing, Just } from '@/libs/maybe';
import Callable from '@/libs/callable';

type RemoteData<E, T> =
  | NotAsked<E, T>
  | Loading<E, T>
  | Failed<E, T>
  | Ready<E, T>;

interface IRemoteData<E, T> {
  map<W>(f: (t: T) => W): RemoteData<E, W>;
  chain<W>(f: (t: T) => RemoteData<E, W>): RemoteData<E, W>;
  unwrapFailure<W>(def: W, f: (e: E) => W): W;
  toMaybe(): Maybe<T>;
  readonly isLoading: boolean;
  readonly isReady: boolean;
  readonly isFailed: boolean;
}

class NotAsked<E, T> implements IRemoteData<E, T> {
  // @ts-expect-error Unused _tag's existence prevents structural comparison
  private readonly _tag: null = null;
  static new<E, T>(): NotAsked<E, T> {
    return new NotAsked();
  }
  map<W>(_: (t: T) => W): RemoteData<E, W> {
    return new NotAsked();
  }
  chain<W>(_: (t: T) => RemoteData<E, W>) {
    return new NotAsked<E, W>();
  }
  unwrapFailure<W>(def: W, _: (e: E) => W): W {
    return def;
  }
  toMaybe(): Maybe<T> {
    return Nothing();
  }
  readonly isLoading = false;
  readonly isReady = false;
  readonly isFailed = false;
}

type Bytes = number;

type LoadingDetails = {
  uploaded: Bytes;
  uploadSize: Nullable<Bytes>;
  downloaded: Bytes;
  downloadSize: Nullable<Bytes>;
};

class Loading<E, T> implements IRemoteData<E, T> {
  // @ts-expect-error Unused _tag's existence prevents structural comparison
  private readonly _tag: null = null;
  readonly uploaded: Bytes;
  readonly uploadSize: Nullable<Bytes>;
  readonly downloaded: Bytes;
  readonly downloadSize: Nullable<Bytes>;
  constructor(details: Nullable<LoadingDetails> = null) {
    this.uploaded = details?.uploaded ?? 0;
    this.uploadSize = details?.uploadSize ?? null;
    this.downloaded = details?.downloaded ?? 0;
    this.downloadSize = details?.downloadSize ?? null;
  }

  static new<E, T>(details: Nullable<LoadingDetails> = null): Loading<E, T> {
    return new Loading(details);
  }

  map<W>(_: (t: T) => W): RemoteData<E, W> {
    return new Loading();
  }
  chain<W>(_: (t: T) => RemoteData<E, W>) {
    return new Loading<E, W>();
  }
  unwrapFailure<W>(def: W, _: (e: E) => W): W {
    return def;
  }
  toMaybe(): Maybe<T> {
    return Nothing();
  }
  readonly isLoading = true;
  readonly isReady = false;
  readonly isFailed = false;
}

class Failed<E, T> implements IRemoteData<E, T> {
  // @ts-expect-error Unused _tag's existence prevents structural comparison
  private readonly _tag: null = null;
  readonly error: E;
  static new<E, T>(e: E): Failed<E, T> {
    return new Failed(e);
  }
  constructor(e: E) {
    this.error = e;
  }
  map<W>(_: (t: T) => W): RemoteData<E, W> {
    return new Failed(this.error);
  }
  chain<W>(_: (t: T) => RemoteData<E, W>) {
    return new Failed<E, W>(this.error);
  }
  unwrapFailure<W>(_: W, f: (e: E) => W): W {
    return f(this.error);
  }
  toMaybe(): Maybe<T> {
    return Nothing();
  }
  readonly isLoading = false;
  readonly isReady = false;
  readonly isFailed = true;
}

class Ready<E, T> implements IRemoteData<E, T> {
  // @ts-expect-error Unused _tag's existence prevents structural comparison
  private readonly _tag: null = null;
  static new<E, T>(v: T): Ready<E, T> {
    return new Ready(v);
  }
  readonly value: T;
  constructor(v: T) {
    this.value = v;
  }
  map<W>(f: (t: T) => W): RemoteData<E, W> {
    return new Ready(f(this.value));
  }
  chain<W>(f: (t: T) => RemoteData<E, W>) {
    return f(this.value);
  }
  unwrapFailure<W>(def: W, _: (e: E) => W): W {
    return def;
  }
  toMaybe(): Maybe<T> {
    return Just(this.value);
  }
  readonly isLoading = false;
  readonly isReady = true;
  readonly isFailed = false;
}

var CallableNotAsked = Callable(NotAsked) as typeof NotAsked &
  typeof NotAsked.new;

var CallableLoading = Callable(Loading) as typeof Loading & typeof Loading.new;

var CallableFailure = Callable(Failed) as typeof Failed & typeof Failed.new;

var CallableSuccess = Callable(Ready) as typeof Ready & typeof Ready.new;
