# Website Screenshot World client library spec

The reference the official client libraries for the [Website Screenshot World](https://websitescreenshotworld.com)
APIs are written and tested against. When the API changes, it changes here first, with a test case, and then in
each library.

The published libraries are [Node.js](https://github.com/websitescreenshotworld/websitescreenshotworld-node) and
[Python](https://github.com/websitescreenshotworld/websitescreenshotworld-python). Each one includes this repository
as a git submodule at `spec/`, fixed to one commit, so a change here reaches a library only when its pin is moved.

| File | What it is |
|---|---|
| `instant-snap.openapi.json` | The Instant Snap API, also served at `https://api.websitescreenshotworld.com/instant-snap/v1/openapi.json` |
| `auto-schedule.openapi.json` | The Auto Schedule API, also served at `https://autoapi.websitescreenshotworld.com/auto-schedule/v1/openapi.json` |
| `errors.json` | Which error each `error_code` raises, which are retried, and the fallback when a refusal has no JSON body |
| `fixtures/` | Request and response pairs every library must handle identically (see below) |
| `events/` | One example of every webhook event |
| `webhook-vectors.json` | Signature cases every `verify` must agree with |
| `conformance/server.js` | The playback server every library's tests run the fixtures against (see below); `conformance/package.json` keeps it CommonJS inside an ES-module package such as the Node.js library |

## The client

One client covers both products. Either key may be left out; calling a product whose key is missing fails
before anything is sent, with a message naming the missing key.

| Setting | Default |
|---|---|
| Instant Snap key | environment variable `WSW_INSTANT_SNAP_API_KEY` |
| Auto Schedule key | environment variable `WSW_AUTO_SCHEDULE_API_KEY` |
| Instant Snap base URL | `https://api.websitescreenshotworld.com` |
| Auto Schedule base URL | `https://autoapi.websitescreenshotworld.com` |
| Timeout for a capture | 180 seconds (the server answers within 120) |
| Timeout for everything else | 30 seconds |
| Retries | 2 (so at most 3 attempts) |

Operations, named in each language's own style:

| Operation | HTTP | Returns |
|---|---|---|
| Instant Snap `capture(options)` | `POST /instant-snap/v1/captures`, `response_type: json` | the capture |
| Instant Snap `capture_file(options)` | same, `response_type: by_format` | the file and its metadata |
| Instant Snap `capture_to_bucket(options)` | same, `response_type: cloud_storage` | the capture |
| Instant Snap `submit(options)` | same, `response_type: json`, `async: true` | the capture, `status: queued` |
| Instant Snap `submit_to_bucket(options)` | same, `response_type: cloud_storage`, `async: true` | the capture, `status: queued` |
| Instant Snap `wait(id, timeout_seconds, poll_interval_seconds)` | `GET /instant-snap/v1/captures/{id}`, repeated | the capture once it is finished |
| Instant Snap `get(id)` | `GET /instant-snap/v1/captures/{id}` | the capture |
| Instant Snap `download(capture, target)` | `GET` the capture's `download_url` | writes the file to a path or stream |
| Instant Snap `defaults()` | `GET /instant-snap/v1/defaults` | the default set (no key needed) |
| Instant Snap `catalog()` | `GET /instant-snap/v1/catalog` | devices and proxy countries |
| Auto Schedule `trigger_now(web_page_id)` | `POST /auto-schedule/v1/web-pages/{id}/trigger-now` | the trigger result |
| `Webhook.verify(body, signature_header, secret, tolerance)` | none | the typed event, or a signature error |

The five capture operations set `response_type` themselves, and the two `submit` operations set `async: true`;
neither is an option the caller passes.

**Async captures.** `submit` and `submit_to_bucket` are answered at once - `202 Accepted`, a `Location` header and
the capture with `status: queued` - and the capture runs when a browser is free. Their options take `timeout`,
the browser time the capture may use, 30 to 300 seconds (the server uses 120 when it is left out); the server
refuses `timeout` on the other capture operations. The request itself uses the timeout for everything else, not
the capture timeout, since no capture runs while the caller waits. A capture still waiting 15 minutes after it
was accepted ends `failed` with `capture_expired`, not charged.

`wait` reads the capture with `get` every `poll_interval_seconds` (default 3) until its status is no longer
`queued`, `running` or `pending`, and returns it. When `timeout_seconds` (default 360) runs out first it returns
the capture as last read - still unfinished - rather than raising, so the caller decides whether to wait again.
A refusal from `get` is raised as from `get`. A caller-set deadline or cancellation stops it at once.

## Requests

- JSON bodies use the API's own snake_case field names. Each language spells its option properties in its
  own casing and maps them to those names.
- **An option that was not set is not sent.** `false`, `0` and `""` are values and are sent.
- The keys of `headers` and `cookies` are sent exactly as given, never re-cased.
- Headers on every request: `X-Api-Key` (not on `defaults`), `Accept: application/json` (except when fetching a
  file), `User-Agent: websitescreenshotworld-<language>/<version> (<runtime> <runtime version>)`, and
  `Content-Type: application/json` on requests with a body. Trigger-now has no body.
- Every capture sends an `Idempotency-Key`: the caller's, when given, or a new random UUID per call. The same
  key is reused on that call's retries.

## Answers

- Success bodies carry `"success": true`; the libraries drop it from the objects they return.
- Fields the library does not know are ignored, never an error, so a server that adds a field does not break
  an older library.
- Dates are ISO 8601 UTC strings with milliseconds. Parse them leniently (any fraction length, `Z` or an
  offset), and return each language's native date-time type.
- Tokens such as `status` and `format` are returned as strings, with named constants for the known values, so
  a value added later still comes through.
  An async capture adds two `status` values to the constants: `queued` (accepted, waiting for a browser) and
  `running` (a browser has it).
- A `capture_file` answer exposes the file as a stream the caller can read once or save, never a whole buffer
  held by default, plus the `X-InstantSnap-*` headers as typed metadata and the file name from
  `Content-Disposition`.

## Errors

A refusal is `{"success": false, "error_code", "error_message", "retry_after_seconds"}`. Every language has
one base error carrying `error_code`, `message`, `http_status`, `retry_after_seconds` and the raw body, and one
subclass per kind in `errors.json`:

| Kind | Name |
|---|---|
| `authentication` | AuthenticationError |
| `invalid_request` | InvalidRequestError |
| `plan_limit` | PlanLimitError |
| `not_found` | NotFoundError |
| `rate_limit` | RateLimitError |
| `capture` | CaptureError |
| `service` | ServiceError |
| (network, before any answer) | ConnectionError, with its own name where the language already has one |
| (webhook) | SignatureVerificationError |

Switch on `error_code`, never on the status or the message. A refusal without a JSON body takes its code from
`fallback_by_status`. An unknown code raises the base error.

## Retries

- Retried: the codes in `errors.json` `retryable`, and connection failures (the request could not be sent, or
  no answer came back). Captures always carry an `Idempotency-Key` and trigger-now is idempotent, so a retry
  never runs a capture twice.
- Never retried: everything else, including `capture_failed`, `capture_timeout` and `queue_full`. `queue_full`
  (429) means the organization already has as many async captures waiting or running as it may; a retry
  within the library would only meet the same queue, so it is raised as a rate-limit error with
  `retry_after_seconds` for the caller.
- The wait is `retry_after_seconds` (or the `Retry-After` header) when given, capped at 60 seconds; otherwise
  0.5 s, then 1 s, each with up to 25 % random jitter.
- A caller-set deadline or cancellation stops retrying at once.

## Timeouts

- The timeout (180 seconds for captures and downloads, 30 seconds for everything else, `submit` included) covers
  the whole call: every attempt and the waits between them. A retry whose wait would end past it is not started;
  the last error is raised instead.
- A call that runs out of time raises a connection error, and is not retried.
- For a file streamed to the caller, the timeout covers the call at least until the answer's headers arrive.
  Whether reading the body afterwards counts too differs by language; each README says which.
- When the caller passes in an HTTP client of their own whose requests the library cannot time, that client's
  timeouts bound each request, and the library still stops retrying once the call's time is up.

## Redirects

The API key is never sent through a redirect: a client that followed one would carry `X-Api-Key` to wherever it
pointed. Neither the API nor a download link redirects, so a `3xx` answer is raised as an error with the
`fallback_by_status` code. Python follows a redirect only for the download link, which carries no key; the other
libraries follow none. Where the caller passes in an HTTP client of their own, the README says how to switch its
redirects off, and the libraries that can tell an answer came through a redirect (.NET, Java) refuse it.

## Webhooks

Every delivery is a POST with this envelope:

```json
{ "id": "<delivery id>", "type": "capture.succeeded", "created_at": "2026-09-26T10:30:05.000Z",
  "product": "instant_snap", "data": { } }
```

`X-WSW-Signature: t=<unix seconds>,v1=<hex>` signs it. `verify`:

1. Splits the header on `,`, and each part on its first `=`, trimming spaces. Unknown names are ignored.
2. Needs a `t` that is an integer and at least one `v1`.
3. Refuses a timestamp more than `tolerance` (default 300 seconds) before or after now.
4. Computes HMAC-SHA256 with the secret's UTF-8 bytes as the key, over the UTF-8 bytes of `t + "." + body`,
   as lowercase hex, and compares it with each `v1` in constant time (case-insensitively). One match is enough.
5. Parses the body and returns the event typed by `type`. A type the library does not know yet comes back as
   an unknown event that still carries `type` and the raw `data`.

The body must be the raw bytes as received. A framework that parses JSON first and re-serialises it changes the
bytes and breaks the signature; each README shows how to get the raw body in that language's common frameworks.

| Event | Product | `data` |
|---|---|---|
| `capture.succeeded`, `capture.failed` | instant_snap | the capture as `get` returns it, without `download_url`, `page_source.download_url` or `s3_delivery.access_key_id` |
| `capture.succeeded`, `capture.failed` | auto_schedule | `id`, `schedule_id`, `schedule_name`, `url`, `status`, `media_category`, `format`, `page_http_status`, `captured_at`, `final_url`, `media_sha256`, `page_source` (`format`, `sha256`) or null, `sitemap_run_id` |
| `delivery.completed` | auto_schedule | the capture fields, plus `destinations` (`slot`, `name`, `provider`, `status`, `completed_at`) |
| `capture.changed` | auto_schedule | the capture fields, plus `change_percent`, `compared_to_capture_id`, `change_image_available` |
| `schedule.paused` | auto_schedule | `schedule_id`, `schedule_name`, `url`, `reason`, `paused_at` |
| `sitemap_run.completed` | auto_schedule | `sitemap_run_id`, `schedule_id`, `schedule_name`, `sitemap_url`, `status`, `run_at`, `completed_at`, the `pages_*` counts, `message` |
| `ping` | both | `endpoint_id`, `endpoint_name`, `message`, `sent_at` |

`schedule_id` is the same id trigger-now calls `web_page_id`.

## Fixtures

Each file in `fixtures/` is one case:

```json
{
  "name": "rate_limited_then_ok",
  "call":     { "product": "instant_snap", "method": "capture", "options": { "url": "…" } },
  "expect_requests": [ { "method": "POST", "path": "…", "headers": { }, "idempotency_key": "same", "body": { } } ],
  "responses": [ { "status": 429, "headers": { }, "body": { } }, { "status": 200, "…": "…" } ],
  "expect":   { "result": { } }
}
```

- `call.options` is in wire form. Typed languages read it into their options type with their JSON mapping.
  `call.idempotency_key`, `call.id`, `call.web_page_id` and, for `wait`, `call.poll_interval_seconds` and
  `call.timeout_seconds` are the other arguments when present.
- Use the keys in `fixtures/keys.json`.
- `expect_requests` is the exact number of requests the client must make. For each: the method, the path, the
  listed headers (names compared case-insensitively; other headers are allowed), and the JSON body compared as
  a value (`null` means no body). `idempotency_key` is `"present"` (any value) or `"same"` (one value, shared by
  every request of the call).
- A response has `body` (JSON), `body_text` or `body_base64`.
- `expect.result` lists fields of the returned object with their wire names; only those are checked. For
  `capture_file`, `body_sha256` is the digest of the bytes read from the returned stream and `filename` the name
  from `Content-Disposition`.
- `expect.error` gives the `kind` (as in `errors.json`, or `base`), `error_code`, `http_status`, and where
  present `message` and `retry_after_seconds`.

`conformance/server.js` plays the responses back: start it, `POST /__load` the fixture, point the client at it,
make the call, then `GET /__requests`. Every library's test suite runs every fixture, every webhook vector and
every event example.
