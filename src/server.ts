// Initialize Sentry first before any other imports
import { initSentry, captureException } from './sentry';
initSentry();

import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { UploadService } from './services/upload';
import { QuotaService } from './services/quota';
import { StorageFactory } from './storage/storage-factory';
import {
  errorHandlingMiddleware,
  notFoundHandler,
  timeoutMiddleware
} from './middleware/error-handling';
import {
  inputValidationMiddleware,
  fileUploadValidationMiddleware
} from './middleware/validation';
import {
  jwtAuthMiddleware,
  optionalJwtAuthMiddleware,
  apiKeyFallbackMiddleware,
  requirePermission,
  PERMISSIONS
} from './middleware/auth';
import authRoutes from './routes/auth';

const app = new Hono();

// Apply global middleware
app.use('*', timeoutMiddleware(300000)); // 5 minute timeout
app.use('*', inputValidationMiddleware);
app.use('*', fileUploadValidationMiddleware);
app.use('*', apiKeyFallbackMiddleware); // API key fallback for backward compatibility

// Initialize services
let uploadService: UploadService;
let quotaService: QuotaService;

async function initializeServices() {
  console.log('🔧 Initializing File DB services...');

  uploadService = new UploadService();
  await uploadService.initialize();

  const storage = await StorageFactory.createStorage();
  quotaService = new QuotaService(storage);

  console.log('✅ File DB services initialized');
}

// Initialize services on startup
await initializeServices();

// Mount authentication routes (public routes)
app.route('/auth', authRoutes);

// Serve static files (documentation site)
app.use('/*', serveStatic({ root: './public' }));

app.post('/files', optionalJwtAuthMiddleware, requirePermission(PERMISSIONS.UPLOAD_FILES), async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get('file') as File;
    const owner = formData.get('owner') as string; // Optional owner annotation
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
      btlDays,
      owner || undefined,
      c.req
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
    captureException(error, { context: 'file_upload' });
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/files/by-owner/:owner', optionalJwtAuthMiddleware, requirePermission(PERMISSIONS.LIST_FILES), async (c) => {
  try {
    const owner = c.req.param('owner');
    const files = await uploadService.getFilesByOwner(owner);

    return c.json({
      owner,
      count: files.length,
      files: files.map(f => ({
        file_id: f.file_id,
        original_filename: f.original_filename,
        content_type: f.content_type,
        file_extension: f.file_extension,
        total_size: f.total_size,
        created_at: f.created_at,
        owner: f.owner
      }))
    });
  } catch (error) {
    console.error('Files by owner error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

// Alternative endpoint to bypass CDN cache
app.get('/api/files/owner/:owner', optionalJwtAuthMiddleware, requirePermission(PERMISSIONS.LIST_FILES), async (c) => {
  try {
    const owner = c.req.param('owner');
    const files = await uploadService.getFilesByOwner(owner);

    return c.json({
      owner,
      count: files.length,
      files: files.map(f => ({
        file_id: f.file_id,
        original_filename: f.original_filename,
        content_type: f.content_type,
        file_extension: f.file_extension,
        total_size: f.total_size,
        created_at: f.created_at,
        owner: f.owner
      }))
    });
  } catch (error) {
    console.error('Files by owner error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/files/:file_id', optionalJwtAuthMiddleware, requirePermission(PERMISSIONS.DOWNLOAD_FILES), async (c) => {
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

app.get('/files/:file_id/info', optionalJwtAuthMiddleware, requirePermission(PERMISSIONS.LIST_FILES), async (c) => {
  try {
    const file_id = c.req.param('file_id');
    const result = await uploadService.getFile(file_id);

    if (!result.success) {
      return c.json({ error: result.error }, result.error?.includes('not found') ? 404 : 500);
    }

    const { metadata } = result;

    // Get entity keys if available
    const entityKeys = await uploadService.getFileEntityKeys(file_id);

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
      expires_at: new Date(metadata!.created_at.getTime() + metadata!.btl_days * 24 * 60 * 60 * 1000),
      owner: metadata!.owner,
      // Blockchain entity information
      metadata_entity_key: entityKeys.metadata_key,
      chunk_entity_keys: entityKeys.chunk_keys,
      total_blockchain_entities: (entityKeys.metadata_key ? 1 : 0) + entityKeys.chunk_keys.length
    });
  } catch (error) {
    console.error('File info error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/files/:file_id/entities', optionalJwtAuthMiddleware, requirePermission(PERMISSIONS.LIST_FILES), async (c) => {
  try {
    const file_id = c.req.param('file_id');
    const entityKeys = await uploadService.getFileEntityKeys(file_id);

    if (!entityKeys.metadata_key && entityKeys.chunk_keys.length === 0) {
      return c.json({ error: 'File not found or no blockchain entities available' }, 404);
    }

    return c.json({
      file_id,
      metadata_entity_key: entityKeys.metadata_key,
      chunk_entity_keys: entityKeys.chunk_keys,
      total_entities: (entityKeys.metadata_key ? 1 : 0) + entityKeys.chunk_keys.length
    });
  } catch (error) {
    console.error('File entities error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/files/by-extension/:extension', optionalJwtAuthMiddleware, requirePermission(PERMISSIONS.LIST_FILES), async (c) => {
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

app.get('/files/by-type/:content_type', optionalJwtAuthMiddleware, requirePermission(PERMISSIONS.LIST_FILES), async (c) => {
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

app.get('/quota', optionalJwtAuthMiddleware, requirePermission(PERMISSIONS.VIEW_QUOTA), async (c) => {
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

app.get('/status/:idempotency_key', optionalJwtAuthMiddleware, requirePermission(PERMISSIONS.LIST_FILES), async (c) => {
  try {
    const idempotencyKey = c.req.param('idempotency_key');
    const session = await uploadService.getUploadStatus(idempotencyKey);

    if (!session) {
      return c.json({ error: 'Upload session not found' }, 404);
    }

    // Calculate timing information
    const now = new Date();
    const elapsedMs = now.getTime() - session.started_at.getTime();
    const elapsedSeconds = Math.round(elapsedMs / 1000);

    let estimatedRemainingSeconds: number | null = null;
    if (session.chunks_uploaded_to_blockchain > 0) {
      const avgTimePerChunk = elapsedMs / session.chunks_uploaded_to_blockchain;
      const remainingChunks = session.total_chunks - session.chunks_uploaded_to_blockchain;
      estimatedRemainingSeconds = Math.round((avgTimePerChunk * remainingChunks) / 1000);
    }

    const progress = {
      chunks_uploaded: session.chunks_uploaded_to_blockchain,
      total_chunks: session.total_chunks,
      percentage: Math.round((session.chunks_uploaded_to_blockchain / session.total_chunks) * 100),
      remaining_chunks: session.total_chunks - session.chunks_uploaded_to_blockchain,
      elapsed_seconds: elapsedSeconds,
      estimated_remaining_seconds: estimatedRemainingSeconds,
      last_chunk_uploaded_at: session.last_chunk_uploaded_at?.toISOString()
    };

    return c.json({
      file_id: session.file_id,
      status: session.status,
      completed: session.completed,
      progress,
      // Legacy fields for backward compatibility
      chunks_received: session.chunks_received.size,
      total_chunks: session.total_chunks,
      chunks_uploaded_to_blockchain: session.chunks_uploaded_to_blockchain,
      progress_percentage: progress.percentage,
      error: session.error,
      // Additional metadata
      file_info: {
        original_filename: session.metadata.original_filename,
        file_size: session.metadata.total_size,
        content_type: session.metadata.content_type,
        owner: session.metadata.owner
      }
    });
  } catch (error) {
    console.error('Status error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/files/:file_id/status', optionalJwtAuthMiddleware, requirePermission(PERMISSIONS.LIST_FILES), async (c) => {
  try {
    const file_id = c.req.param('file_id');

    // Find session by file_id
    const session = await uploadService.getUploadStatusByFileId(file_id);

    if (!session) {
      return c.json({ error: 'Upload session not found' }, 404);
    }

    // Calculate timing information
    const now = new Date();
    const elapsedMs = now.getTime() - session.started_at.getTime();
    const elapsedSeconds = Math.round(elapsedMs / 1000);

    let estimatedRemainingSeconds: number | null = null;
    if (session.chunks_uploaded_to_blockchain > 0) {
      const avgTimePerChunk = elapsedMs / session.chunks_uploaded_to_blockchain;
      const remainingChunks = session.total_chunks - session.chunks_uploaded_to_blockchain;
      estimatedRemainingSeconds = Math.round((avgTimePerChunk * remainingChunks) / 1000);
    }

    const progress = {
      chunks_uploaded: session.chunks_uploaded_to_blockchain,
      total_chunks: session.total_chunks,
      percentage: Math.round((session.chunks_uploaded_to_blockchain / session.total_chunks) * 100),
      remaining_chunks: session.total_chunks - session.chunks_uploaded_to_blockchain,
      elapsed_seconds: elapsedSeconds,
      estimated_remaining_seconds: estimatedRemainingSeconds,
      last_chunk_uploaded_at: session.last_chunk_uploaded_at?.toISOString()
    };

    return c.json({
      file_id: session.file_id,
      status: session.status,
      completed: session.completed,
      progress,
      // Legacy fields for backward compatibility
      chunks_received: session.chunks_received.size,
      total_chunks: session.total_chunks,
      chunks_uploaded_to_blockchain: session.chunks_uploaded_to_blockchain,
      progress_percentage: progress.percentage,
      error: session.error,
      // Additional metadata
      file_info: {
        original_filename: session.metadata.original_filename,
        file_size: session.metadata.total_size,
        content_type: session.metadata.content_type,
        owner: session.metadata.owner
      }
    });
  } catch (error) {
    console.error('File status error:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

app.get('/health', async (c) => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      database: 'connected',
      redis: 'unknown'
    }
  };

  // Check Redis connectivity
  try {
    const sessionStore = (uploadService as any).sessionStore;
    if (sessionStore && sessionStore.isRedisConnected()) {
      await sessionStore.ping();
      health.services.redis = 'connected';
    } else {
      health.services.redis = 'disconnected';
      health.status = 'degraded';
    }
  } catch (error) {
    // Redis errors are not critical - service can still function
    health.services.redis = 'error';
  }

  // Always return 200 - Docker health check expects it
  return c.json(health, 200);
});

// Apply error handling middleware (must be last)
app.use('*', errorHandlingMiddleware);

// 404 handler for unmatched routes
app.notFound(notFoundHandler);

const port = parseInt(process.env.PORT || '3000');

console.log(`🚀 File DB service starting on port ${port}`);

export default {
  port,
  fetch: app.fetch,
  idleTimeout: Math.min(parseInt(process.env.BLOCKCHAIN_TIMEOUT || '120000') / 1000, 255), // Max 255 seconds for Bun
};