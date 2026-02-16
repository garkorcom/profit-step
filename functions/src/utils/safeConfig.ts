/**
 * @fileoverview Safe wrapper for functions.config()
 *
 * In Cloud Functions v2, functions.config() throws an error.
 * This wrapper catches the error and returns an empty object,
 * allowing v1 functions to still use config while v2 functions
 * rely on process.env / secrets.
 */

import * as functions from "firebase-functions";

let _cachedConfig: Record<string, any> | null = null;

/**
 * Safe replacement for functions.config().
 * Returns the config object in v1 or an empty object in v2.
 */
export function safeConfig(): Record<string, any> {
    if (_cachedConfig !== null) return _cachedConfig;
    try {
        _cachedConfig = functions.config();
    } catch {
        _cachedConfig = {};
    }
    return _cachedConfig;
}
