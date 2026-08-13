export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const levels: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

let currentLevel: LogLevel = "INFO";

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return levels[level] >= levels[currentLevel];
}

export function debug(message: string): void {
  if (shouldLog("DEBUG")) console.error(`[debug] ${message}`);
}

export function info(message: string): void {
  if (shouldLog("INFO")) console.log(message);
}

export function warn(message: string): void {
  if (shouldLog("WARN")) console.error(`[warn] ${message}`);
}

export function error(message: string): void {
  if (shouldLog("ERROR")) console.error(`[error] ${message}`);
}

export function success(message: string): void {
  if (shouldLog("INFO")) console.log(`✓ ${message}`);
}
