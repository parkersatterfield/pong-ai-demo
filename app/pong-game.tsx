"use client";

import { useEffect, useRef, useState } from "react";
import { DIFFICULTIES, COURT, clampPaddle, createGame, setBallSpeed, stepGame, type GameState } from "@/lib/game";
import { MODELS, MODEL_DECISION_INTERVAL_MS, getModelObservation } from "@/lib/model-controller";
import { createRemoteController } from "@/lib/request-model-action";
import { runModelController, type ModelRetryState } from "@/lib/run-model-controller";
import { getPaddleDecisionInput } from "@/lib/paddle-decision";

const STEP = 1 / 120;
const PLAYER_RAMP_SECONDS = 0.06;

function getEngineTarget(state: GameState): number | null {
  const input = getPaddleDecisionInput(getModelObservation(state));
  return input ? clampPaddle(input.interceptY ?? COURT.height / 2) : null;
}

export default function PongGame() {
  const [view, setView] = useState(createGame);
  const game = useRef(view);
  const court = useRef<SVGSVGElement>(null);
  const keys = useRef(new Set<string>());
  const playerInput = useRef(0);
  const modelTargetY = useRef<number | null>(null);
  const modelSession = useRef<(() => void) | null>(null);
  const modelRetries = useRef<Record<string, ModelRetryState>>({});
  const [modelId, setModelId] = useState<string>(MODELS[0].id);
  const engineControlled = modelId === "no-model";
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelNotice, setModelNotice] = useState<string | null>(null);
  const [modelDecision, setDecision] = useState<{ targetY: number; at: number } | null>(null);
  const [responseMs, setResponseMs] = useState<number | null>(null);

  function resetRetryBudget(id: string) {
    const retry = modelRetries.current[id];
    if (retry) {
      retry.failures = 0;
      retry.startedAt = null;
    }
  }

  function stopModel() {
    modelSession.current?.();
    modelTargetY.current = null;
    setDecision(null);
    setResponseMs(null);
  }

  function togglePlay() {
    stopModel();
    setModelError(null);
    setModelNotice(null);
    const current = game.current;
    if (current.phase !== "playing") resetRetryBudget(modelId);
    if (current.phase === "finished") game.current = createGame(current.ballSpeed);
    game.current = { ...game.current, phase: current.phase === "playing" ? "paused" : "playing" };
    setView(game.current);
  }

  function reset() {
    stopModel();
    setModelError(null);
    setModelNotice(null);
    resetRetryBudget(modelId);
    game.current = createGame(game.current.ballSpeed);
    playerInput.current = 0;
    keys.current.clear();
    setView(game.current);
  }

  useEffect(() => {
    if (view.phase !== "playing" || !modelId || engineControlled) return;

    const retry = modelRetries.current[modelId] ??= { failures: 0, startedAt: null, nextRequestAt: 0 };
    const stop = runModelController({
      modelId,
      controller: createRemoteController(modelId),
      observe: () => getModelObservation(game.current),
      onTarget: (targetY) => {
        modelTargetY.current = targetY;
        setDecision(targetY === null ? null : { targetY, at: game.current.elapsed });
      },
      onStatus: setModelNotice,
      onResponse: setResponseMs,
      retry,
      onError: (message) => {
        setModelError(message);
        game.current = { ...game.current, phase: "paused" };
        setView(game.current);
      },
    });
    modelSession.current = stop;
    return stop;
  }, [modelId, engineControlled, view.phase, view.score.left, view.score.right, view.ballSpeed]);

  useEffect(() => {
    let frame: number;
    let previous = 0;
    let accumulator = 0;

    function animate(now: number) {
      const delta = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
      previous = now;
      accumulator += delta;
      while (accumulator >= STEP) {
        const up = keys.current.has("w") || keys.current.has("arrowup");
        const down = keys.current.has("s") || keys.current.has("arrowdown");
        const direction = up === down ? 0 : up ? -1 : 1;
        // Ramp briefly on press and reversal; releasing the keys stops immediately.
        playerInput.current = game.current.phase !== "playing" || direction === 0 ? 0 :
          playerInput.current + Math.max(-STEP / PLAYER_RAMP_SECONDS,
            Math.min(STEP / PLAYER_RAMP_SECONDS, direction - playerInput.current));
        const previousScore = game.current.score;
        game.current = stepGame(game.current, {
          left: playerInput.current,
          right: engineControlled ? getEngineTarget(game.current) : game.current.serveIn === 0 ? modelTargetY.current : null,
        }, STEP);
        if (game.current.score !== previousScore) {
          modelSession.current?.();
          playerInput.current = 0;
        }
        accumulator -= STEP;
      }
      setView(game.current);
      frame = requestAnimationFrame(animate);
    }

    function pause() {
      modelSession.current?.();
      keys.current.clear();
      playerInput.current = 0;
      if (game.current.phase === "playing") {
        game.current = { ...game.current, phase: "paused" };
        setView(game.current);
      }
    }

    frame = requestAnimationFrame(animate);
    window.addEventListener("blur", pause);
    document.addEventListener("visibilitychange", pause);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("blur", pause);
      document.removeEventListener("visibilitychange", pause);
    };
  }, [engineControlled]);

  const playing = view.phase === "playing";
  const finished = view.phase === "finished";
  const buttonLabel = playing ? "Pause game" : view.phase === "paused" ? "Resume game" : finished ? "Play again" : "Start game";
  const status = playing ? "In play" : view.phase === "paused" ? "Paused" : finished ? "Match complete" : "Ready to play";

  const modelLabel = engineControlled ? "NO MODEL / Game engine" : MODELS.find((model) => model.id === modelId)?.label ?? "Model disabled";
  const engineTarget = engineControlled ? getEngineTarget(view) : null;
  const decision = engineControlled ? engineTarget === null ? null : { targetY: engineTarget, at: view.elapsed } : modelDecision;
  const difficultyLabel = DIFFICULTIES.find(({ ballSpeed }) => ballSpeed === view.ballSpeed)?.label;
  const targetMotion = !decision || Math.abs(decision.targetY - view.paddles.right) < 0.01 ? "At target" :
    decision.targetY < view.paddles.right ? "Moving up" : "Moving down";

  return (
    <main className="game-shell">
      <section className="arena" aria-label="Pong game">
        <div className="scoreboard">
          <div className="player"><span>You</span><small>LEFT PADDLE</small></div>
          <div className="scores" aria-label={`You ${view.score.left}, opponent ${view.score.right}`}>
            <span>{String(view.score.left).padStart(2, "0")}</span><span className="score-divider">:</span><span>{String(view.score.right).padStart(2, "0")}</span>
          </div>
          <div className="player player-model"><span>{modelLabel}</span><small>{difficultyLabel} · First to {COURT.winningScore}</small></div>
          {playing && <button className="pause-button" onClick={togglePlay}>Pause / Menu</button>}
        </div>

        <div className="court-wrap">
          <svg
            ref={court}
            className="court"
            viewBox={`0 0 ${COURT.width} ${COURT.height}`}
            tabIndex={0}
            role="application"
            aria-label="Pong court. Use W and S or the up and down arrows to move. Space starts or pauses. Escape pauses."
            onKeyDown={(event) => {
              const key = event.key.toLowerCase();
              if (["w", "s", "arrowup", "arrowdown", " ", "escape"].includes(key)) {
                event.preventDefault();
                if (key === " " || key === "escape") { if (!event.repeat && (key === " " || playing)) togglePlay(); }
                else { keys.current.add(key); }
              }
            }}
            onKeyUp={(event) => { keys.current.delete(event.key.toLowerCase()); }}
            onBlur={() => { keys.current.clear(); playerInput.current = 0; }}
          >
            <defs><pattern id="court-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" strokeWidth="0.5" /></pattern></defs>
            <rect width={COURT.width} height={COURT.height} fill="url(#court-grid)" className="court-grid" />
            <line x1="480" y1="0" x2="480" y2="540" className="center-line" />
            <circle cx="480" cy="270" r="66" className="center-circle" />
            {playing && decision && <g className="target-marker" aria-hidden="true">
              <rect x={COURT.width - COURT.paddleInset - COURT.paddleWidth - 6} y={decision.targetY - COURT.paddleHeight / 2} width={COURT.paddleWidth + 12} height={COURT.paddleHeight} rx="3" />
              <line x1={COURT.width - 110} x2={COURT.width - COURT.paddleInset - 22} y1={decision.targetY} y2={decision.targetY} />
            </g>}
            <rect x={COURT.paddleInset} y={view.paddles.left - COURT.paddleHeight / 2} width={COURT.paddleWidth} height={COURT.paddleHeight} rx="3" className="human-paddle" />
            <rect x={COURT.width - COURT.paddleInset - COURT.paddleWidth} y={view.paddles.right - COURT.paddleHeight / 2} width={COURT.paddleWidth} height={COURT.paddleHeight} rx="3" className="model-paddle" />
            <circle cx={view.ball.x} cy={view.ball.y} r={COURT.ballRadius} className="ball" />
            <text x="68" y="514" className="court-label">HUMAN</text><text x="892" y="514" textAnchor="end" className="court-label">{engineControlled ? "ENGINE" : "MODEL"}</text>
          </svg>

          {!playing && <div className="court-overlay">
            <section className="game-menu" aria-labelledby="menu-title">
              <h1 id="menu-title">{finished ? (view.score.left > view.score.right ? "You win" : "Opponent wins") : status}</h1>
              <div className="model-settings">
                <label htmlFor="opponent-model">Opponent</label>
                <select id="opponent-model" value={modelId} onChange={(event) => {
                  stopModel();
                  setModelError(null);
                  setModelNotice(null);
                  resetRetryBudget(event.target.value);
                  setModelId(event.target.value);
                }}>
                  <option value="">Disabled (stationary paddle)</option>
                  <option value="no-model">NO MODEL (game engine)</option>
                  {MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
                </select>
                <label htmlFor="difficulty">Difficulty</label>
                <select id="difficulty" value={view.ballSpeed} onChange={(event) => {
                  stopModel();
                  setModelNotice(null);
                  game.current = setBallSpeed(game.current, Number(event.target.value));
                  setView(game.current);
                }}>
                  {DIFFICULTIES.map((difficulty) => <option key={difficulty.id} value={difficulty.ballSpeed}>{difficulty.label}</option>)}
                </select>
                <p className="decision-rate">
                  {engineControlled ? "Engine control · No API requests" : modelId ? `Up to ${1000 / MODEL_DECISION_INTERVAL_MS} decisions/sec · ${MODEL_DECISION_INTERVAL_MS} ms interval` : "Model decisions disabled"}
                  {engineControlled ? <span>Uses the predicted intercept each physics step; returns to center when the ball moves away.</span> : modelId && <span>While playing, in either ball direction; backoff may reduce the rate.</span>}
                </p>
              </div>
              <p className="controls"><kbd>↑</kbd> <kbd>↓</kbd> or <kbd>W</kbd> <kbd>S</kbd> move · <kbd>space</kbd> / <kbd>esc</kbd> pause</p>
              {modelError && <p className="menu-error" role="alert">{modelError}</p>}
              <div className="menu-actions">
                <button className="primary-button" autoFocus onClick={() => { togglePlay(); court.current?.focus(); }}>{buttonLabel}</button>
                <button onClick={reset}>Reset match</button>
              </div>
            </section>
          </div>}
        </div>

        <section className="decision-panel" aria-label={engineControlled ? "Live engine target" : "Live model decision"}>
          <div className="decision-heading"><span className={`status-dot ${playing && modelId ? "live" : ""}`} />{engineControlled ? "Engine target" : "Model decision"} <span>{engineControlled ? "Every physics step" : modelId ? `${MODEL_DECISION_INTERVAL_MS} ms interval` : "Disabled"}</span></div>
          <div className="decision-values">
            {responseMs !== null && <span>Response {responseMs} ms</span>}
            <strong>{decision && playing ? `Target Y ${decision.targetY.toFixed(2)}` : !modelId ? "Stationary paddle" : playing ? view.serveIn > 0 ? "Serving" : "Awaiting decision" : "Inactive"}</strong>
            {decision && playing && <><span>Paddle Y {view.paddles.right.toFixed(2)}</span><span>{targetMotion}</span>{!engineControlled && <span>Selected at {decision.at.toFixed(1)} s</span>}</>}
          </div>
          <p role="status">{modelError ?? modelNotice ?? (decision && playing ? "Dashed marker shows the selected destination." : playing && modelId ? "Waiting for an accepted model target." : status)}</p>
        </section>
      </section>
    </main>
  );
}
