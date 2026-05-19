import { type Future } from "@/libs/future";

export const runFuture = <E, T>(future: Future<E, T>): Promise<T> => future.promise((e) => (e instanceof Error ? e : new Error(String(e))));
