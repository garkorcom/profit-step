/**
 * Eventually-consistent assertion helper.
 *
 * Many tasktotime integration assertions are eventually-consistent against
 * the emulator (Pub/Sub debounce is 5 s, BigQuery audit fall-through goes
 * through `systemErrors` with a Firestore round-trip, etc.). `waitFor`
 * polls a predicate at a small interval until either:
 *   - the predicate returns truthy (success → the value is returned), or
 *   - the wall-clock timeout elapses (failure → the helper throws with the
 *     last observed error or value).
 *
 * Default timeout 10 s leaves slack on top of Pub/Sub's 5 s debounce. Tests
 * that need a longer window pass an explicit `timeoutMs`. The timeout is
 * not a fixed sleep — fast paths return as soon as the predicate is true.
 */

export interface WaitForOptions {
  /** Total wall-clock budget. Defaults to 10 000 ms. */
  timeoutMs?: number;
  /** Poll interval. Defaults to 200 ms. */
  intervalMs?: number;
  /** Optional human-readable label included in the timeout error. */
  label?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_INTERVAL_MS = 200;

/**
 * Poll `predicate` until it returns a truthy value (or async-resolves to
 * one). Returns whatever the predicate produced on success.
 *
 * The predicate may either return a value or throw — both are treated as
 * "not yet". The most recent error (or `false`/`null`/`undefined`) is
 * recorded and surfaced if the poller times out.
 */
export async function waitFor<T>(
  predicate: () => T | Promise<T>,
  options: WaitForOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const label = options.label ?? 'waitFor';
  const deadline = Date.now() + timeoutMs;

  let lastError: unknown = undefined;
  let lastValue: unknown = undefined;

  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value as T;
      lastValue = value;
    } catch (err) {
      lastError = err;
    }
    await delay(intervalMs);
  }

  const reason =
    lastError !== undefined
      ? `last error: ${formatError(lastError)}`
      : `last value: ${JSON.stringify(lastValue)}`;
  throw new Error(`[${label}] timed out after ${timeoutMs} ms — ${reason}`);
}

/**
 * Same as `waitFor` but returns `null` on timeout instead of throwing.
 * Useful when "did NOT happen" is part of the contract under test.
 */
export async function waitForOrNull<T>(
  predicate: () => T | Promise<T>,
  options: WaitForOptions = {},
): Promise<T | null> {
  try {
    return await waitFor(predicate, options);
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
