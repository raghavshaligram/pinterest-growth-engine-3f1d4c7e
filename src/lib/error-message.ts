/**
 * Safely extracts a human-readable message from a caught value of unknown
 * shape.
 *
 * Bare `String(e)` on a non-Error, non-string value (e.g. a plain object)
 * produces the unreadable "[object Object]" — this is the classic cause of
 * mystery errors like "[object][object]" showing up in toasts. This also
 * matters for TanStack Start server functions specifically: thrown errors
 * cross a server->client serialization boundary (seroval's ShallowErrorPlugin)
 * that reconstructs a plain `Error` with only `.message` preserved — custom
 * subclasses (e.g. Supabase's PostgrestError) lose their prototype, and in
 * some edge cases the deserialized value can arrive as a plain
 * `{ message: string, ... }` object rather than a true `Error` instance.
 *
 * This helper handles both cases: real Error instances, and plain objects
 * carrying a `.message` string, before ever falling back to JSON.stringify
 * (still readable) and finally a generic fallback (never a bare object
 * coercion).
 */
export function getErrorMessage(e: unknown, fallback = "Something went wrong. Please try again."): string {
  if (e instanceof Error) return e.message || e.name || fallback;
  if (typeof e === "string") return e || fallback;
  if (e && typeof e === "object") {
    const withMessage = e as { message?: unknown };
    if (typeof withMessage.message === "string" && withMessage.message.trim()) {
      return withMessage.message;
    }
    try {
      const json = JSON.stringify(e);
      if (json && json !== "{}") return json;
    } catch {
      // not JSON-serializable — fall through to generic fallback
    }
  }
  return fallback;
}
