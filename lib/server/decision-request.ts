import "server-only";

export interface ProviderDiagnostics {
  requestBytes?: number;
  providerMs?: number;
  inputTokens?: number;
  outputTokens?: number;
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
    const usage = result && typeof result === "object" && "usage" in result ? result.usage : null;
    if (usage && typeof usage === "object") {
      if ("input_tokens" in usage && typeof usage.input_tokens === "number") diagnostics.inputTokens = usage.input_tokens;
      if ("output_tokens" in usage && typeof usage.output_tokens === "number") diagnostics.outputTokens = usage.output_tokens;
    }
    return { response, result };
  } finally {
    diagnostics.providerMs = Math.round(performance.now() - started);
  }
}
