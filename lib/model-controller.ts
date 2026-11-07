import { COURT, type GameState, type PaddleAction } from "./game";

// The model controls the right paddle. Positive Y points down.
export interface ModelObservation {
  elapsed: number;
  phase: GameState["phase"];
  court: typeof COURT;
  ball: GameState["ball"];
  paddles: GameState["paddles"];
  score: GameState["score"];
  serveIn: number;
}

// A future server endpoint implements this transport-independent contract.
export type ModelController = (
  observation: ModelObservation,
  signal: AbortSignal,
) => Promise<PaddleAction>;

export function getModelObservation(state: GameState): ModelObservation {
  return {
    elapsed: state.elapsed,
    phase: state.phase,
    court: { ...COURT },
    ball: { ...state.ball },
    paddles: { ...state.paddles },
    score: { ...state.score },
    serveIn: state.serveIn,
  };
}
