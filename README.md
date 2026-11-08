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

Open http://localhost:3000. Select an opponent and start the game. Use W/S or the arrow keys after focusing the court, move the mouse over the court, or drag on touch screens. Space starts or pauses a match. Matches are first to seven, with pause, resume, and reset controls. Both paddles return to center after each point. Switching away from the window pauses play. Select Disabled to play with a stationary right paddle without an API key.

```sh
bun run lint
bun run build
```

## Game and model boundary

- `lib/game.ts` contains the pure, immutable simulation. The client advances it in fixed 1/120-second steps independently of display size and frame rate.
- `lib/model-controller.ts` defines the shared `ModelController` contract, `MODELS` catalog, observation builder, and timing constants. Observations contain court geometry, ball position/velocity, paddle centers, score, phase, elapsed seconds, and serve delay. Coordinates are court units with the origin at the top left; positive Y points down. Actions are `up`, `down`, or `stay` at the configured paddle speed.
- `lib/run-model-controller.ts` schedules decisions independently of rendering, with at most one request in flight per game session. Requests start at most once every 500 ms, only during active play after the serve delay and while the ball is moving toward the right paddle (`ball.vx > 0`). Local direction checks do not make model requests. The right paddle holds still while the ball moves away, and responses are discarded if the ball is no longer approaching. Actions expire after 200 ms. Responses based on observations older than 500 ms are discarded without pausing play; the paddle holds still until a usable decision arrives. Requests time out after 1 second. Timing values are defined in `lib/model-controller.ts`.
- `app/pong-game.tsx` applies the latest action to the right paddle. Pause, reset, scoring, opponent changes, and unmount cancel the active session and discard its responses. Cooldowns and automatic retry counts are stored per model across rallies. Explicitly resuming, resetting, or selecting a model resets its retry budget but preserves its cooldown.
- `lib/request-model-action.ts` sends `{ modelId, observation }` to `POST /api/model-action`. The route checks the selected model and numeric game fields and uses server-owned court geometry. Provider credentials and request formatting stay on the server.
- `lib/server/model-registry.ts` maps provider IDs to controller factories. `lib/server/openai-decisions.ts` implements the OpenAI adapter using the standard fetch API, requesting one choice from up/down/stay.

## Errors and rate limits

The adapter classifies errors using OpenAI's error code/type. Temporary rate-limit errors, documented overload errors, and HTTP 500 responses use automatic retries with fresh observations. The paddle stays still during backoff; gameplay continues. Each sequence allows at most three retries and 60 seconds, including time spent waiting for the ball to approach. Success resets the retry budget.

Valid `Retry-After` values (seconds or an HTTP date) are treated as a minimum delay, with jitter added. Without a valid value, delays increase exponentially from one second, with jitter. A server delay beyond the retry budget is preserved and deferred, never shortened. Reaching a retry limit pauses play; manual resume still honors the outstanding cooldown. Billing, quota, authentication, configuration, and other non-retryable failures pause play without automatic retries. Timeouts also pause play.

Failed `/api/model-action` responses preserve the upstream HTTP status and include `details` with the error code/type, request ID, retry classification, parsed retry delay, and available `Retry-After` and `x-ratelimit-*` headers. These diagnostic headers are also forwarded as HTTP response headers for inspection in browser developer tools. Raw upstream error messages and credentials are not returned.

Recovery follows the [OpenAI rate-limit guidance](https://developers.openai.com/api/docs/guides/rate-limits) and [error-code documentation](https://developers.openai.com/api/docs/guides/error-codes).

## Adding a model

Add an entry with a unique ID, label, provider, and provider model name to `MODELS`. Models from an existing provider reuse its adapter. To support another provider, implement a factory `(model: string) => ModelController` under `lib/server/` and register it in `model-registry.ts`. The selector reads the catalog; the game simulation and scheduler stay unchanged. The endpoint accepts only registered model IDs.

The initial entry uses `gpt-6-luna`, currently the only model supported by the [OpenAI Decisions API](https://developers.openai.com/api/docs/guides/decisions). It sends the game snapshot as structured JSON evidence and reads the named choice answer. See the [create-decision reference](https://developers.openai.com/api/reference/typescript/resources/decisions/methods/create) for the request and response schema.

This demo has no authentication or shared server-side usage limits. Keep it local until those are added before shared hosting.
