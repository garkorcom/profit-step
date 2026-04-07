/**
 * Extract a human-readable message from an unknown thrown value.
 *
 * Use this in catch blocks that were previously typed as `any` to
 * satisfy strict mode / the no-explicit-any lint rule:
 *
 *   try {
 *     await risky();
 *   } catch (e: unknown) {
 *     setError(errorMessage(e));
 *     console.error(errorMessage(e), e);
 *   }
 *
 * This is the canonical narrowing used across the project.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/**
 * Extract a Firebase / HTTP error code if present, else null.
 * Handles common shapes: { code: 'auth/user-not-found' }, Error with .code.
 */
export function errorCode(e: unknown): string | null {
  if (e && typeof e === 'object' && 'code' in e) {
    const code = (e as { code: unknown }).code;
    if (typeof code === 'string') return code;
    if (typeof code === 'number') return String(code);
  }
  return null;
}
