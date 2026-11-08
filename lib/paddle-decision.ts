import { MODEL_DECISION_INTERVAL_MS, type ModelObservation } from "./model-controller";

export const PADDLE_TARGET_INSTRUCTIONS = `Choose a right-paddle center Y to return the approaching ball. Coordinates start at the top left; positive Y is down. Positions are court units; velocities and paddle speed are units/second. Predict the path from ball position and velocity, reflecting at Y=ball.radius and Y=court.height-ball.radius. Contact occurs when ball.x+ball.radius reaches paddle.contactX and the ball overlaps the paddle vertically. Choose your recovery position when the ball moves away or has passed the paddle. The paddle moves toward your target at paddle.speed and stops there; the target persists until replaced. New requests start at least ${MODEL_DECISION_INTERVAL_MS} ms apart; movement is not limited to that interval.`;

export interface PaddleDecisionInput {
  court: { width: number; height: number };
  ball: ModelObservation["ball"] & { radius: number };
  paddle: { centerY: number; height: number; speed: number; contactX: number };
}

const round = (value: number) => Math.round(value * 100) / 100;

export function getPaddleDecisionInput(observation: ModelObservation): PaddleDecisionInput | null {
  const { ball, court, paddles } = observation;
  if (observation.phase !== "playing" || observation.serveIn > 0) return null;

  const paddleFaceX = court.width - court.paddleInset - court.paddleWidth;

  return {
    court: { width: court.width, height: court.height },
    ball: { x: round(ball.x), y: round(ball.y), vx: round(ball.vx), vy: round(ball.vy), radius: court.ballRadius },
    paddle: {
      centerY: round(paddles.right),
      height: court.paddleHeight,
      speed: court.paddleSpeed,
      contactX: paddleFaceX,
    },
  };
}
