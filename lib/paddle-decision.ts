import { MODEL_DECISION_INTERVAL_MS, type ModelObservation } from "./model-controller";

export const PADDLE_TARGET_INSTRUCTIONS = "Choose the right paddle center Y from the available targets. Coordinates start at the top left; positive Y is down. Positions are court units, velocities and paddle speed are units/second, and times are milliseconds. Use intercept.centerY as the desired center when intercept is present; it includes wall bounces. Negative targetOffsetY means above the current paddle, positive means below. Choose the available target closest to the desired center. If intercept is null, choose the target closest to recoveryCenterY. The game moves continuously toward your target at paddle.speed and stops there without overshooting. The target persists between requests until replaced or the session stops. Do not limit movement to one decision interval. Predictions assume unchanged ball speed and exclude request latency.";

export interface PaddleDecisionInput {
  court: { width: number; height: number };
  ball: ModelObservation["ball"] & { radius: number };
  paddle: { centerY: number; height: number; speed: number; minCenterY: number; maxCenterY: number; contactX: number };
  intercept: { inMs: number; centerY: number; hitToleranceY: number; targetOffsetY: number } | null;
  recoveryCenterY: number;
  control: { mode: "move_to_target"; decisionIntervalMs: number };
}

const round = (value: number) => Math.round(value * 100) / 100;

export function getPaddleDecisionInput(observation: ModelObservation): PaddleDecisionInput | null {
  const { ball, court, paddles } = observation;
  if (observation.phase !== "playing" || observation.serveIn > 0) return null;

  const paddleFaceX = court.width - court.paddleInset - court.paddleWidth;
  const contactX = paddleFaceX - court.ballRadius;
  const secondsToContact = ball.vx > 0 && ball.x < contactX ? (contactX - ball.x) / ball.vx : null;

  // Fold the trajectory into the legal ball-center interval for wall reflections.
  const span = court.height - 2 * court.ballRadius;
  const period = 2 * span;
  const unfoldedY = ball.y - court.ballRadius + ball.vy * (secondsToContact ?? 0);
  const foldedY = ((unfoldedY % period) + period) % period;
  const arrivalY = court.ballRadius + Math.min(foldedY, period - foldedY);

  return {
    court: { width: court.width, height: court.height },
    ball: { x: round(ball.x), y: round(ball.y), vx: round(ball.vx), vy: round(ball.vy), radius: court.ballRadius },
    paddle: {
      centerY: round(paddles.right),
      height: court.paddleHeight,
      speed: court.paddleSpeed,
      minCenterY: court.paddleHeight / 2,
      maxCenterY: court.height - court.paddleHeight / 2,
      contactX: paddleFaceX,
    },
    intercept: secondsToContact === null ? null : {
      inMs: round(secondsToContact * 1000),
      centerY: round(arrivalY),
      hitToleranceY: court.paddleHeight / 2 + court.ballRadius,
      targetOffsetY: round(arrivalY - paddles.right),
    },
    recoveryCenterY: court.height / 2,
    control: { mode: "move_to_target", decisionIntervalMs: MODEL_DECISION_INTERVAL_MS },
  };
}
