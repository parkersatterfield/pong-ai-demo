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

  function stay() {
    onTarget(null);
  }

  function stop() {
    session.abort();
    clearTimeout(nextDecision);
    stay();
    onResponse(null);
  }

  function logOutcome(outcome: string, started: number) {
    if (process.env.NODE_ENV === "development") {
      console.debug("[model-decision]", { modelId, outcome, responseMs: Math.round(performance.now() - started) });
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
      const decision = await controller(observation, signal);
      if (session.signal.aborted) return;
      onResponse(Math.round(performance.now() - started));
      retry.failures = 0;
      retry.startedAt = null;
      if (!canDecide(observe())) {
        stay();
        onStatus(null);
        logOutcome("inactive", started);
      } else if (performance.now() - started > MODEL_OBSERVATION_MAX_AGE_MS) {
        onStatus("Stale model decision discarded; retaining the previous target.");
        logOutcome("stale", started);
      } else {
        onTarget(decision.targetY);
        onStatus(null);
        logOutcome("accepted", started);
      }
    } catch (error) {
      if (session.signal.aborted) return;
      const timedOut = signal.aborted || error instanceof ModelError && error.details.code === "request_timeout";
      const message = timedOut ? "Model request timed out." : error instanceof Error ? error.message : "Model request failed.";
      logOutcome(timedOut ? "timeout" : "error", started);
      if (!timedOut) stay();
      if (timedOut || error instanceof ModelError && error.details.retryable) {
        retry.failures++;
        retry.startedAt ??= Date.now();
        const backoff = 1000 * 2 ** (retry.failures - 1);
        const retryAfter = error instanceof ModelError ? error.details.retryAfterMs : undefined;
        const delay = Math.max(MODEL_DECISION_INTERVAL_MS, retryAfter ?? backoff) + Math.random() * 250;
        retry.nextRequestAt = Date.now() + delay;
        if (retry.failures > MAX_RETRIES || retry.nextRequestAt - retry.startedAt > MAX_RETRY_MS) {
          stop();
          onError(`${message} Automatic retry limit reached. Resume after the cooldown to retry.`);
          return;
        }
        onStatus(`${message}${timedOut ? " Retaining the previous target." : ""} Next attempt after ${new Date(retry.nextRequestAt).toLocaleTimeString()}.`);
      } else {
        stop();
        onError(message);
        return;
      }
    }
    nextDecision = setTimeout(decide, Math.min(1000, Math.max(0, retry.nextRequestAt - Date.now())));
  }

  // Schedule rather than running callbacks during a React effect's setup.
  nextDecision = setTimeout(decide, 0);
  return stop;
}
