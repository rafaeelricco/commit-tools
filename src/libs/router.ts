// A library for making express.js routes pure.
//
// It's a simple idea. A route handler is a function that takes a request
// and a request environment and returns a response.
//
//    function myHandler(req: Request, env: T) : Promise<Response>
//
// As you can see, the environment can be any type specified by the handler.
// This will allow for type-safe middlewares as the compiler will ensure that
// we do not use handlers with invalid environments.
// Things like session information should live in the environment.
//
// Middlewares are functions that take a request and an environment and
// return a different environment.
//
//    function myMiddleware(req: Request, env: T1) : Promise<MiddlewareResponse<T2>>
//
// This is how you 'modify' an environment. There is no real modification because
// everything should be immutable.
//
export {
  type Response,
  type Request,
  route,
  middleware,

  // responses
  redirect,
  render,
  json,
  sse,

  // classes for type checking
  type JSON,
  type SSE,

  // SSE types
  type SendMessage,
  type OnError
};

import * as express from "express";
import { Cancel, Future } from "@/libs/future";

type Json = null | string | number | boolean | JsonArray | JsonObject;
type JsonObject = { [x: string]: Json };
type JsonArray = Array<Json>;

// A route is a request handler that returns a success response
// or a failure response.
type Route<T> = (req: express.Request, env: T) => Future<Response, Response>;

// We use express.js objects for the request, but we will not mutate them.
// Instead we will add things to the environment, which is passed alogside
// the request.
type Request = express.Request;

// Responses

type Headers = Record<string, string>;

class JSON {
  constructor(
    public values: {
      status: number;
      headers: Headers;
      content: Json;
    }
  ) {}
}

class Redirect {
  constructor(
    public values: {
      path: string;
    }
  ) {}
}

class Render {
  constructor(
    public values: {
      status: number;
      headers: Headers;
      content: string | Json;
    }
  ) {}
}

// Server-Sent Events response for real-time streaming to clients.
// Keeps connection alive and allows server to push updates continuously.
class SSE {
  constructor(
    public values: {
      headers: Headers;
      stream: (emit: SendMessage, onError: OnError) => Future<Error, null>;
    }
  ) {}
}
type SendMessage = (json: Json) => boolean;
type OnError = (handler: (err: Error) => void) => void;

type Response = Render | JSON | Redirect | SSE;

// Convenience constructors for responses.

const json = ({ status = 200, headers = {}, content }: { status?: number; headers?: Headers; content: Json }): Response =>
  new JSON({ status, headers, content });

const redirect = (path: string): Response => new Redirect({ path });

const render = ({ status = 200, headers = {}, content }: { status?: number; headers?: Headers; content: string | Json }): Response =>
  new Render({ status, headers, content });

const sse = ({
  headers = {},
  stream
}: {
  headers?: Headers;
  stream: (emit: SendMessage, onError: OnError) => Future<Error, null>;
}): Response => new SSE({ headers, stream });

// A middleware is something that transforms the environment.
type Middleware<A, B> = (req: express.Request, env: A) => Future<Response, B>;

function middleware<A, B>(fun: Middleware<A, B>, route: Route<B>): Route<A> {
  return (req: express.Request, env: A) => fun(req, env).chain((res) => route(req, res));
}

function send(response: Response, res: express.Response): void {
  switch (true) {
    case response instanceof JSON:
      res.status(response.values.status);
      res.set(response.values.headers);
      res.json(response.values.content);
      return;
    case response instanceof Render:
      res.status(response.values.status);
      res.set(response.values.headers);
      res.send(response.values.content);
      return;
    case response instanceof Redirect:
      return res.redirect(response.values.path);
    case response instanceof SSE: {
      res.set({
        ...response.values.headers,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
      });
      res.flushHeaders();
      streamSSEResponse(res, response.values.stream);
      return;
    }
  }
}

function streamSSEResponse(res: express.Response, stream: (emit: SendMessage, onError: OnError) => Future<Error, null>): void {
  let connectionClosed = false;
  let endStream: Cancel = () => {};
  const closeConnection = () => {
    if (connectionClosed) return;
    connectionClosed = true;
    endStream();
    res.end();
  };

  const errorHandlers: Array<(err: Error) => void> = [];
  const handleError = (err: Error) => {
    if (connectionClosed) return;
    errorHandlers.forEach((handler) => handler(err));
    closeConnection();
  };

  res.on("close", closeConnection);
  res.on("error", handleError);

  // start streaming
  endStream = stream(
    function emit(payload: Json) {
      if (connectionClosed) return false;
      res.write(`data: ${globalThis.JSON.stringify(payload)}\n\n`);
      return true;
    },
    function onError(handler) {
      errorHandlers.push(handler);
    }
  ).fork(handleError, closeConnection);
}

function sendResponse(routeHandler: Route<{}>, req: express.Request, res: express.Response): void {
  routeHandler(req, {}).fork(
    (r) => send(r, res),
    (r) => send(r, res)
  );
}

// Create an express route handler from a Route.
// It expects the route environment to be null because the
// environment will ultimately be enriched through middlewares.
function route(routeHandler: Route<{}>): express.Handler {
  return (req, res) => sendResponse(routeHandler, req, res);
}
