import "server-only";

import { isRecord } from "../validation";
import { retryAfterMs } from "./retry-after";

export interface ProviderDiagnostics {
  requestBytes?: number;
  providerMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

// Only these upstream headers are safe to expose to the client.
export function getErrorDiagnostics(response: Response) {
  const headers = Object.fromEntries([...response.headers].filter(
    ([name]) => name === "retry-after" || name === "x-request-id" || name.startsWith("x-ratelimit-"),
  ));
  return {
    headers,
    requestId: headers["x-request-id"],
    retryAfterMs: retryAfterMs(headers["retry-after"] ?? null),
  };
}

// Each route invocation owns its diagnostics; observations and credentials are never logged.
export async function requestDecision(
  url: string,
  apiKey: string,
  body: object,
  signal: AbortSignal,
  diagnostics: ProviderDiagnostics,
) {
  const payload = JSON.stringify(body);
  diagnostics.requestBytes = Buffer.byteLength(payload);
  const started = performance.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      cache: "no-store",
      signal,
      body: payload,
    });
    // Leave error bodies for provider-specific error handling.
    const result: unknown = response.ok ? await response.json() : null;
    if (isRecord(result) && isRecord(result.usage)) {
      const usage = result.usage;
      if (typeof usage.input_tokens === "number") diagnostics.inputTokens = usage.input_tokens;
      if (typeof usage.output_tokens === "number") diagnostics.outputTokens = usage.output_tokens;
    }
    return { response, result };
  } finally {
    diagnostics.providerMs = Math.round(performance.now() - started);
  }
}
