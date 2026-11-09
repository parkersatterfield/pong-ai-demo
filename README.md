# Pong vs System One Models 

To learn more about how decision making models thing, this I wanted to use Codex build a technical demo exploring how a system one model such as Jev or OpenAi's decisions API can control a paddle in a real-time game. Built with Next.js, React, TypeScript, and Bun. You control the left paddle; the model selects destinations for the right paddle.

The learning question is how much work belongs in the model, and how much belongs in ordinary code. Pong makes that boundary visible: ball physics, wall reflections, network latency, and a model's decisions all affect whether a return succeeds.

## What we learned

Deciding what input payload was the most important part of the experiment. You can create a standard program that controls a paddle, so we wanted to push the boundary of what the model can do without just having the model pull strings and do what the game engine made obvious based on the input. 

### Asking the model to predict the intercept did not work reliably

We tried withholding the predicted interception point. The intent was to give the model the ball's position and velocity plus court and paddle geometry, then see whether it could work out where to move on its own, including top and bottom wall reflections.

The original options, labeled **with yIntercept**, compute `interceptY` programmatically in the game engine and include it in the model input. The prompt explicitly asks for the available target closest to that prediction. When the ball is moving away, `interceptY` is null and the model chooses a recovery position. This almost feels like cheating but it makes for a fun demo. How much of the game is the model actually playing.

This narrows what the demo demonstrates: the model selects among destinations using an engineered physics feature. It does not independently solve the trajectory. A deterministic nearest-target selector could perform the intercept selection too; keeping it as a model decision lets us inspect the API integration and control loop. I hope to keep experimenting with payloads that we can send these models such that the intercept is not calculated and sent to the model as input.

## What we send the model

The browser sends `{ modelId, observation }` to `POST /api/model-action`. That internal observation includes the game phase, score, elapsed time, serve delay, both paddles, ball state, and court geometry. The server validates it and reconstructs court geometry from its own constants.

For the **with yIntercept** options, [`getPaddleDecisionInput`](lib/paddle-decision.ts) reduces that observation to the following shape. This is an illustrative packet with values consistent with the current geometry:

```json
{
  "court": { "width": 960, "height": 540 },
  "ball": { "x": 480, "y": 270, "vx": 360, "vy": 270, "radius": 7 },
  "paddle": { "centerY": 270, "height": 88, "speed": 440, "contactX": 916 },
  "interceptY": 474.25
}
```

Coordinates start at the top left; positive Y points down. Velocities use court units/second. `paddle.contactX` is the paddle face; interception happens when the ball center reaches that face minus the ball radius. Numeric state values are rounded to two decimal places.

Score, elapsed time, the human paddle, history, previous targets, and measured latency are not sent to the provider. The model receives structured JSON, with no screenshot or conversation history.

Both adapters use this exact instruction from [`lib/paddle-decision.ts`](lib/paddle-decision.ts):

```text
Choose the paddle-center target closest to interceptY; it includes wall reflections. If interceptY is null, choose a recovery position. The paddle moves toward your target at paddle.speed and stops there.
```

### Experiment: no yIntercept

Each provider also has a **no yIntercept** option. These options use the same models, nine physical destinations, 250 ms request interval, and paddle speed limits as the original options. They send normalized current state and explicit physics rules without calculating or sending an intercept, predicted bounces, or future ball positions.

All lengths and velocities use one scale factor, `100 / court.height`, rounded to two decimal places. Court height becomes 100 while angles and travel times are preserved apart from rounding. For the same example above, the provider input is:

```json
{
  "court": { "width": 177.78, "height": 100 },
  "ball": {
    "x": 88.89, "y": 50, "vx": 66.67, "vy": 50, "radius": 1.3,
    "horizontalDirection": "toward you", "verticalDirection": "down",
    "heightBand": "Center", "relativeToPaddle": "within your paddle's vertical reach",
    "horizontalPosition": "your half", "slope": "diagonal"
  },
  "paddle": { "centerY": 50, "height": 16.3, "speed": 81.48, "ballContactX": 168.33, "heightBand": "Center" }
}
```

`ballContactX` is static geometry: the ball-center X at contact with the right paddle. Direction names describe the current velocity signs. Height bands name the closest of the nine destinations to the ball's or paddle's current Y. Relative reach includes paddle half-height plus ball radius; it describes vertical overlap now, not whether a return will succeed. Horizontal position distinguishes the opponent half, your half, the final sixth of court width near your paddle, and a ball past the contact plane. Slope is **mostly horizontal** when vertical speed is at most half horizontal speed, **steep diagonal** when it exceeds 1.5 times horizontal speed, and **diagonal** otherwise. None of these cues projects the ball forward.

The no-intercept prompt uses language-based guidance: move early, lead a diagonal shot, consider wall reversals, cover the current ball height when close, and recover toward center when the ball travels away or has passed. It explains that a distant destination keeps the paddle moving without selecting intermediate steps. Choices use names such as **Above center**, with descriptions such as **Move up to Above center**, based on the paddle's current position. Normalized numeric destinations remain in the descriptions for finer detail. The adapter maps each selected name back to the original court-unit destination; the browser continues to display targets in court units.

This experiment includes no observation history, active target, or measured latency. Compare the options at the same difficulty; improvement in play is an experimental outcome, not an assumed property of the new representation.

The latest prompt experiment emphasizes paddle travel time: commit to an expected arrival position while the ball is still far away and approaching, because waiting can make a correct destination unreachable. Only the no-intercept instructions change; the payload, target choices, and 250 ms interval stay fixed.

### Provider requests

The OpenAI adapter builds this request body for the original options in [`lib/server/openai-decisions.ts`](lib/server/openai-decisions.ts):

```ts
{
  model,
  input: [{ role: "user", content: [{ type: "input_json", data: input }] }],
  questions: [{
    type: "choice",
    name: "paddle_target",
    instructions: PADDLE_TARGET_INSTRUCTIONS,
    choices: MODEL_TARGETS.map((targetY) => ({
      value: String(targetY),
      description: `Paddle center Y = ${targetY}`,
    })),
  }],
}
```

The adapter posts it to `https://api.openai.com/v1/decisions` with a server-side API key. The configured model is `gpt-6-luna`. It reads the named `paddle_target` choice, checks it against `MODEL_TARGETS`, and returns `{ targetY }` to the browser.

The [`Typesafe adapter`](lib/server/typesafe.ts) uses `jev-latest` at `https://api.typesafe.ai/v1/systemone`. It supplies the same input as `state` and the same target choices as `questions.paddle_target.criteria`, then reads `answers.paddle_target.choice`. Both adapters use the selected option's shared input, instructions, and choices from `getPaddleDecisionPrompt`. Provider formatting stays outside the simulation.

## Where the physics assistance happens

The intercept calculation in [`lib/paddle-decision.ts`](lib/paddle-decision.ts) projects the ball to the right paddle and folds its path into the legal ball-center range:

```ts
const secondsToContact = (contactX - ball.x) / ball.vx;
// Fold the straight-line path into the ball-center range, including repeated wall reflections.
const span = court.height - 2 * court.ballRadius;
const period = 2 * span;
const unfoldedY = ball.y - court.ballRadius + ball.vy * secondsToContact;
const foldedY = ((unfoldedY % period) + period) % period;
interceptY = round(court.ballRadius + Math.min(foldedY, period - foldedY));
```

This handles repeated top and bottom reflections without simulating every bounce. It runs only when the ball moves toward the right paddle and has not passed the contact plane. Otherwise, the intercept is null. The prediction assumes constant velocity apart from wall reflections; a later paddle hit changes the trajectory.

In model modes, the engine does not replace the model's target with this prediction. After the adapter returns a target, [`stepGame`](lib/game.ts) moves toward it by at most one step's travel distance:

```ts
right: actions.right === null ? state.paddles.right : clampPaddle(
  state.paddles.right + Math.max(-distance, Math.min(distance, actions.right - state.paddles.right)),
),
```

Here, `distance` is `COURT.paddleSpeed * dt`. The paddle stops at the destination without overshooting; a null target leaves it stationary. Return angles come from where the ball strikes the paddle, rather than a separate model-selected shot action.

The default opponent, **NO MODEL (game engine)**, plays locally without API requests or credentials. It uses the same wall-reflected intercept calculation each physics step, clamps the target to the legal paddle-center range, and returns toward center when the ball moves away. The normal paddle speed limit still applies, and the paddle stays still during serves.

## Architecture and decision timing

```text
Browser: fixed-step physics + React/SVG view
  → observation → POST /api/model-action
  → server validation → provider registry → compact paddle input
  → OpenAI Decisions or Typesafe Jev
  → validated { targetY } → browser decision loop → paddle movement
```

The shared contract in [`lib/model-controller.ts`](lib/model-controller.ts) keeps provider details out of the game:

```ts
export interface ModelDecision { targetY: number }

export type ModelController = (
  observation: ModelObservation,
  signal: AbortSignal,
) => Promise<ModelDecision>;
```

[`runModelController`](lib/run-model-controller.ts) allows at most one request in flight per session, starting requests no more often than every 250 ms (up to four decisions per second). Slower responses and retry backoff reduce the actual rate. The stale-response cutoff remains 500 ms. It requests decisions during active play after the serve delay, in either ball direction. The latest target stays active while a new request is pending; it has no timed expiry.

### Code map

| File | Responsibility |
| --- | --- |
| [`app/pong-game.tsx`](app/pong-game.tsx) | Keyboard input, rendering, fixed-step loop, session lifecycle |
| [`lib/game.ts`](lib/game.ts) | Pure simulation, collisions, scoring, paddle movement |
| [`lib/model-controller.ts`](lib/model-controller.ts) | Observation/action types, model catalog, targets, timing |
| [`lib/paddle-decision.ts`](lib/paddle-decision.ts) | Compact provider input, intercept calculation, instructions |
| [`lib/run-model-controller.ts`](lib/run-model-controller.ts) | Scheduling, stale decisions, cancellation, retries |
| [`app/api/model-action/route.ts`](app/api/model-action/route.ts) | Request validation, server timeout, diagnostics |
| [`lib/server/model-registry.ts`](lib/server/model-registry.ts) | Provider adapter selection |

To add a model from an existing provider, add an entry to `MODELS`. A new provider needs a controller factory registered in `model-registry.ts`, accepting the same observation and returning the same decision. Rendering and physics stay unchanged.

## Run locally

Use **Bun 1.3.0**, as declared in `package.json`.

```sh
bun install
```

Copy `.env.example` to `.env.local` and set the key for the provider you want to use:

```dotenv
OPENAI_API_KEY=
TYPESAFE_API_KEY=
```

Keys are read on the server. Restart the server after changing them.

```sh
bun run dev
```

Open [localhost:3000](http://localhost:3000). Select an opponent and difficulty, then start. The default **NO MODEL (game engine)** opponent needs no API key.

| Control | Action |
| --- | --- |
| W / S or ↑ / ↓ | Move the left paddle while the court is focused |
| Space | Start or pause |
| Escape / Pause button | Pause and open the menu |
| Reset match | Reset score and positions, retaining difficulty |


## Future Experiments

Next things I'd like to try:
1. More ways to let the model play without giving it the engine-calculated intercept point
2. Changing the model input to image instead of text - OpenAI decisions API already supports this. and Jev image model is coming soon
3. Adding locally run system one models like `Laya`
