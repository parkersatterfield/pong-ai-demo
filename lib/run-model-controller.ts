import {
  MODEL_DECISION_INTERVAL_MS,
  MODEL_REQUEST_TIMEOUT_MS,
  MODEL_OBSERVATION_MAX_AGE_MS,
  type ModelController,
  type ModelObservation,
} from "./model-controller";
import { ModelError } from "./model-error";

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
export function runModelController({ modelId, controller, observe, onTarget, onStatus, onResponse, onError, retry }: {
  modelId: string;
  controller: ModelController;
  observe: () => ModelObservation;
  onTarget: (targetY: number | null) => void;
  onStatus: (message: string | null) => void;
  onResponse: (responseMs: number | null) => void;
  onError: (message: string) => void;
  retry: ModelRetryState;
}) {
  const session = new AbortController();
  let nextDecision: ReturnType<typeof setTimeout>;

  function schedule(delayMs = 0) {
    // Recheck long cooldowns in short slices to avoid timer overflow.
    nextDecision = setTimeout(decide, Math.min(1000, Math.max(0, delayMs)));
  }

  function stop() {
    session.abort();
    clearTimeout(nextDecision);
    onTarget(null);
    onResponse(null);
  }

  function logOutcome(outcome: string, responseMs: number) {
    if (process.env.NODE_ENV === "development") {
      console.debug("[model-decision]", { modelId, outcome, responseMs: Math.round(responseMs) });
    }
  }

  async function decide() {
    if (retry.startedAt !== null && Date.now() - retry.startedAt >= MAX_RETRY_MS) {
      stop();
      onError("Model retry time limit reached. Resume to retry.");
      return;
    }
    const wait = retry.nextRequestAt - Date.now();
    if (wait > 0) {
      schedule(wait);
      return;
    }
    const observation = observe();
    if (!canDecide(observation)) {
      onTarget(null);
      schedule(IDLE_CHECK_MS);
      return;
    }

    const started = performance.now();
    retry.nextRequestAt = Date.now() + MODEL_DECISION_INTERVAL_MS;
    const attemptTimeout = retry.startedAt === null ? MODEL_REQUEST_TIMEOUT_MS
      : Math.min(MODEL_REQUEST_TIMEOUT_MS, MAX_RETRY_MS - (Date.now() - retry.startedAt));
    const signal = AbortSignal.any([session.signal, AbortSignal.timeout(Math.max(1, attemptTimeout))]);
    try {
      const decision = await controller(observation, signal);
      if (session.signal.aborted) return;
      const responseMs = performance.now() - started;
      onResponse(Math.round(responseMs));
      retry.failures = 0;
      retry.startedAt = null;
      if (!canDecide(observe())) {
        onTarget(null);
        onStatus(null);
        logOutcome("inactive", responseMs);
      } else if (responseMs > MODEL_OBSERVATION_MAX_AGE_MS) {
        onStatus("Stale model decision discarded; retaining the previous target.");
        logOutcome("stale", responseMs);
      } else {
        onTarget(decision.targetY);
        onStatus(null);
        logOutcome("accepted", responseMs);
      }
    } catch (error) {
      if (session.signal.aborted) return;
      const modelError = error instanceof ModelError ? error : null;
      const timedOut = signal.aborted || modelError?.details.code === "request_timeout";
      const message = timedOut ? "Model request timed out."
        : error instanceof Error ? error.message : "Model request failed.";
      logOutcome(timedOut ? "timeout" : "error", performance.now() - started);
      if (!timedOut && !modelError?.details.retryable) {
        stop();
        onError(message);
        return;
      }

      if (!timedOut) onTarget(null);
      retry.failures++;
      retry.startedAt ??= Date.now();
      const backoff = 1000 * 2 ** (retry.failures - 1);
      const delay = Math.max(MODEL_DECISION_INTERVAL_MS, modelError?.details.retryAfterMs ?? backoff) + Math.random() * 250;
      retry.nextRequestAt = Date.now() + delay;
      if (retry.failures > MAX_RETRIES || retry.nextRequestAt - retry.startedAt > MAX_RETRY_MS) {
        stop();
        onError(`${message} Automatic retry limit reached. Resume after the cooldown to retry.`);
        return;
      }
      const retainedTarget = timedOut ? " Retaining the previous target." : "";
      onStatus(`${message}${retainedTarget} Next attempt after ${new Date(retry.nextRequestAt).toLocaleTimeString()}.`);
    }
    schedule(retry.nextRequestAt - Date.now());
  }

  // Schedule rather than running callbacks during a React effect's setup.
  schedule();
  return stop;
}
