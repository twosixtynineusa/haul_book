import { execSync } from 'node:child_process';

/**
 * Jest globalSetup — provisions the isolated integration test database once,
 * before any suite runs.
 *
 * If DATABASE_URL_TEST is unset (a pure unit run) it does nothing, and the
 * DB-backed specs self-skip via `describe.skip`. Otherwise it applies the current
 * Prisma schema to the test DB with `prisma db push`, which also CREATES the
 * database if it doesn't exist yet.
 *
 * Docker-first: this runs inside the api container during `make test-api` /
 * `make ci`, and against the Postgres service in GitHub Actions.
 */
export default function globalSetup(): void {
  const testUrl = process.env.DATABASE_URL_TEST;
  if (!testUrl) {
    console.log('[global-setup] DATABASE_URL_TEST unset — skipping DB-backed test provisioning');
    return;
  }
  console.log('[global-setup] applying the Prisma schema to the test database…');
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: testUrl },
  });
}
