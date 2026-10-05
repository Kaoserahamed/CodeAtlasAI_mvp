/**
 * Client-side structured logging.
 *
 * The backend logs structured JSON through pino; this gives the browser the
 * same discipline so a deployed demo's console output can be read the same way
 * a server log can. Every entry carries a timestamp, a level and a component,
 * plus whatever context the caller attaches.
 *
 * Kept in one place so no call site reaches for console.error directly. A bare
 * console.error loses the timestamp and the component, which is exactly the
 * information needed to work out which of several failures produced it.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  context?: Record<string, unknown>;
}

/** Values safe to put in a log line. Errors are unwrapped rather than dropped. */
function normalize(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

/**
 * Build one log entry.
 *
 * Exported so tests can assert the shape without capturing console output, and
 * so anything else collecting telemetry can reuse the format.
 */
export function buildEntry(
  level: LogLevel,
  component: string,
  message: string,
  context?: Record<string, unknown>
): LogEntry {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    component,
    message,
  };

  if (context && Object.keys(context).length > 0) {
    entry.context = Object.fromEntries(
      Object.entries(context).map(([key, value]) => [key, normalize(value)])
    );
  }

  return entry;
}

/** Console methods are prefixed so entries are recognisable in a busy log. */
const PREFIX: Record<LogLevel, string> = {
  debug: '[debug]',
  info: '[info]',
  warn: '[warn]',
  error: '[error]',
};

function emit(level: LogLevel, component: string, message: string, context?: Record<string, unknown>) {
  const entry = buildEntry(level, component, message, context);
  const line = `${PREFIX[level]} ${component}: ${entry.message}`;
  // debug maps to console.log; the rest map to the matching console method.
  const method = level === 'debug' ? 'log' : level;

  // The browser console is the sink for a client logger, which is the whole
  // point of shaping what reaches it.
  console[method](line, entry.context ?? {});
}

export const logger = {
  debug: (component: string, message: string, context?: Record<string, unknown>) =>
    emit('debug', component, message, context),
  info: (component: string, message: string, context?: Record<string, unknown>) =>
    emit('info', component, message, context),
  warn: (component: string, message: string, context?: Record<string, unknown>) =>
    emit('warn', component, message, context),
  /**
   * Report a failure.
   *
   * Accepts an Error directly and unwraps it into name, message and stack, so
   * the caller cannot accidentally log `[object Object]`.
   */
  error: (
    component: string,
    message: string,
    context?: Record<string, unknown>
  ) => emit('error', component, message, context),
};