import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { UploadService } from './services/upload';
import { QuotaService } from './services/quota';

const app = new Hono();
const uploadService = new UploadService();
const quotaService = new QuotaService();

// Serve static files (documentation site)
app.use('/*', serveStatic({ root: './public' }));

app.post('/files', async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File;
    const idempotencyKey = c.req.header('Idempotency-Key') || crypto.randomUUID();
    const btlDays = parseInt(c.req.header('BTL-Days') || '7');

    if (!file) {
      return c.json({ error: 'No file provided' }, 400);
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const userId = quotaService.getUserId(c.req);

    const result = await uploadService.initiateUpload(
      fileBuffer,
      file.name,
      file.type,
      idempotencyKey,
      userId,
      btlDays
    );

    if (!result.success) {
      return c.json({ error: result.error }, 400);
    }

    return c.json({
      file_id: result.file_id,
      message: 'Upload successful'
    });
  } catch (error) {
    console.error('Upload error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/files/:file_id', async (c) => {
  try {
    const file_id = c.req.param('file_id');

    const result = await uploadService.getFile(file_id);

    if (!result.success) {
      return c.json({ error: result.error }, result.error?.includes('not found') ? 404 : 500);
    }

    const { buffer, metadata } = result;

    return new Response(buffer, {
      headers: {
        'Content-Type': metadata!.content_type,
        'Content-Length': metadata!.total_size.toString(),
        'Content-Disposition': `inline; filename="${metadata!.original_filename}"`,
        'Cache-Control': 'public, max-age=86400',
        'X-File-Extension': metadata!.file_extension,
        'X-File-Size': metadata!.total_size.toString(),
        'X-Upload-Date': metadata!.created_at.toISOString()
      }
    });
  } catch (error) {
    console.error('Retrieval error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/files/:file_id/info', async (c) => {
  try {
    const file_id = c.req.param('file_id');
    const result = await uploadService.getFile(file_id);

    if (!result.success) {
      return c.json({ error: result.error }, result.error?.includes('not found') ? 404 : 500);
    }

    const { metadata } = result;

    return c.json({
      file_id: metadata!.file_id,
      original_filename: metadata!.original_filename,
      content_type: metadata!.content_type,
      file_extension: metadata!.file_extension,
      total_size: metadata!.total_size,
      chunk_count: metadata!.chunk_count,
      checksum: metadata!.checksum,
      created_at: metadata!.created_at,
      btl_days: metadata!.btl_days,
      expires_at: new Date(metadata!.created_at.getTime() + metadata!.btl_days * 24 * 60 * 60 * 1000)
    });
  } catch (error) {
    console.error('File info error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/files/by-extension/:extension', async (c) => {
  try {
    const extension = c.req.param('extension');
    const files = await uploadService.getFilesByExtension(extension);

    return c.json({
      extension,
      count: files.length,
      files: files.map(f => ({
        file_id: f.file_id,
        original_filename: f.original_filename,
        content_type: f.content_type,
        total_size: f.total_size,
        created_at: f.created_at
      }))
    });
  } catch (error) {
    console.error('Files by extension error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/files/by-type/:content_type', async (c) => {
  try {
    const contentType = decodeURIComponent(c.req.param('content_type'));
    const files = await uploadService.getFilesByContentType(contentType);

    return c.json({
      content_type: contentType,
      count: files.length,
      files: files.map(f => ({
        file_id: f.file_id,
        original_filename: f.original_filename,
        file_extension: f.file_extension,
        total_size: f.total_size,
        created_at: f.created_at
      }))
    });
  } catch (error) {
    console.error('Files by content type error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/quota', async (c) => {
  try {
    const userId = quotaService.getUserId(c.req);
    const quota = await quotaService.getQuotaInfo(userId);

    return c.json({
      used_bytes: quota.used_bytes,
      max_bytes: quota.max_bytes,
      uploads_today: quota.uploads_today,
      max_uploads_per_day: quota.max_uploads_per_day,
      usage_percentage: (quota.used_bytes / quota.max_bytes * 100).toFixed(2)
    });
  } catch (error) {
    console.error('Quota error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/status/:idempotency_key', async (c) => {
  try {
    const idempotencyKey = c.req.param('idempotency_key');
    const session = await uploadService.getUploadStatus(idempotencyKey);

    if (!session) {
      return c.json({ error: 'Upload session not found' }, 404);
    }

    return c.json({
      file_id: session.file_id,
      completed: session.completed,
      chunks_received: session.chunks_received.size,
      total_chunks: session.metadata.chunk_count
    });
  } catch (error) {
    console.error('Status error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/health', (c) => {
  return c.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

const port = parseInt(process.env.PORT || '3000');

console.log(`🚀 Files DB service starting on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};