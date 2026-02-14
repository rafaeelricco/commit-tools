export {
  type RequestTy,
  type ResponseTy,
  type StreamResponse,
  stream,
  toResponse,
  attemptPR,
  internalServerError,
  forbidden,
  notFound,
  unauthorized,
  badRequest,
};

import * as s from "@/json/schema";

import { json, sse, Response, OnError } from "@/router";
import { Json } from "@/json/types";
import { Endpoint, PlainEndpoint, StreamingEndpoint, CustomEndpoint } from "./endpoint";
import { Result } from "@/result";
import { Future } from "@/future";

const internalServerError = json({
  status: 500,
  content: { error: { message: "Internal Server Error" } },
});

const forbidden = json({
  status: 403,
  content: { error: { message: "Forbidden" } },
});

const notFound = json({
  status: 404,
  content: { error: { message: "Not Found" } },
});

const unauthorized = json({
  status: 401,
  content: { error: { message: "Unauthorized" } },
});

const badRequest = (details: Json) =>
  json({
    status: 400,
    content: { error: { message: "Bad Request", details } },
  });

type ResponseTy<T> =
  T extends PlainEndpoint<any, infer Res> ? Res
  : T extends StreamingEndpoint<any, infer Res> ? StreamResponse<Res>
  : T extends CustomEndpoint<any> ? Response
  : never;

type StreamingFun<T> = (emit: (v: T) => void, onError: OnError) => Future<Error, null>;

class StreamResponse<T> {
  constructor(public stream: StreamingFun<T>) {}
}

function stream<T>(stream: StreamingFun<T>): StreamResponse<T> {
  return { stream };
}

type RequestTy<T> =
  T extends PlainEndpoint<infer Req, any> ? Req
  : T extends StreamingEndpoint<infer Req, any> ? Req
  : T extends CustomEndpoint<infer Req> ? Req
  : never;

function toResponse<T extends Endpoint<any, any>>(endpoint: T, res: ResponseTy<T>): Response {
  return (
    endpoint instanceof PlainEndpoint ? json({ content: s.encode(endpoint.response, res) })
    : endpoint instanceof StreamingEndpoint ? sse({ stream: res.stream })
    : endpoint instanceof CustomEndpoint ? res
    : (endpoint satisfies never)
  );
}

// Attempt a Promise that returns a Result.
// If the promise fails, we return an internal server error.
// Otherwise, the Future succeeds or fails according to the Result's content.
function attemptPR<T>(f: () => Promise<Result<Response, T>>): Future<Response, T> {
  return Future.attemptP(f)
    .mapRej(() => internalServerError)
    .chain(result => result.either<Future<Response, T>>(Future.reject, Future.resolve));
}
