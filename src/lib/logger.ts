/**
 * Structured JSON logger. Keeps logs grep-able per-account and machine-parsable
 * by whatever log aggregator we wire up later (Axiom / Datadog / Vercel's own).
 *
 * Usage:
 *   log.info("sync.started", { accountId, lookbackMonths: 24 });
 *   log.error("klaviyo.fetch_failed", { accountId, status: 429 }, err);
 *
 * In dev (LOG_PRETTY=1) output is a single colorized line for readability.
 * In prod the default is one JSON object per line (Vercel log drain friendly).
 */

type Level = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown>;

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[(process.env.LOG_LEVEL as Level) || "info"] ?? 20;
const PRETTY = process.env.LOG_PRETTY === "1";

function write(level: Level, event: string, context?: LogContext, err?: unknown): void {
  if (LEVELS[level] < MIN_LEVEL) return;

  const entry: Record<string, unknown> = {
    t: new Date().toISOString(),
    level,
    event,
    ...context,
  };

  if (err instanceof Error) {
    entry.error = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  } else if (err !== undefined) {
    entry.error = err;
  }

  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;

  if (PRETTY) {
    const ctx = { ...entry };
    delete ctx.t;
    delete ctx.level;
    delete ctx.event;
    fn(`[${level.toUpperCase()}] ${event}`, Object.keys(ctx).length ? ctx : "");
    return;
  }

  fn(JSON.stringify(entry));
}

export const log = {
  debug: (event: string, context?: LogContext) => write("debug", event, context),
  info: (event: string, context?: LogContext) => write("info", event, context),
  warn: (event: string, context?: LogContext, err?: unknown) =>
    write("warn", event, context, err),
  error: (event: string, context?: LogContext, err?: unknown) =>
    write("error", event, context, err),
};
