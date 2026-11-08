import {
  MODEL_ACTION_MS,
  MODEL_DECISION_INTERVAL_MS,
  MODEL_REQUEST_TIMEOUT_MS,
  MODEL_OBSERVATION_MAX_AGE_MS,
  type ModelController,
  type ModelObservation,
} from "./model-controller";
import { ModelError } from "./model-error";
import type { PaddleAction } from "./game";

const IDLE_CHECK_MS = 100;
const MAX_RETRIES = 3;
const MAX_RETRY_MS = 60_000;

export interface ModelRetryState {
  failures: number;
  startedAt: number | null;
  nextRequestAt: number;
}

function canDecide(observation: ModelObservation) {
  return observation.phase === "playing" && observation.serveIn === 0;
}

// Retry state belongs to the selected model and survives rally/session cancellation.
export function runModelController({ controller, observe, onAction, onStatus, onError, retry }: {
  controller: ModelController;
  observe: () => ModelObservation;
  onAction: (action: PaddleAction) => void;
  onStatus: (message: string | null) => void;
  onError: (message: string) => void;
  retry: ModelRetryState;
}) {
  const session = new AbortController();
  let nextDecision: ReturnType<typeof setTimeout>;
  let actionExpiry: ReturnType<typeof setTimeout>;

  function stay() {
    clearTimeout(actionExpiry);
    onAction("stay");
  }

  function stop() {
    session.abort();
    clearTimeout(nextDecision);
    stay();
  }

  async function decide() {
    if (retry.startedAt !== null && Date.now() - retry.startedAt >= MAX_RETRY_MS) {
      stop();
      onError("Model retry time limit reached. Resume to retry.");
      return;
    }
    const wait = retry.nextRequestAt - Date.now();
    if (wait > 0) {
      // Short local waits also handle long Retry-After values without timer overflow.
      nextDecision = setTimeout(decide, Math.min(wait, 1000));
      return;
    }
    const observation = observe();
    if (!canDecide(observation)) {
      stay();
      nextDecision = setTimeout(decide, IDLE_CHECK_MS);
      return;
    }

    const started = performance.now();
    retry.nextRequestAt = Date.now() + MODEL_DECISION_INTERVAL_MS;
    const attemptTimeout = retry.startedAt === null ? MODEL_REQUEST_TIMEOUT_MS
      : Math.min(MODEL_REQUEST_TIMEOUT_MS, MAX_RETRY_MS - (Date.now() - retry.startedAt));
    const signal = AbortSignal.any([session.signal, AbortSignal.timeout(Math.max(1, attemptTimeout))]);
    try {
      const action = await controller(observation, signal);
      if (session.signal.aborted) return;
      retry.failures = 0;
      retry.startedAt = null;
      if (!canDecide(observe())) {
        stay();
        onStatus(null);
      } else if (performance.now() - started > MODEL_OBSERVATION_MAX_AGE_MS) {
        stay();
        onStatus("Stale model decision discarded; waiting for the next decision.");
      } else {
        clearTimeout(actionExpiry);
        onAction(action);
        actionExpiry = setTimeout(stay, MODEL_ACTION_MS);
        onStatus(null);
      }
    } catch (error) {
      if (session.signal.aborted) return;
      stay();
      if (error instanceof ModelError && error.details.retryable) {
        retry.failures++;
        retry.startedAt ??= Date.now();
        const backoff = 1000 * 2 ** (retry.failures - 1);
        const delay = Math.max(MODEL_DECISION_INTERVAL_MS, error.details.retryAfterMs ?? backoff) + Math.random() * 250;
        retry.nextRequestAt = Date.now() + delay;
        if (retry.failures > MAX_RETRIES || retry.nextRequestAt - retry.startedAt > MAX_RETRY_MS) {
          stop();
          onError(`${error.message} Automatic retry limit reached. Resume after the cooldown to retry.`);
          return;
        }
        onStatus(`${error.message} Next attempt after ${new Date(retry.nextRequestAt).toLocaleTimeString()}.`);
      } else {
        stop();
        onError(signal.aborted ? "Model request timed out." : error instanceof Error ? error.message : "Model request failed.");
        return;
      }
    }
    nextDecision = setTimeout(decide, Math.min(1000, Math.max(0, retry.nextRequestAt - Date.now())));
  }

  // Schedule rather than running callbacks during a React effect's setup.
  nextDecision = setTimeout(decide, 0);
  return stop;
}
