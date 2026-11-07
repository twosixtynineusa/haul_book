import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { APP_VERSION } from '@haulbook/shared';
import { configureApp } from '../src/app.setup';
import { HealthModule } from '../src/health/health.module';

/**
 * Boots a NestJS app with ONLY HealthModule and applies the real `configureApp`,
 * so this verifies the production route layout: the global `/api` prefix + the
 * version-neutral health endpoint.
 */
describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [HealthModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health returns ok + the app version', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', version: APP_VERSION });
  });

  it('unknown routes under /api 404', async () => {
    await request(app.getHttpServer()).get('/api/nope').expect(404);
  });
});
