import type { ModelObservation } from "./model-controller";

export const PADDLE_TARGET_INSTRUCTIONS = "Choose the paddle-center target closest to interceptY; it includes wall reflections. If interceptY is null, choose a recovery position. The paddle moves toward your target at paddle.speed and stops there.";

export interface PaddleDecisionInput {
  court: { width: number; height: number };
  ball: ModelObservation["ball"] & { radius: number };
  paddle: { centerY: number; height: number; speed: number; contactX: number };
  interceptY: number | null;
}

const round = (value: number) => Math.round(value * 100) / 100;

export function getPaddleDecisionInput(observation: ModelObservation): PaddleDecisionInput | null {
  const { ball, court, paddles } = observation;
  if (observation.phase !== "playing" || observation.serveIn > 0) return null;

  const paddleFaceX = court.width - court.paddleInset - court.paddleWidth;
  const contactX = paddleFaceX - court.ballRadius;
  let interceptY: number | null = null;

  if (ball.vx > 0 && ball.x <= contactX) {
    const secondsToContact = (contactX - ball.x) / ball.vx;
    // Fold the straight-line path into the ball-center range, including repeated wall reflections.
    const span = court.height - 2 * court.ballRadius;
    const period = 2 * span;
    const unfoldedY = ball.y - court.ballRadius + ball.vy * secondsToContact;
    const foldedY = ((unfoldedY % period) + period) % period;
    interceptY = round(court.ballRadius + Math.min(foldedY, period - foldedY));
  }

  return {
    court: { width: court.width, height: court.height },
    ball: { x: round(ball.x), y: round(ball.y), vx: round(ball.vx), vy: round(ball.vy), radius: court.ballRadius },
    paddle: {
      centerY: round(paddles.right),
      height: court.paddleHeight,
      speed: court.paddleSpeed,
      contactX: paddleFaceX,
    },
    interceptY,
  };
}
