export const COURT = {
  width: 960,
  height: 540,
  paddleWidth: 12,
  paddleHeight: 88,
  paddleInset: 32,
  paddleSpeed: 440,
  ballRadius: 7,
  ballSpeed: 360,
  winningScore: 7,
} as const;

export type PaddleAction = "up" | "down" | "stay";
export type GamePhase = "ready" | "playing" | "paused" | "finished";
export type Side = "left" | "right";

export interface GameState {
  phase: GamePhase;
  elapsed: number;
  paddles: Record<Side, number>;
  ball: { x: number; y: number; vx: number; vy: number };
  score: Record<Side, number>;
  serveIn: number;
}

function serve(direction: number) {
  return {
    x: COURT.width / 2,
    y: COURT.height / 2,
    vx: direction * COURT.ballSpeed,
    vy: COURT.ballSpeed * 0.35,
  };
}

export function createGame(): GameState {
  return {
    phase: "ready",
    elapsed: 0,
    paddles: { left: COURT.height / 2, right: COURT.height / 2 },
    ball: serve(-1),
    score: { left: 0, right: 0 },
    serveIn: 0.8,
  };
}

export function clampPaddle(y: number) {
  return Math.max(COURT.paddleHeight / 2, Math.min(COURT.height - COURT.paddleHeight / 2, y));
}

// Coordinates are court units; velocities are court units per second.
// The caller advances the simulation using fixed, small time steps.
export function stepGame(
  state: GameState,
  actions: Record<Side, PaddleAction>,
  dt: number,
): GameState {
  if (state.phase !== "playing") return state;

  const move = (side: Side) => clampPaddle(
    state.paddles[side] + (actions[side] === "up" ? -1 : actions[side] === "down" ? 1 : 0) * COURT.paddleSpeed * dt,
  );
  const paddles = { left: move("left"), right: move("right") };
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
    ball.vx = (side === "left" ? 1 : -1) * COURT.ballSpeed * Math.cos(angle);
    ball.vy = COURT.ballSpeed * Math.sin(angle);
  }

  if (ball.x < -radius || ball.x > COURT.width + radius) {
    const scorer = ball.x < 0 ? "right" : "left";
    const score = { ...state.score, [scorer]: state.score[scorer] + 1 };
    return {
      ...next,
      score,
      paddles: { left: COURT.height / 2, right: COURT.height / 2 },
      phase: score[scorer] >= COURT.winningScore ? "finished" : "playing",
      ball: serve(scorer === "left" ? 1 : -1),
      serveIn: 0.8,
    };
  }

  return { ...next, ball };
}
