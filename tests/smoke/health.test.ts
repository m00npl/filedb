import { describe, test, expect } from 'bun:test';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3003';

describe('Health Check Smoke Tests', () => {
  test('should return healthy status', async () => {
    const response = await fetch(`${BASE_URL}/health`);

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.status).toBe('healthy');
    expect(data.services).toBeDefined();
    expect(data.timestamp).toBeDefined();
  });

  test('should have Redis connection', async () => {
    const response = await fetch(`${BASE_URL}/health`);
    const data = await response.json();

    expect(data.services.redis).toMatch(/connected|unknown/);
  });

  test('should have database connection', async () => {
    const response = await fetch(`${BASE_URL}/health`);
    const data = await response.json();

    expect(data.services.database).toBe('connected');
  });
});
