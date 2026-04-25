const RETRYABLE_PATTERNS = [
  "429",
  "503",
  "too many requests",
  "service unavailable",
  "timeout",
  "blockhash not found",
  "transaction simulation failed",
  "econnreset",
  "econnrefused",
  "fetch failed",
];

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return RETRYABLE_PATTERNS.some((p) => msg.includes(p));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;

  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === maxAttempts - 1) throw err;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastErr;
}
