export interface ModelErrorDetails {
  code?: string;
  type?: string;
  requestId?: string;
  retryable?: boolean;
  retryAfterMs?: number;
  headers?: Record<string, string>;
}

// Only safe diagnostic fields cross the server/client boundary.
export class ModelError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details: ModelErrorDetails = {},
  ) {
    super(message);
  }
}
