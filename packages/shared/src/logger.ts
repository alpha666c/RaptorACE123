import pino, { type Logger } from 'pino';

let rootLogger: Logger | null = null;

export function getLogger(component?: string): Logger {
  if (!rootLogger) {
    rootLogger = pino({
      level: process.env['AGENT_LOG_LEVEL'] ?? 'info',
      base: null,
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }
  return component ? rootLogger.child({ component }) : rootLogger;
}

export type { Logger };
