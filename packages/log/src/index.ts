import { pino } from "pino";

export type Logger = ReturnType<typeof pino>;

/** One pino logger per process. Every line carries `name`, so `npm run logs` can tell the containers apart. */
export function log(name: string): Logger {
  return pino({ name, level: process.env.LOG_LEVEL ?? "info" });
}
