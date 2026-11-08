export const DIFFICULTIES = [
  { id: "easy", label: "Easy", ballSpeed: 300 },
  { id: "medium", label: "Medium", ballSpeed: 450 },
  { id: "hard", label: "Hard", ballSpeed: 600 },
  { id: "extra-hard", label: "Extra hard", ballSpeed: 800 },
] as const;

export const COURT = {
  width: 960,
  height: 540,
  paddleWidth: 12,
  paddleHeight: 88,
  paddleInset: 32,
  paddleSpeed: 440,
  ballRadius: 7,
  ballSpeed: DIFFICULTIES[1].ballSpeed,
  winningScore: 7,
} as const;

export type GamePhase = "ready" | "playing" | "paused" | "finished";
export type Side = "left" | "right";

export interface GameState {
  ballSpeed: number;
  phase: GamePhase;
  elapsed: number;
  paddles: Record<Side, number>;
  ball: { x: number; y: number; vx: number; vy: number };
  score: Record<Side, number>;
  serveIn: number;
}

function serve(direction: number, speed: number) {
  const angle = Math.atan(0.35);
  return {
    x: COURT.width / 2,
    y: COURT.height / 2,
    vx: direction * speed * Math.cos(angle),
    vy: speed * Math.sin(angle),
  };
}

export function createGame(ballSpeed: number = COURT.ballSpeed): GameState {
  return {
    ballSpeed,
    phase: "ready",
    elapsed: 0,
    paddles: { left: COURT.height / 2, right: COURT.height / 2 },
    ball: serve(-1, ballSpeed),
    score: { left: 0, right: 0 },
    serveIn: 0.8,
  };
}

export function setBallSpeed(state: GameState, ballSpeed: number): GameState {
  const scale = ballSpeed / Math.hypot(state.ball.vx, state.ball.vy);
  return {
    ...state,
    ballSpeed,
    ball: { ...state.ball, vx: state.ball.vx * scale, vy: state.ball.vy * scale },
  };
}

export function clampPaddle(y: number) {
  return Math.max(COURT.paddleHeight / 2, Math.min(COURT.height - COURT.paddleHeight / 2, y));
}

// Coordinates are court units; velocities are court units per second.
// The caller advances the simulation using fixed, small time steps.
// Left input ranges from -1 (up) to 1 (down); right input is a target Y.
export function stepGame(
  state: GameState,
  actions: { left: number; right: number | null },
  dt: number,
): GameState {
  if (state.phase !== "playing") return state;

  const distance = COURT.paddleSpeed * dt;
  const paddles = {
    left: clampPaddle(state.paddles.left + actions.left * distance),
    right: actions.right === null ? state.paddles.right : clampPaddle(
      state.paddles.right + Math.max(-distance, Math.min(distance, actions.right - state.paddles.right)),
    ),
  };
  const next = { ...state, paddles, elapsed: state.elapsed + dt };

  if (state.serveIn > 0) {
    return { ...next, serveIn: Math.max(0, state.serveIn - dt) };
  }

  const ball = { ...state.ball, x: state.ball.x + state.ball.vx * dt, y: state.ball.y + state.ball.vy * dt };
  const radius = COURT.ballRadius;
  if (ball.y < radius) {
    ball.y = 2 * radius - ball.y;
    ball.vy = Math.abs(ball.vy);
  } else if (ball.y > COURT.height - radius) {
    ball.y = 2 * (COURT.height - radius) - ball.y;
    ball.vy = -Math.abs(ball.vy);
  }

  const side = ball.vx < 0 ? "left" : "right";
  const face = side === "left" ? COURT.paddleInset + COURT.paddleWidth : COURT.width - COURT.paddleInset - COURT.paddleWidth;
  const crossedPaddle = side === "left"
    ? state.ball.x - radius >= face && ball.x - radius <= face
    : state.ball.x + radius <= face && ball.x + radius >= face;

  if (crossedPaddle && Math.abs(ball.y - paddles[side]) <= COURT.paddleHeight / 2 + radius) {
    const offset = Math.max(-1, Math.min(1, (ball.y - paddles[side]) / (COURT.paddleHeight / 2)));
    const angle = offset * Math.PI / 3;
    ball.x = face + (side === "left" ? radius : -radius);
    ball.vx = (side === "left" ? 1 : -1) * state.ballSpeed * Math.cos(angle);
    ball.vy = state.ballSpeed * Math.sin(angle);
  }

  if (ball.x < -radius || ball.x > COURT.width + radius) {
    const scorer = ball.x < 0 ? "right" : "left";
    const score = { ...state.score, [scorer]: state.score[scorer] + 1 };
    return {
      ...next,
      score,
      paddles: { left: COURT.height / 2, right: COURT.height / 2 },
      phase: score[scorer] >= COURT.winningScore ? "finished" : "playing",
      ball: serve(scorer === "left" ? 1 : -1, state.ballSpeed),
      serveIn: 0.8,
    };
  }

  return { ...next, ball };
}
