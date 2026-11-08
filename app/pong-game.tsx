"use client";

import { useEffect, useRef, useState } from "react";
import { DIFFICULTIES, COURT, createGame, setBallSpeed, stepGame } from "@/lib/game";
import { MODELS, MODEL_DECISION_INTERVAL_MS, getModelObservation } from "@/lib/model-controller";
import { createRemoteController } from "@/lib/request-model-action";
import { runModelController, type ModelRetryState } from "@/lib/run-model-controller";

const STEP = 1 / 120;
const PLAYER_RAMP_SECONDS = 0.06;

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
  const [modelError, setModelError] = useState<string | null>(null);
  const [modelNotice, setModelNotice] = useState<string | null>(null);

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
    if (view.phase !== "playing" || !modelId) return;

    const retry = modelRetries.current[modelId] ??= { failures: 0, startedAt: null, nextRequestAt: 0 };
    const stop = runModelController({
      controller: createRemoteController(modelId),
      observe: () => getModelObservation(game.current),
      onTarget: (targetY) => { modelTargetY.current = targetY; },
      onStatus: setModelNotice,
      retry,
      onError: (message) => {
        setModelError(message);
        game.current = { ...game.current, phase: "paused" };
        setView(game.current);
      },
    });
    modelSession.current = stop;
    return stop;
  }, [modelId, view.phase, view.score.left, view.score.right, view.ballSpeed]);

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
          right: game.current.serveIn === 0 ? modelTargetY.current : null,
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
  }, []);

  const playing = view.phase === "playing";
  const finished = view.phase === "finished";
  const buttonLabel = playing ? "Pause game" : view.phase === "paused" ? "Resume game" : finished ? "Play again" : "Start game";
  const status = playing ? "In play" : view.phase === "paused" ? "Paused" : finished ? "Match complete" : "Ready to play";

  return (
    <main className="game-shell">
      <header className="masthead">
        <h1 className="wordmark" aria-label="Pong AI"><span className="brand-icon" aria-hidden="true">Ⅱ</span> pong<span className="wordmark-ai">/ai</span></h1>
        <span className="build-label"><span className="status-dot" /> TECHNICAL DEMO <span className="version">v0.1</span></span>
      </header>

      <div className="model-settings">
        <label htmlFor="opponent-model">Opponent</label>
        <select id="opponent-model" value={modelId} onChange={(event) => {
          stopModel();
          setModelError(null);
          setModelNotice(null);
          resetRetryBudget(event.target.value);
          setModelId(event.target.value);
          court.current?.focus();
        }}>
          <option value="">Disabled (stationary paddle)</option>
          {MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
        </select>
        <label htmlFor="difficulty">Difficulty</label>
        <select id="difficulty" value={view.ballSpeed} onChange={(event) => {
          stopModel();
          setModelNotice(null);
          game.current = setBallSpeed(game.current, Number(event.target.value));
          setView(game.current);
          court.current?.focus();
        }}>
          {DIFFICULTIES.map((difficulty) => <option key={difficulty.id} value={difficulty.ballSpeed}>{difficulty.label}</option>)}
        </select>
        <p className="decision-rate">
          {modelId ? `Up to ${1000 / MODEL_DECISION_INTERVAL_MS} decisions/sec · ${MODEL_DECISION_INTERVAL_MS} ms interval` : "Model decisions disabled"}
          {modelId && <span>While playing, in either ball direction; backoff may reduce the rate.</span>}
        </p>
      </div>

      <section className="arena" aria-label="Pong game">
        <div className="scoreboard">
          <div className="player player-human"><span className="player-symbol">↗</span><div><h2>You</h2><span>HUMAN · LEFT PADDLE</span></div></div>
          <div className="scores" aria-label={`You ${view.score.left}, opponent ${view.score.right}`}><span>{String(view.score.left).padStart(2, "0")}</span><span className="score-divider">:</span><span>{String(view.score.right).padStart(2, "0")}</span></div>
          <div className="player player-model"><div><h2>Model <span className="offline-tag">{modelError ? "ERROR" : !modelId ? "OFFLINE" : playing ? "ACTIVE" : "IDLE"}</span></h2><span>AI · RIGHT PADDLE</span></div><span className="player-symbol">✳</span></div>
        </div>

        <div className="court-wrap">
          <svg
            ref={court}
            className="court"
            viewBox={`0 0 ${COURT.width} ${COURT.height}`}
            tabIndex={0}
            role="application"
            aria-label="Pong court. Use W and S or the up and down arrows to move. Space starts or pauses."
            onKeyDown={(event) => {
              const key = event.key.toLowerCase();
              if (["w", "s", "arrowup", "arrowdown", " "].includes(key)) {
                event.preventDefault();
                if (key === " ") { if (!event.repeat) togglePlay(); }
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
            <rect x={COURT.paddleInset} y={view.paddles.left - COURT.paddleHeight / 2} width={COURT.paddleWidth} height={COURT.paddleHeight} rx="3" className="human-paddle" />
            <rect x={COURT.width - COURT.paddleInset - COURT.paddleWidth} y={view.paddles.right - COURT.paddleHeight / 2} width={COURT.paddleWidth} height={COURT.paddleHeight} rx="3" className="model-paddle" />
            <circle cx={view.ball.x} cy={view.ball.y} r={COURT.ballRadius} className="ball" />
            <text x="68" y="514" className="court-label">HUMAN</text><text x="892" y="514" textAnchor="end" className="court-label">MODEL</text>
          </svg>

          {!playing && <div className="court-overlay">
            <h2>{finished ? (view.score.left > view.score.right ? "You win" : "Opponent wins") : status}</h2>
            <button className="primary-button" onClick={() => { togglePlay(); court.current?.focus(); }}><span aria-hidden="true">▶</span> {buttonLabel}</button>
            <span className="overlay-hint">or focus the court and press <kbd>space</kbd></span>
          </div>}
        </div>

        <div className="court-toolbar">
          <span className="match-status" role="status"><span className={`status-dot ${playing ? "live" : ""}`} />{status}</span>
          <span className="match-rule">FIRST TO {COURT.winningScore} <span> / </span> {String(Math.floor(view.elapsed / 60)).padStart(2, "0")}:{String(Math.floor(view.elapsed % 60)).padStart(2, "0")}</span>
          <div className="game-actions"><button onClick={() => { togglePlay(); court.current?.focus(); }}>{playing ? "Ⅱ Pause" : view.phase === "paused" ? "▶ Resume" : "▶ Play"}</button><button onClick={() => { reset(); court.current?.focus(); }} aria-label="Reset game">↺ <span>Reset</span></button></div>
        </div>
      </section>

      <section className="below-court" aria-label="Controls and opponent status">
        <div className="controls"><span className="section-label">CONTROLS</span><p><span><kbd>W</kbd><kbd>S</kbd> <span className="muted">or</span> <kbd>↑</kbd><kbd>↓</kbd></span><span>Move left paddle</span></p></div>
        <div className="model-note" role="status"><span className="note-icon" aria-hidden="true">✳</span><div><h3>{modelError ? "Model request failed" : modelNotice ? "Model status" : modelId ? "Model control enabled" : "Model control disabled"}</h3><p>{modelError ?? modelNotice ?? (modelId ? "Game state is sent only while playing." : "The right paddle is stationary.")}</p></div></div>
      </section>
    </main>
  );
}
