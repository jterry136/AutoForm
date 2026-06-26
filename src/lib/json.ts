/**
 * JSON-safe value types. Used at server-function boundaries so jsonb columns
 * (typed `Record<string, unknown>` in Drizzle) serialize cleanly — TanStack Start
 * rejects `unknown` in server-fn return types as "may not be serializable".
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }
