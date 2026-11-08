import { clampPaddle } from "./game";
import { MODEL_ACTION_MS, MODEL_DECISION_INTERVAL_MS, type ModelObservation } from "./model-controller";

export interface PaddleDecisionInput {
  ballArrival: { inMs: number; centerY: number; hitToleranceY: number } | null;
  recoveryCenterY: number;
  control: { actionDurationMs: number; decisionIntervalMs: number };
  paddleCenterAfterAction: { up: number; stay: number; down: number };
}

const round = (value: number) => Math.round(value * 100) / 100;

export function getPaddleDecisionInput(observation: ModelObservation): PaddleDecisionInput | null {
  const { ball, court, paddles } = observation;
  if (observation.phase !== "playing" || observation.serveIn > 0) return null;

  // Contact occurs when the ball's right edge reaches the paddle's left face.
  const contactX = court.width - court.paddleInset - court.paddleWidth - court.ballRadius;
  const secondsToContact = ball.vx > 0 && ball.x < contactX ? (contactX - ball.x) / ball.vx : null;

  // Fold the straight-line trajectory into the legal ball-center interval.
  // The triangle wave accounts for any number of top/bottom wall reflections.
  const span = court.height - 2 * court.ballRadius;
  const period = 2 * span;
  const unfoldedY = ball.y - court.ballRadius + ball.vy * (secondsToContact ?? 0);
  const foldedY = ((unfoldedY % period) + period) % period;
  const arrivalY = court.ballRadius + Math.min(foldedY, period - foldedY);

  // If impact happens sooner, compare paddle positions at impact instead.
  const actionSeconds = MODEL_ACTION_MS / 1000;
  const movement = court.paddleSpeed * Math.min(secondsToContact ?? actionSeconds, actionSeconds);
  return {
    ballArrival: secondsToContact === null ? null : {
      inMs: round(secondsToContact * 1000),
      centerY: round(arrivalY),
      hitToleranceY: court.paddleHeight / 2 + court.ballRadius,
    },
    recoveryCenterY: court.height / 2,
    control: { actionDurationMs: MODEL_ACTION_MS, decisionIntervalMs: MODEL_DECISION_INTERVAL_MS },
    paddleCenterAfterAction: {
      up: round(clampPaddle(paddles.right - movement)),
      stay: round(paddles.right),
      down: round(clampPaddle(paddles.right + movement)),
    },
  };
}
