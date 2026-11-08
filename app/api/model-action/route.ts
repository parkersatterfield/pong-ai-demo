import { DIFFICULTIES, COURT } from "@/lib/game";
import { MODEL_REQUEST_TIMEOUT_MS, type ModelObservation } from "@/lib/model-controller";
import { getModelController } from "@/lib/server/model-registry";
import { ModelError } from "@/lib/model-error";

function hasNumbers<K extends string>(value: unknown, keys: K[]): value is Record<K, number> {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return keys.every((key) => typeof record[key] === "number" && Number.isFinite(record[key]));
}

function parseObservation(value: unknown): ModelObservation | null {
  if (!value || typeof value !== "object" || !("phase" in value) || value.phase !== "playing" ||
    !hasNumbers(value, ["elapsed", "serveIn"]) ||
    !("court" in value) || !hasNumbers(value.court, ["ballSpeed"]) ||
    !DIFFICULTIES.map(({ ballSpeed }): number => ballSpeed).includes(value.court.ballSpeed) ||
    !("ball" in value) || !hasNumbers(value.ball, ["x", "y", "vx", "vy"]) ||
    !("paddles" in value) || !hasNumbers(value.paddles, ["left", "right"]) ||
    !("score" in value) || !hasNumbers(value.score, ["left", "right"])) return null;

  return {
    phase: "playing",
    elapsed: value.elapsed,
    serveIn: value.serveIn,
    ball: { x: value.ball.x, y: value.ball.y, vx: value.ball.vx, vy: value.ball.vy },
    paddles: { left: value.paddles.left, right: value.paddles.right },
    score: { left: value.score.left, right: value.score.right },
    court: { ...COURT, ballSpeed: value.court.ballSpeed },
  };
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected a JSON request body." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || !("modelId" in body) || typeof body.modelId !== "string" || !("observation" in body)) {
    return Response.json({ error: "Expected modelId and observation." }, { status: 400 });
  }
  const controller = getModelController(body.modelId);
  if (!controller) return Response.json({ error: "Unknown model." }, { status: 400 });

  const observation = parseObservation(body.observation);
  if (!observation) return Response.json({ error: "Invalid game observation." }, { status: 400 });

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(MODEL_REQUEST_TIMEOUT_MS)]);
  try {
    const decision = await controller(observation, signal);
    return Response.json(decision, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ModelError) {
      return Response.json({ error: error.message, details: error.details }, {
        status: error.status,
        headers: { ...error.details.headers, "Cache-Control": "no-store" },
      });
    }
    return Response.json({
      error: signal.aborted ? "Model request timed out or was cancelled." : "Model request failed.",
    }, { status: signal.aborted ? 504 : 502 });
  }
}
