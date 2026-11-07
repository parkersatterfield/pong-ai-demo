# Pong / AI

A Next.js, React, and TypeScript Pong demo using Bun. The human controls the left paddle; the right paddle is stationary until model integration is added.

## Development

Use the Bun version declared in `package.json`.

```sh
bun install
bun run dev
```

Open http://localhost:3000. Use W/S or the arrow keys after focusing the court, move the mouse over the court, or drag on touch screens. Space starts or pauses a match. Matches are first to seven, with pause, resume, and reset controls. Switching away from the window pauses play.

```sh
bun run lint
bun run build
```

## Game and model boundary

- `lib/game.ts` contains the pure, immutable simulation. The client advances it in fixed 1/120-second steps, independently of display size and frame rate.
- `app/pong-game.tsx` owns input and rendering. `modelAction` currently holds `"stay"`; its value is passed to `stepGame` as the right paddle action each step.
- `lib/model-controller.ts` defines `ModelController` and `getModelObservation(state)`. Observations are detached JSON-serializable snapshots containing court geometry, ball position/velocity, paddle centers, score, phase, elapsed seconds, and serve delay. Coordinates are court units with the origin at the top left; positive Y points down. Actions are `"up"`, `"down"`, or `"stay"`, applied at the configured paddle speed.

The future integration should send observations to a server endpoint at a bounded decision rate, then write each returned action to `modelAction.current`. Keep rendering independent of network latency, allow only one request in flight, and cancel/discard stale responses on pause, reset, or unmount. Return to `"stay"` if a request fails or its action expires. Provider credentials and model calls belong on the server. No provider, endpoint, request loop, or credentials are configured yet.
