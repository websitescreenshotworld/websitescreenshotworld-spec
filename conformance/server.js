#!/usr/bin/env node
// Plays back the responses of one fixture at a time and records what the client sent.
//
//   node conformance/server.js            listens on a free port
//   PORT=4010 node conformance/server.js  listens on 4010
//
// The first line on stdout is "listening on http://127.0.0.1:<port>". A test then:
//
//   POST /__load      {"responses": [...]}   queue a fixture's responses and forget earlier requests
//   ...               call the client under test with the server as its base URL
//   GET  /__requests                          what the client sent, in order
//
// Each queued response is used once. A request with nothing left in the queue gets a 599, so a client
// that retries more than it should fails its test instead of hanging.

"use strict";

const http = require("node:http");

let queue = [];
let received = [];

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function send(res, status, headers, body) {
  res.writeHead(status, { "Content-Length": body.length, ...headers });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, { "Content-Type": "application/json" }, Buffer.from(JSON.stringify(value)));
}

function bodyOf(response) {
  if (response.body_base64 !== undefined) return Buffer.from(response.body_base64, "base64");
  if (response.body_text !== undefined) return Buffer.from(response.body_text, "utf8");
  if (response.body === undefined || response.body === null) return Buffer.alloc(0);
  return Buffer.from(JSON.stringify(response.body), "utf8");
}

const server = http.createServer(async (req, res) => {
  const body = await readBody(req);

  if (req.method === "POST" && req.url === "/__load") {
    const fixture = JSON.parse(body.toString("utf8"));
    queue = [...(fixture.responses || [])];
    received = [];
    return sendJson(res, 200, { queued: queue.length });
  }

  if (req.method === "GET" && req.url === "/__requests") {
    return sendJson(res, 200, received);
  }

  received.push({
    method: req.method,
    path: req.url,
    headers: req.headers,
    body: body.length === 0 ? null : body.toString("utf8"),
  });

  const next = queue.shift();
  if (!next) {
    return sendJson(res, 599, { error: "The fixture has no response left for this request." });
  }

  send(res, next.status, next.headers || {}, bodyOf(next));
});

server.listen(Number(process.env.PORT || 0), "127.0.0.1", () => {
  const { port } = server.address();
  process.stdout.write(`listening on http://127.0.0.1:${port}\n`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
