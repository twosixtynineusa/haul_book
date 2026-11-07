function optionalInt(value: string | undefined): number | null {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Typed, centralized environment access. docker-compose.yml is the canonical
 * source of these values (it maps OUTPUT_DIR / INPUT_DIR from the root .env onto them).
 * Values are read once at first import; tests set process.env in jest
 * `setupFiles`, which run before any module loads.
 */
export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: optionalInt(process.env.PORT) ?? 3000,
  /** Postgres 18 — the saved company → unit list. In-container hostname `db`. */
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://haulbook:haulbook@db:5432/haulbook',
  /** Redis 7 for BullMQ (the input-folder scan job). In-container hostname `redis`. */
  redisUrl: process.env.REDIS_URL ?? 'redis://redis:6379',
  /** Watched input folder INSIDE the container (bind mount of INPUT_DIR). */
  inputPath: process.env.INPUT_PATH ?? '/data/input',
  /** The same folder as the user knows it on the host (INPUT_DIR in .env) — display only. */
  inputDirLabel: process.env.INPUT_DIR_LABEL || process.env.INPUT_PATH || '/data/input',
  /** Seconds between scans; a file must be unchanged across two scans to be picked up. */
  inputScanSeconds: Math.max(5, optionalInt(process.env.INPUT_SCAN_SECONDS) ?? 30),
  /** Folder INSIDE the container where converted files are written (bind mount target). */
  outputPath: process.env.OUTPUT_PATH ?? '/data/output',
  /** The same folder as the user knows it on the host (OUTPUT_DIR in .env) — display only. */
  outputDirLabel: process.env.OUTPUT_DIR_LABEL || process.env.OUTPUT_PATH || '/data/output',
  /**
   * Host uid/gid to hand converted files to. In dev the api runs as root, so
   * without this the files in OUTPUT_DIR would be root-owned on a docker-ce host.
   */
  outputUid: optionalInt(process.env.OUTPUT_UID),
  outputGid: optionalInt(process.env.OUTPUT_GID),
  // Extra CORS origins (comma-separated). Empty by default — Next.js proxies the API same-origin.
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
} as const;
