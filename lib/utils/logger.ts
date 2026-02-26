import pino from 'pino';

// Create a structured logger with JSON output
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:dd-mm-yyyy HH:MM:ss',
      ignore: 'pid,hostname',
    }
  }
});

/**
 * Log an event with structured data
 * @param event - Event name/type
 * @param data - Additional data to log
 * @param level - Log level (default: info)
 */
export function logEvent(
  event: string, 
  data: Record<string, any>, 
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' = 'info'
): void {
  logger[level]({
    event,
    timestamp: new Date().toISOString(),
    ...data
  });
}

export default logger;