import { describe, test, expect, beforeAll } from 'bun:test';

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3003';

describe('Upload/Download Smoke Tests', () => {
  let authToken: string;
  let fileId: string;
  const testContent = 'Smoke test content - ' + Date.now();

  beforeAll(async () => {
    // Register and get token
    const email = `smoke-${Date.now()}@test.local`;
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
  });

  test('should upload a file successfully', async () => {
    const formData = new FormData();
    const blob = new Blob([testContent], { type: 'text/plain' });
    formData.append('file', blob, 'smoke-test.txt');
    formData.append('ttl_days', '7');

    const response = await fetch(`${BASE_URL}/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      body: formData,
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.file_id).toBeDefined();
    expect(data.message).toBe('Upload successful');

    fileId = data.file_id;
  }, { timeout: 10000 });

  test('should get file info', async () => {
    expect(fileId).toBeDefined();

    const response = await fetch(`${BASE_URL}/files/${fileId}/info`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.file_id).toBe(fileId);
    expect(data.original_filename).toBe('smoke-test.txt');
    expect(data.content_type).toBe('text/plain');
    expect(data.total_size).toBe(testContent.length);
  });

  test('should download file with correct content', async () => {
    expect(fileId).toBeDefined();

    const response = await fetch(`${BASE_URL}/files/${fileId}`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/plain');

    const downloadedContent = await response.text();
    expect(downloadedContent).toBe(testContent);
  });

  test('should have entity keys after blockchain upload', async () => {
    expect(fileId).toBeDefined();

    // Wait a bit for blockchain upload to complete
    await new Promise(resolve => setTimeout(resolve, 3000));

    const response = await fetch(`${BASE_URL}/files/${fileId}/entities`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.file_id).toBe(fileId);
    expect(data.total_entities).toBeGreaterThan(0);

    // Should have metadata key or chunk keys
    const hasKeys = !!data.metadata_entity_key || (data.chunk_entity_keys && data.chunk_entity_keys.length > 0);
    expect(hasKeys).toBe(true);
  }, { timeout: 10000 }); // Longer timeout for blockchain operations

  test('should get upload status', async () => {
    expect(fileId).toBeDefined();

    const response = await fetch(`${BASE_URL}/files/${fileId}/status`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.file_id).toBe(fileId);
    expect(data.status).toMatch(/uploading|completed/);
  });

  test('should update quota after upload', async () => {
    const response = await fetch(`${BASE_URL}/quota`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.used_bytes).toBeGreaterThanOrEqual(testContent.length);
    expect(data.uploads_today).toBeGreaterThanOrEqual(1);
  });
});
