export { type Endpoint, PlainEndpoint, StreamingEndpoint, CustomEndpoint, Channel };

import { Schema } from "@/json/schema";

// An API endpoint.
type Endpoint<Req, Res> = PlainEndpoint<Req, Res> | StreamingEndpoint<Req, Res> | CustomEndpoint<Req>;

// A POST endpoint that accepts a JSON body in the request and sends a JSON response.
class PlainEndpoint<Req, Res> {
  // @ts-expect-error
  private __tag: null = null;
  path: string;
  request: Schema<Req>;
  response: Schema<Res>;
  constructor(v: { path: string; request: Schema<Req>; response: Schema<Res> }) {
    this.path = v.path;
    this.request = v.request;
    this.response = v.response;
  }
}

// An endpoint that streams its response. Represents a connection using Server-Sent Events.
class StreamingEndpoint<Req, Res> {
  // @ts-expect-error
  private __tag: null = null;
  path: string;
  request: Schema<Req>;
  response: Schema<Res>;
  constructor(v: { path: string; request: Schema<Req>; response: Schema<Res> }) {
    this.path = v.path;
    this.request = v.request;
    this.response = v.response;
  }
}

// An endpoint that does something unusual and ad-hoc in the success case,
// like redirecting to another page.
// Used primarily for integrating with third-party services.
//
// NB. This should never be used for requests coming from our frontend.
//
class CustomEndpoint<Req> {
  // @ts-expect-error
  private __tag: null = null;
  path: string;
  request: Schema<Req>;
  constructor(v: { path: string; request: Schema<Req> }) {
    this.path = v.path;
    this.request = v.request;
  }
}

// A bi-directional channel. Represents a web-sockets connection.
class Channel<In, Out> {
  // @ts-expect-error
  private __tag: null = null;
  path: string;
  toServer: Schema<In>;
  toClient: Schema<Out>;
  constructor(v: { path: string; toServer: Schema<In>; toClient: Schema<Out> }) {
    this.path = v.path;
    this.toServer = v.toServer;
    this.toClient = v.toClient;
  }
}
