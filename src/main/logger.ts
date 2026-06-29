import { app } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Minimal structured logger for the main process: mirrors to the console (handy
 * in dev) and appends timestamped lines to `userData/logs/relay.log` so issues
 * in a packaged build can be diagnosed after the fact. Writing never throws —
 * logging must not be able to crash the app.
 */

type Level = "info" | "warn" | "error";

const logDir = (): string => join(app.getPath("userData"), "logs");

const fmt = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const write = (level: Level, args: unknown[]): void => {
  try {
    const line = `${new Date().toISOString()} [${level}] ${args.map(fmt).join(" ")}\n`;
    mkdirSync(logDir(), { recursive: true });
    appendFileSync(join(logDir(), "relay.log"), line);
  } catch {
    /* never let logging crash the app */
  }
};

export const logger = {
  info: (...args: unknown[]): void => {
    console.log(...args);
    write("info", args);
  },
  warn: (...args: unknown[]): void => {
    console.warn(...args);
    write("warn", args);
  },
  error: (...args: unknown[]): void => {
    console.error(...args);
    write("error", args);
  }
};

/**
 * Route otherwise-fatal main-process errors to the log instead of letting them
 * crash silently, so a packaged build leaves a breadcrumb. Install once at boot.
 */
export const installCrashHandlers = (): void => {
  process.on("uncaughtException", (error) => {
    logger.error("[uncaughtException]", error);
  });
  process.on("unhandledRejection", (reason) => {
    logger.error("[unhandledRejection]", reason);
  });
};
