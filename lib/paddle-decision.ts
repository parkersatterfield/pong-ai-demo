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

const SPATIAL_TARGET_INSTRUCTIONS = [
  "You control the right paddle. Choose one destination to return the ball.",
  "Use the named height bands, directions, and relative positions first; numbers provide finer detail. Height bands describe current positions, not future landing positions.",
  "Your paddle needs time to travel. When the ball is far away and approaching, commit early to where you expect it to arrive. Waiting until it is near your paddle can make a correct destination unreachable. Choose a destination you can move toward now, rather than following the ball's current height as it travels. For a mostly horizontal shot, favor its current height. For a diagonal shot, allow for its upward or downward travel before it reaches you.",
  "Top and bottom wall bounces reverse up/down motion. Consider whether the ball reaches a wall before your paddle; do not keep aiming upward after an observed downward bounce, or downward after an upward bounce.",
  "When the ball is near your paddle, prioritize covering its height now. If it is above or below your reach, choose a destination that moves toward it. When the ball travels away or has passed your paddle, recover toward Center.",
  "Choose the destination, not a small movement step. A distant destination keeps the paddle moving at full speed until it arrives; you need not select each intermediate band. It cannot teleport. Each new choice replaces the previous destination.",
  "Court height is 100; all lengths share one scale. Origin is upper left; Y increases downward. Velocities are units per second. The ball travels straight between collisions; wall contact is at radius or court.height minus radius. ballContactX is its center X at your paddle. Other-paddle hits change velocity.",
].join(" ");

const TARGET_LABELS = ["Top", "Near top", "Upper quarter", "Above center", "Center", "Below center", "Lower quarter", "Near bottom", "Bottom"];

function describeHeight(y: number) {
  const index = MODEL_TARGETS.reduce((nearest, target, index) =>
    Math.abs(target - y) < Math.abs(MODEL_TARGETS[nearest] - y) ? index : nearest, 0);
  return TARGET_LABELS[index];
}

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
      heightBand: describeHeight(ball.y),
      relativeToPaddle: Math.abs(ball.y - paddles.right) <= court.paddleHeight / 2 + court.ballRadius
        ? "within your paddle's vertical reach" : ball.y < paddles.right ? "above your paddle's reach" : "below your paddle's reach",
      horizontalPosition: ball.x > court.width - court.paddleInset - court.paddleWidth - court.ballRadius
        ? "past your paddle" : ball.x >= court.width * 5 / 6 ? "near your paddle" : ball.x >= court.width / 2 ? "your half" : "opponent half",
      slope: Math.abs(ball.vy) <= Math.abs(ball.vx) / 2 ? "mostly horizontal"
        : Math.abs(ball.vy) > Math.abs(ball.vx) * 1.5 ? "steep diagonal" : "diagonal",
    },
    paddle: {
      centerY: normalize(paddles.right), height: normalize(court.paddleHeight), speed: normalize(court.paddleSpeed),
      ballContactX: normalize(court.width - court.paddleInset - court.paddleWidth - court.ballRadius),
      heightBand: describeHeight(paddles.right),
    },
  };

  return {
    input,
    instructions: inputMode === "intercept" ? PADDLE_TARGET_INSTRUCTIONS : SPATIAL_TARGET_INSTRUCTIONS,
    choices: MODEL_TARGETS.map((targetY, index) => ({
      targetY,
      value: inputMode === "intercept" ? String(targetY) : TARGET_LABELS[index],
      description: inputMode === "intercept" ? `Paddle center Y = ${targetY}`
        : `${targetY < paddles.right ? "Move up to" : targetY > paddles.right ? "Move down to" : "Stay at"} ${TARGET_LABELS[index]} (paddle center Y = ${normalize(targetY)}).`,
    })),
  };
}
