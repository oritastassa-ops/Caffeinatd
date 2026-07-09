/** Mirrors the existing ProviderError pattern (src/lib/ai/types.ts) for consistency. */
export class HevyApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "HevyApiError";
  }
}

/** Never surface the provider's raw error body to the user — map to a safe, actionable message. */
export function toSafeMessage(err: unknown): string {
  if (err instanceof HevyApiError) {
    if (err.status === 401 || err.status === 403) return "That Hevy API key isn't valid.";
    if (err.status === 429) return "Hevy is rate-limiting requests right now — try again shortly.";
    if (err.status && err.status >= 500) return "Hevy's API is temporarily unavailable.";
    return "Couldn't connect to Hevy.";
  }
  return "Couldn't connect to Hevy — check your connection and try again.";
}
