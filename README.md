# Pong / AI

A Next.js, React, and TypeScript Pong demo using Bun. The human controls the left paddle; the selected model controls the right paddle.

## Development

Use the Bun version declared in `package.json`.

```sh
bun install
```

Copy `.env.example` to `.env.local`. Set `OPENAI_API_KEY` for OpenAI Decisions or `TYPESAFE_API_KEY` for Typesafe Jev; only the selected provider needs a key. Restart the development server after changing environment variables. Keys are read only on the server and are never included in client requests or bundles. Select the opponent from the configuration dropdown to compare models with the same difficulty and controls.

```sh
bun run dev
```

Open http://localhost:3000. The game fills the viewport, preserving court proportions. Select an opponent and difficulty in the start menu, then start the game. Pause / Menu, Space, or Escape opens the pause menu for configuration and reset controls. Use W/S or the arrow keys after focusing the court. Keyboard movement ramps to full paddle speed over 60 ms and stops immediately on release; pointer controls are disabled. Space starts or pauses a match. Matches are first to seven, with pause, resume, and reset controls. Both paddles return to center after each point. Each serve starts at court center and travels horizontally toward the receiving paddle at the selected speed; paddle hits still determine subsequent bounce angles. Difficulty presets set ball speed: Easy (300), Medium (450, default), Hard (600), and Extra hard (800 court units/second). Changing difficulty from the pause menu preserves ball direction and score; starting or resuming returns keyboard focus to the court. All presets currently use the same paddle size. Reset and replay retain the selected difficulty. The menu also shows the maximum decision frequency and interval; actual requests depend on active play, latency, and backoff. Switching away from the window pauses play. Select Disabled to play with a stationary right paddle without an API key.

```sh
bun run lint
bun run build
```

## Game and model boundary

- `lib/game.ts` contains the pure, immutable simulation. The client advances it in fixed 1/120-second steps independently of display size and frame rate.
- `lib/model-controller.ts` defines the shared `ModelController` contract, `MODELS` catalog, observation builder, and timing constants. Observations contain court geometry, ball position/velocity, paddle centers, score, phase, elapsed seconds, and serve delay. Coordinates are court units with the origin at the top left; positive Y points down. Controllers return `{ targetY }`, a legal paddle-center position. The game moves continuously toward that target at the configured paddle speed and stops exactly on arrival.
- `lib/run-model-controller.ts` schedules decisions independently of rendering, with at most one request in flight per game session. Requests start at most once every 500 ms, during active play after the serve delay regardless of ball direction. The paddle follows the latest target while the ball travels in either direction, including while a new decision is pending. Targets have no timed movement expiry. Responses based on observations older than 500 ms are discarded without pausing play or clearing the previous target. Requests time out after 1 second on both the client and server. Timeouts retain the previous target and retry with fresh observations using the bounded retry policy below. Longer response times reduce the actual decision frequency. Timing values are defined in `lib/model-controller.ts`.
- `app/pong-game.tsx` applies the latest action to the right paddle. Pause, reset, scoring, opponent changes, and unmount cancel the active session and discard its responses. Cooldowns and automatic retry counts are stored per model across rallies. Explicitly resuming, resetting, or selecting a model resets its retry budget but preserves its cooldown.
- `lib/request-model-action.ts` sends `{ modelId, observation }` to `POST /api/model-action`. The route checks the selected model and numeric game fields, validates the selected ball speed against the difficulty presets, and uses server-owned court geometry with that ball speed. Provider credentials and request formatting stay on the server.
- `lib/server/model-registry.ts` maps provider IDs to controller factories. `lib/server/openai-decisions.ts` and `lib/server/typesafe.ts` implement their provider adapters, requesting one of nine legal paddle-center targets, including both limits and the exact center. Their shared `lib/server/decision-request.ts` helper uses the standard fetch API and records provider timing and token usage when available. The endpoint returns `{ targetY }`.

The live decision panel displays the latest accepted target Y, current paddle Y, movement direction, selection time in match seconds, and the latest successful response latency (client-to-server-to-provider round trip, including stale responses). A dashed court marker shows the active target. Retry and stale-response status appears below; stale responses do not replace the displayed target. Pausing, scoring, resetting, or stopping model control clears the target. The display shows the returned decision, not internal model reasoning.

## Model decision packet

The full observation is internal to the application. `lib/paddle-decision.ts` sends only current court width/height, ball position/velocity/radius, and right-paddle center Y/height/speed/contact-face X. Both providers receive the same decision packet, instructions, and target positions; their adapters only translate the API formats. Score, elapsed time, left-paddle state, history, previous targets, and response latency are not sent to either provider.

No computed interception point, arrival time, trajectory preview, direction label, or distance-per-decision is supplied. Each model predicts the ball path from current position and velocity using the stated wall-reflection and paddle-contact rules. Numbers are rounded to two decimal places. Shared instructions describe the coordinate system, units, maximum request frequency, and persistent speed-limited target movement. Recovery positioning when the ball moves away or passes the paddle stays with the model; no default center instruction is supplied.

The model selects one of nine target centers: Y=44, 100.5, 157, 213.5, 270, 326.5, 383, 439.5, or 496. The provider converts the selected choice to `{ targetY }`. The local simulation approaches it at 440 units/second, clamps travel to the remaining distance, and stops on arrival. Target selection stays with the model; continuous movement stays in the game loop. Pause, reset, scoring, configuration changes, and non-timeout API errors clear the target. Stale responses and recoverable timeouts retain the previous valid target; if no target has been accepted yet, the paddle remains stationary.

The game does not advance snapshots or adjust the chosen target for latency. Nine targets trade precision for a simpler choice. A smaller packet and fewer targets do not guarantee faster provider responses; measure both latency and return accuracy before drawing conclusions.

## Decision diagnostics and manual comparison

Successful API responses include a `Server-Timing: provider;dur=...` header measuring provider fetch through JSON parsing in milliseconds. Failed provider calls also include available timing (HTTP error body handling is excluded). The live response value measures the full browser-to-server-to-provider round trip, including parsing and stale responses. A response over 500 ms is stale; a request reaching 1,000 ms is a timeout.

In development, the server logs `[model-provider]` metadata: model ID, target count, outcome, upstream request bytes, provider duration, and input/output token counts when supplied. The browser logs `[model-decision]` outcomes (`accepted`, `stale`, `inactive`, `timeout`, or `error`) and round-trip duration. Credentials and observation contents are not included. Use browser developer tools and server output to compare provider latency with end-to-end latency; client timeouts can cancel the request before a timing header reaches the browser.

For a manual comparison, use Medium difficulty and the same provider/model and play conditions. Compare the original packet with 33 targets, the compact packet with 33 targets, and the compact packet with nine targets, changing only one factor between variants. Collect at least 100 requests per provider and variant. Record request bytes, available token counts, provider and round-trip p50/p95, stale/timeout percentages, and returns/misses. Count timeouts separately from completed-response percentiles. The code does not add a benchmark runner or automated tests.

Manually check direct shots, wall reflections, recovery while moving away, both target limits, all difficulties, and cancellation during pending requests. Browser network throttling can exercise stale responses and timeouts: the prior target must remain active, retries must use fresh observations, and persistent timeouts must eventually pause play. Throttling adds transport delay and does not measure provider inference speed.

## Errors and rate limits

The OpenAI adapter classifies errors using OpenAI's error code/type. Temporary rate-limit errors, documented overload errors, and HTTP 500 responses use automatic retries with fresh observations. The paddle stays still during backoff for these errors; gameplay continues. Timeouts use the same retry budget but retain the previous target during backoff. Each sequence allows at most three retries and 60 seconds, including time spent waiting between rallies. Success resets the retry budget, including a successful response discarded as stale.

The Typesafe adapter retries HTTP 429 (rate limited) and HTTP 529 (overloaded), following the [Typesafe error documentation](https://docs.typesafe.ai/api/errors). It uses the same scheduler, retry budget, timeout, and stale-response cutoff as OpenAI. Its upstream error bodies are not exposed.

Valid `Retry-After` values (seconds or an HTTP date) are treated as a minimum delay, with jitter added. Without a valid value, delays increase exponentially from one second, with jitter. A server delay beyond the retry budget is preserved and deferred, never shortened. Reaching a retry limit pauses play; manual resume still honors the outstanding cooldown. Billing, quota, authentication, configuration, and other non-retryable failures pause play without automatic retries. A server-enforced timeout returns HTTP 504 with `details.code` set to `request_timeout`; client-enforced timeouts follow the same recovery policy.

Failed `/api/model-action` responses preserve the upstream HTTP status and include `details` with available error code/type, request ID, retry classification, parsed retry delay, and available `Retry-After` and `x-ratelimit-*` headers. These diagnostic headers are also forwarded as HTTP response headers for inspection in browser developer tools. Raw upstream error messages and credentials are not returned.

Recovery follows the [OpenAI rate-limit guidance](https://developers.openai.com/api/docs/guides/rate-limits) and [error-code documentation](https://developers.openai.com/api/docs/guides/error-codes).

## Adding a model

Add an entry with a unique ID, label, provider, and provider model name to `MODELS`. Models from an existing provider reuse its adapter. To support another provider, implement a factory `(model: string) => ModelController` under `lib/server/` and register it in `model-registry.ts`. The selector reads the catalog; the game simulation and scheduler stay unchanged. The endpoint accepts only registered model IDs.

The initial entry uses `gpt-6-luna`, currently the only model supported by the [OpenAI Decisions API](https://developers.openai.com/api/docs/guides/decisions). It sends the game snapshot as structured JSON evidence and reads the named choice answer. See the [create-decision reference](https://developers.openai.com/api/reference/typescript/resources/decisions/methods/create) for the request and response schema.

The Typesafe entry uses `jev-latest` through `POST https://api.typesafe.ai/v1/systemone`. It sends the packet as `state` and a named `paddle_target` Choice question with the nine targets in `criteria`, then reads `answers.paddle_target.choice`. See the [System One API](https://docs.typesafe.ai/api/system-one) and [Choice format](https://docs.typesafe.ai/primitives/choice). `jev-latest` is a moving stable alias; set a versioned model ID in `MODELS` when a comparison needs a fixed release.

This demo has no authentication or shared server-side usage limits. Keep it local until those are added before shared hosting.
