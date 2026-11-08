# Pong / AI

A Next.js, React, and TypeScript Pong demo using Bun. The human controls the left paddle; the selected model controls the right paddle.

## Development

Use the Bun version declared in `package.json`.

```sh
bun install
```

Copy `.env.example` to `.env.local` and set `OPENAI_API_KEY` to an OpenAI API key with access to the Decisions API. Restart the development server after changing environment variables. The key is read only on the server and is never included in client requests or bundles.

```sh
bun run dev
```

Open http://localhost:3000. Select an opponent and start the game. Use W/S or the arrow keys after focusing the court, move the mouse over the court, or drag on touch screens. Space starts or pauses a match. Matches are first to seven, with pause, resume, and reset controls. Both paddles return to center after each point. The ball defaults to 240 court units/second; the configuration slider adjusts it from 100 to 480 units/second during play without changing its direction or resetting the score. Reset and replay retain the selected speed. The configuration area also shows the maximum decision frequency and interval; actual requests depend on active play, latency, and backoff. Switching away from the window pauses play. Select Disabled to play with a stationary right paddle without an API key.

```sh
bun run lint
bun run build
```

## Game and model boundary

- `lib/game.ts` contains the pure, immutable simulation. The client advances it in fixed 1/120-second steps independently of display size and frame rate.
- `lib/model-controller.ts` defines the shared `ModelController` contract, `MODELS` catalog, observation builder, and timing constants. Observations contain court geometry, ball position/velocity, paddle centers, score, phase, elapsed seconds, and serve delay. Coordinates are court units with the origin at the top left; positive Y points down. Controllers return `{ targetY }`, a legal paddle-center position. The game moves continuously toward that target at the configured paddle speed and stops exactly on arrival.
- `lib/run-model-controller.ts` schedules decisions independently of rendering, with at most one request in flight per game session. Requests start at most once every 500 ms, during active play after the serve delay regardless of ball direction. The paddle follows the latest target while the ball travels in either direction, including while a new decision is pending. Targets have no timed movement expiry. Responses based on observations older than 500 ms are discarded without pausing play or clearing the previous target. Requests time out after 1 second. Timing values are defined in `lib/model-controller.ts`.
- `app/pong-game.tsx` applies the latest action to the right paddle. Pause, reset, scoring, opponent changes, and unmount cancel the active session and discard its responses. Cooldowns and automatic retry counts are stored per model across rallies. Explicitly resuming, resetting, or selecting a model resets its retry budget but preserves its cooldown.
- `lib/request-model-action.ts` sends `{ modelId, observation }` to `POST /api/model-action`. The route checks the selected model and numeric game fields, validates the selected ball speed against the slider bounds, and uses server-owned court geometry with that ball speed. Provider credentials and request formatting stay on the server.
- `lib/server/model-registry.ts` maps provider IDs to controller factories. `lib/server/openai-decisions.ts` implements the OpenAI adapter using the standard fetch API, requesting one of 33 legal paddle-center targets, including both limits and the exact center. The endpoint returns `{ targetY }`.

## Model decision packet

The full observation is internal to the application. `lib/paddle-decision.ts` sends ball position/velocity/radius, court dimensions, right-paddle position/height/speed/limits/contact face, predicted interception time/height and signed offset, center recovery target, and the decision interval. Score, winning score, elapsed match time, and left-paddle state are not sent to OpenAI.

The projection accounts for ball radius and wall reflections. Numbers are rounded to two decimal places. A negative target offset is above the paddle; a positive offset is below it. When no upcoming right-paddle contact exists, the model selects a recovery target instead. Requests continue in either direction after the serve delay.

The model selects a target center from 33 fixed choices spanning Y=44 through Y=496, including Y=270. The provider converts the selected choice to `{ targetY }`. The local simulation approaches it at 440 units/second, clamps travel to the remaining distance, and stops on arrival. Target selection stays with the model; continuous movement stays in the game loop. Pause, reset, scoring, configuration changes, and API errors clear the target. Stale responses retain the previous valid target.

Predictions assume unchanged ball speed and exclude network/inference latency compensation. Live model performance has not been evaluated for this control change.

## Errors and rate limits

The adapter classifies errors using OpenAI's error code/type. Temporary rate-limit errors, documented overload errors, and HTTP 500 responses use automatic retries with fresh observations. The paddle stays still during backoff; gameplay continues. Each sequence allows at most three retries and 60 seconds, including time spent waiting between rallies. Success resets the retry budget.

Valid `Retry-After` values (seconds or an HTTP date) are treated as a minimum delay, with jitter added. Without a valid value, delays increase exponentially from one second, with jitter. A server delay beyond the retry budget is preserved and deferred, never shortened. Reaching a retry limit pauses play; manual resume still honors the outstanding cooldown. Billing, quota, authentication, configuration, and other non-retryable failures pause play without automatic retries. Timeouts also pause play.

Failed `/api/model-action` responses preserve the upstream HTTP status and include `details` with the error code/type, request ID, retry classification, parsed retry delay, and available `Retry-After` and `x-ratelimit-*` headers. These diagnostic headers are also forwarded as HTTP response headers for inspection in browser developer tools. Raw upstream error messages and credentials are not returned.

Recovery follows the [OpenAI rate-limit guidance](https://developers.openai.com/api/docs/guides/rate-limits) and [error-code documentation](https://developers.openai.com/api/docs/guides/error-codes).

## Adding a model

Add an entry with a unique ID, label, provider, and provider model name to `MODELS`. Models from an existing provider reuse its adapter. To support another provider, implement a factory `(model: string) => ModelController` under `lib/server/` and register it in `model-registry.ts`. The selector reads the catalog; the game simulation and scheduler stay unchanged. The endpoint accepts only registered model IDs.

The initial entry uses `gpt-6-luna`, currently the only model supported by the [OpenAI Decisions API](https://developers.openai.com/api/docs/guides/decisions). It sends the game snapshot as structured JSON evidence and reads the named choice answer. See the [create-decision reference](https://developers.openai.com/api/reference/typescript/resources/decisions/methods/create) for the request and response schema.

This demo has no authentication or shared server-side usage limits. Keep it local until those are added before shared hosting.
