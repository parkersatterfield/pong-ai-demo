import { COURT, type GameState, type PaddleAction } from "./game";

// The model controls the right paddle. Positive Y points down.
export interface ModelObservation {
  elapsed: number;
  phase: GameState["phase"];
  court: Omit<typeof COURT, "ballSpeed"> & { ballSpeed: number };
  ball: GameState["ball"];
  paddles: GameState["paddles"];
  score: GameState["score"];
  serveIn: number;
}

export const MODEL_ACTION_MS = 200;
export const MODEL_REQUEST_TIMEOUT_MS = 1000;
export const MODEL_DECISION_INTERVAL_MS = 500;
export const MODEL_OBSERVATION_MAX_AGE_MS = 500;

// Add model entries here; provider implementations stay on the server.
export const MODELS = [
  { id: "openai-decisions", label: "OpenAI Decisions / gpt-6-luna", provider: "openai-decisions", model: "gpt-6-luna" },
] as const;

// All providers implement the same observation-to-action contract.
export type ModelController = (
  observation: ModelObservation,
  signal: AbortSignal,
) => Promise<PaddleAction>;

export function isPaddleAction(value: unknown): value is PaddleAction {
  return value === "up" || value === "down" || value === "stay";
}

export function getModelObservation(state: GameState): ModelObservation {
  return {
    elapsed: state.elapsed,
    phase: state.phase,
    court: { ...COURT, ballSpeed: state.ballSpeed },
    ball: { ...state.ball },
    paddles: { ...state.paddles },
    score: { ...state.score },
    serveIn: state.serveIn,
  };
}
