import { MODEL_DECISION_INTERVAL_MS, type ModelObservation } from "./model-controller";

export const PADDLE_TARGET_INSTRUCTIONS = "Choose the right paddle center Y from the available targets to intercept the ball. Coordinates start at the top left; positive Y is down. Positions are court units, velocities and paddle speed are units/second, and the decision interval is milliseconds. Use the ball position, velocity, and motion description to predict its path. motion gives horizontal and vertical directions and distances traveled along those directions over control.decisionIntervalMs, assuming no collisions. Those distances are not predicted future positions; collisions can change direction during the interval. The ball reflects off the top and bottom walls, with its center staying between ball.radius and court.height minus ball.radius. When the ball is moving away from the right paddle or has passed it, choose the target closest to recoveryCenterY. The game moves continuously toward your target at paddle.speed and stops there without overshooting. The target persists between requests until replaced or the session stops. Do not limit movement to one decision interval.";

export interface PaddleDecisionInput {
  court: { width: number; height: number };
  ball: ModelObservation["ball"] & { radius: number };
  motion: {
    horizontalDirection: "left" | "right" | "stationary";
    verticalDirection: "up" | "down" | "stationary";
    horizontalDistancePerDecision: number;
    verticalDistancePerDecision: number;
  };
  paddle: { centerY: number; height: number; speed: number; minCenterY: number; maxCenterY: number; contactX: number };
  recoveryCenterY: number;
  control: { mode: "move_to_target"; decisionIntervalMs: number };
}

const round = (value: number) => Math.round(value * 100) / 100;

export function getPaddleDecisionInput(observation: ModelObservation): PaddleDecisionInput | null {
  const { ball, court, paddles } = observation;
  if (observation.phase !== "playing" || observation.serveIn > 0) return null;

  const paddleFaceX = court.width - court.paddleInset - court.paddleWidth;
  const decisionSeconds = MODEL_DECISION_INTERVAL_MS / 1000;

  return {
    court: { width: court.width, height: court.height },
    ball: { x: round(ball.x), y: round(ball.y), vx: round(ball.vx), vy: round(ball.vy), radius: court.ballRadius },
    motion: {
      horizontalDirection: ball.vx > 0 ? "right" : ball.vx < 0 ? "left" : "stationary",
      verticalDirection: ball.vy > 0 ? "down" : ball.vy < 0 ? "up" : "stationary",
      horizontalDistancePerDecision: round(Math.abs(ball.vx) * decisionSeconds),
      verticalDistancePerDecision: round(Math.abs(ball.vy) * decisionSeconds),
    },
    paddle: {
      centerY: round(paddles.right),
      height: court.paddleHeight,
      speed: court.paddleSpeed,
      minCenterY: court.paddleHeight / 2,
      maxCenterY: court.height - court.paddleHeight / 2,
      contactX: paddleFaceX,
    },
    recoveryCenterY: court.height / 2,
    control: { mode: "move_to_target", decisionIntervalMs: MODEL_DECISION_INTERVAL_MS },
  };
}
