import { describe, test, expect, beforeAll } from 'bun:test';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3003';

describe('Query Endpoints Smoke Tests', () => {
  let authToken: string;
  let fileId: string;
  const testOwner = `smoke-owner-${Date.now()}`;

  beforeAll(async () => {
    // Register and get token
    const email = `query-${Date.now()}@test.local`;
    const response = await fetch(`${BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'TestPass123!',
      }),
    });

    const data = await response.json();
    authToken = data.accessToken;

    // Upload a test file with owner annotation
    const formData = new FormData();
    const blob = new Blob(['Query test content'], { type: 'text/plain' });
    formData.append('file', blob, 'query-test.txt');
    formData.append('owner', testOwner);

    const uploadResponse = await fetch(`${BASE_URL}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
      body: formData,
    });

    const uploadData = await uploadResponse.json();
    fileId = uploadData.file_id;
  });

  test('should query files by extension', async () => {
    const response = await fetch(`${BASE_URL}/files/by-extension/txt`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.extension).toBe('txt');
    expect(data.count).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(data.files)).toBe(true);

    // Should include our uploaded file
    const hasOurFile = data.files.some((f: any) => f.file_id === fileId);
    expect(hasOurFile).toBe(true);
  });

  test('should query files by content type', async () => {
    const response = await fetch(
      `${BASE_URL}/files/by-type/${encodeURIComponent('text/plain')}`,
      {
        headers: { Authorization: `Bearer ${authToken}` },
      }
    );

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.content_type).toBe('text/plain');
    expect(data.count).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(data.files)).toBe(true);

    // Should include our uploaded file
    const hasOurFile = data.files.some((f: any) => f.file_id === fileId);
    expect(hasOurFile).toBe(true);
  });

  test('should query files by owner', async () => {
    const response = await fetch(`${BASE_URL}/files/by-owner/${testOwner}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.owner).toBe(testOwner);
    expect(data.count).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(data.files)).toBe(true);

    // Should include our uploaded file
    const hasOurFile = data.files.some((f: any) => f.file_id === fileId);
    expect(hasOurFile).toBe(true);
  });

  test('should return empty results for non-existent owner', async () => {
    const response = await fetch(
      `${BASE_URL}/files/by-owner/non-existent-owner-${Date.now()}`,
      {
        headers: { Authorization: `Bearer ${authToken}` },
      }
    );

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.count).toBe(0);
    expect(data.files).toEqual([]);
  });
});
