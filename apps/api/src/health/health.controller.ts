import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { APP_VERSION, type HealthResponse } from '@haulbook/shared';

/**
 * `GET /api/health` — public liveness endpoint, also used by the docker-compose
 * probes. Version-neutral: it lives under the global `/api` prefix but outside
 * the `/v1` URI-versioned surface.
 */
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  @Get()
  health(): HealthResponse {
    return { status: 'ok', version: APP_VERSION };
  }
}
