import { redactSecrets } from './redaction.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogSink = (line: string) => void;

export interface StructuredLogger {
  log(level: LogLevel, event: string, data?: unknown): void;
  debug(event: string, data?: unknown): void;
  info(event: string, data?: unknown): void;
  warn(event: string, data?: unknown): void;
  error(event: string, data?: unknown): void;
}

export function createLogger(sink: LogSink = console.log): StructuredLogger {
  const log = (level: LogLevel, event: string, data?: unknown): void => {
    sink(JSON.stringify({ timestamp: new Date().toISOString(), level, event, data: redactSecrets(data) }));
  };
  return {
    log,
    debug: (event, data) => log('debug', event, data),
    info: (event, data) => log('info', event, data),
    warn: (event, data) => log('warn', event, data),
    error: (event, data) => log('error', event, data),
  };
}
