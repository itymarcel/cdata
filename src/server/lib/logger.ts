type Level = "debug" | "info" | "warn" | "error";

function log(level: Level, message: string): void {
  if (process.env.NODE_ENV === "test" && level !== "error") return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}`;
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const logger = {
  debug: (m: string) => log("debug", m),
  info: (m: string) => log("info", m),
  warn: (m: string) => log("warn", m),
  error: (m: string) => log("error", m),
};
