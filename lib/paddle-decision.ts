import { MODEL_TARGETS, type ModelObservation, type PaddleInputMode } from "./model-controller";

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

const SPATIAL_TARGET_INSTRUCTIONS = "You control the right paddle. All lengths use the same scale: court height is 100. Coordinates start at the upper left; Y increases downward. Velocities are units per second. The ball travels straight between collisions. Top and bottom wall collisions reverse vy; the ball center stays between radius and court.height minus radius. ballContactX is the ball-center X at contact with your paddle. Choose the paddle-center destination most likely to return the incoming ball, accounting for wall bounces. The paddle moves at paddle.speed and stops at the selected destination; it cannot teleport. Its center must remain between half its height and court.height minus half its height. When the ball travels away, choose a recovery position. A hit on the other paddle changes the ball velocity.";

const TARGET_LABELS = ["Top", "Near top", "Upper quarter", "Above center", "Center", "Below center", "Lower quarter", "Near bottom", "Bottom"];

export function getPaddleDecisionPrompt(observation: ModelObservation, inputMode: PaddleInputMode) {
  if (observation.phase !== "playing" || observation.serveIn > 0) return null;

  const { ball, court, paddles } = observation;
  // Scale both axes and velocities equally, preserving angles and travel times.
  const normalize = (value: number) => Math.round(value * 100 / court.height * 100) / 100;
  const input = inputMode === "intercept" ? getPaddleDecisionInput(observation) : {
    court: { width: normalize(court.width), height: normalize(court.height) },
    ball: {
      x: normalize(ball.x), y: normalize(ball.y), vx: normalize(ball.vx), vy: normalize(ball.vy),
      radius: normalize(court.ballRadius),
      horizontalDirection: ball.vx > 0 ? "toward you" : "away from you",
      verticalDirection: ball.vy < 0 ? "up" : ball.vy > 0 ? "down" : "level",
    },
    paddle: {
      centerY: normalize(paddles.right), height: normalize(court.paddleHeight), speed: normalize(court.paddleSpeed),
      ballContactX: normalize(court.width - court.paddleInset - court.paddleWidth - court.ballRadius),
    },
  };

  return {
    input,
    instructions: inputMode === "intercept" ? PADDLE_TARGET_INSTRUCTIONS : SPATIAL_TARGET_INSTRUCTIONS,
    choices: MODEL_TARGETS.map((targetY, index) => ({
      targetY,
      value: String(inputMode === "intercept" ? targetY : normalize(targetY)),
      description: inputMode === "intercept" ? `Paddle center Y = ${targetY}` : `${TARGET_LABELS[index]} — paddle center Y = ${normalize(targetY)}`,
    })),
  };
}
