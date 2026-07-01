import { afterAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../src/server.js';

describe('HTTP API', () => {
  const app = createApp();

  afterAll(() => {
    app.removeAllListeners();
  });

  it('GET /health returns 200', async () => {
    const res = await request(app).get('/health').expect(200);
    const body = res.body as { status: unknown; timestamp: unknown };
    expect(body).toMatchObject({ status: 'ok' });
    expect(typeof body.timestamp).toBe('string');
  });

  it('unknown route returns 404', async () => {
    const res = await request(app).get('/nope').expect(404);
    const body = res.body as { message: unknown };
    expect(body).toMatchObject({ message: 'Not Found' });
  });
});
