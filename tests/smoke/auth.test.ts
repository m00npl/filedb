import { describe, test, expect, beforeAll } from 'bun:test';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3003';

describe('Auth Smoke Tests', () => {
  const testEmail = `test-${Date.now()}@smoke.test`;
  const testPassword = 'TestPassword123!';
  let authToken: string;

  test('should register a new user', async () => {
    const response = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });

    expect(response.status).toBe(201);

    const data = await response.json();
    expect(data.accessToken).toBeDefined();
    expect(data.user).toBeDefined();
    expect(data.user.email).toBe(testEmail);

    authToken = data.accessToken;
  });

  test('should login with correct credentials', async () => {
    const response = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.accessToken).toBeDefined();
    expect(data.user).toBeDefined();
    expect(data.user.email).toBe(testEmail);
  });

  test('should reject invalid email format', async () => {
    const response = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'invalid-email',
        password: 'TestPassword123!',
      }),
    });

    expect(response.status).toBe(401);

    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  test('should reject short password', async () => {
    const response = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'short',
      }),
    });

    expect(response.status).toBe(401);

    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  test('should verify token works', async () => {
    // Get quota endpoint requires auth
    const response = await fetch(`${BASE_URL}/quota`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.used_bytes).toBeDefined();
    expect(data.max_bytes).toBeDefined();
  });
});
