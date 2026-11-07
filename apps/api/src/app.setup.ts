import { VersioningType, type INestApplication } from '@nestjs/common';
import { env } from './config/env';

/**
 * Shared HTTP app configuration — used by both main.ts and the e2e test app
 * factory so tests exercise exactly the production route layout:
 * global prefix `/api` + URI versioning → `/api/v1/...` (plus `/api/health`).
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  if (env.corsOrigins.length > 0) {
    // Browser traffic is proxied through Next.js rewrites (same-origin, no CORS).
    app.enableCors({ origin: env.corsOrigins });
  }
}
