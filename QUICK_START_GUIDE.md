# FileDB Quick Start Implementation Guide

## Immediate Actions (Start Today)

### 1. Emergency Security Fixes (2-4 hours)
These can be implemented immediately without breaking existing functionality:

```bash
# 1. Add input validation middleware
mkdir -p src/middleware
```

Create `src/middleware/security.ts`:
```typescript
import { Context, Next } from 'hono';

export class SecurityMiddleware {
  static validateFileUpload() {
    return async (c: Context, next: Next) => {
      const contentLength = c.req.header('content-length');
      if (contentLength && parseInt(contentLength) > 10 * 1024 * 1024) {
        return c.json({ error: 'File too large' }, 413);
      }
      await next();
    };
  }

  static sanitizeHeaders() {
    return async (c: Context, next: Next) => {
      await next();
      // Add security headers
      c.header('X-Content-Type-Options', 'nosniff');
      c.header('X-Frame-Options', 'DENY');
      c.header('X-XSS-Protection', '1; mode=block');
    };
  }
}
```

Update `src/server.ts`:
```typescript
import { SecurityMiddleware } from './middleware/security';

// Add after app creation
app.use('*', SecurityMiddleware.sanitizeHeaders());
app.use('/files', SecurityMiddleware.validateFileUpload());
```

### 2. Environment Variable Audit (1 hour)
```bash
# Check for exposed secrets
grep -r "process.env" src/ --include="*.ts"
grep -r "console.log.*env" src/ --include="*.ts"
```

Create `src/config/environment.ts`:
```typescript
export const validateEnvironment = () => {
  const required = ['GOLEM_PRIVATE_KEY', 'PORT'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
};
```

### 3. Error Response Sanitization (1 hour)
Create `src/middleware/error-handler.ts`:
```typescript
export const errorHandler = (error: Error, c: Context) => {
  console.error('Server error:', error);

  // Never expose internal errors in production
  if (process.env.NODE_ENV === 'production') {
    return c.json({ error: 'Internal server error' }, 500);
  }

  return c.json({ error: error.message }, 500);
};
```

## Week 1 Priority Implementation

### Day 1: Security Foundation
```bash
# Install security dependencies
bun add joi helmet express-rate-limit

# Create security configuration
mkdir -p src/config
```

### Day 2: Basic Authentication
```bash
# Install JWT dependencies
bun add jsonwebtoken @types/jsonwebtoken

# Create auth middleware
mkdir -p src/middleware
```

### Day 3: Monitoring Setup
```bash
# Install monitoring dependencies
bun add prom-client

# Create metrics collection
mkdir -p src/metrics
```

## Implementation Priority Matrix

### 🔴 Critical (Implement First)
1. **Input validation** - Prevents security vulnerabilities
2. **Error sanitization** - Stops information leakage
3. **Rate limiting** - Prevents abuse
4. **Environment validation** - Catches configuration errors

### 🟡 High Priority (Week 1)
1. **Authentication system** - Required for production use
2. **Structured logging** - Essential for debugging
3. **Health checks** - Required for deployment
4. **Basic monitoring** - Essential for operations

### 🟢 Medium Priority (Week 2-4)
1. **Parallel processing** - Major performance improvement
2. **Caching layer** - Significant speed boost
3. **Memory optimization** - Scalability requirement
4. **Session externalization** - Horizontal scaling enabler

## Quick Performance Wins

### 1. Enable Parallel Chunk Uploads (2-3 hours)
Update `src/services/upload.ts`:
```typescript
private async uploadToBlockchainAsync(chunks: any[], metadata: FileMetadata, session: UploadSession): Promise<void> {
  const CONCURRENCY = 4; // Parallel uploads
  const chunkPromises = [];

  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY);
    const batchPromise = Promise.all(
      batch.map(chunk => this.uploadSingleChunk(chunk, session))
    );
    chunkPromises.push(batchPromise);
  }

  await Promise.all(chunkPromises);
}

private async uploadSingleChunk(chunk: any, session: UploadSession): Promise<void> {
  try {
    await this.storage.storeChunk(chunk);
    session.chunks_uploaded_to_blockchain++;
    session.last_chunk_uploaded_at = new Date();
  } catch (error) {
    console.error(`Failed to upload chunk ${chunk.chunk_index}:`, error);
    throw error;
  }
}
```

### 2. Add Basic Caching (1-2 hours)
```bash
# Install Redis client
bun add redis
```

Create simple metadata cache:
```typescript
// src/services/simple-cache.ts
export class SimpleCache {
  private cache = new Map<string, { data: any; timestamp: number }>();
  private TTL = 5 * 60 * 1000; // 5 minutes

  set(key: string, data: any): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  get(key: string): any | null {
    const item = this.cache.get(key);
    if (!item || Date.now() - item.timestamp > this.TTL) {
      this.cache.delete(key);
      return null;
    }
    return item.data;
  }
}
```

### 3. Optimize Batch Sizes (30 minutes)
Update batch configuration in `src/services/upload.ts`:
```typescript
// Increase batch size for better performance
const BATCH_SIZE = 5; // Increased from 2

// Add dynamic batch sizing based on file size
const dynamicBatchSize = Math.min(
  Math.max(2, Math.floor(chunks.length / 10)), // 10% of chunks
  8 // Maximum batch size
);
```

## Docker Deployment Commands

### Build and Deploy (Development)
```bash
# Build with no cache
docker buildx build --no-cache -t moonplkr/filesdb:latest .

# Push to Docker Hub
docker push moonplkr/filesdb:latest

# Deploy on server
ssh ubuntu@moon.dev.golem.network "
  docker pull moonplkr/filesdb:latest &&
  docker-compose down &&
  docker-compose up -d
"
```

### Production Deployment
```bash
# Build production image
docker buildx build --no-cache --platform linux/amd64 -t moonplkr/filesdb:v1.1.0 .
docker push moonplkr/filesdb:v1.1.0

# Deploy with health checks
ssh ubuntu@moon.dev.golem.network "
  export IMAGE_TAG=v1.1.0 &&
  docker-compose -f docker-compose.prod.yml pull &&
  docker-compose -f docker-compose.prod.yml up -d
"
```

## Testing Commands

### Security Testing
```bash
# Test file upload limits
curl -X POST http://localhost:3000/files \
  -F "file=@large_file.bin" \
  -H "Content-Type: multipart/form-data"

# Test rate limiting
for i in {1..20}; do
  curl -X GET http://localhost:3000/health &
done
```

### Performance Testing
```bash
# Install Artillery for load testing
bun add -g artillery

# Create test configuration
echo "config:
  target: 'http://localhost:3000'
  phases:
    - duration: 60
      arrivalRate: 10
scenarios:
  - name: 'Upload test'
    requests:
      - post:
          url: '/files'
          formData:
            file: '@test-file.txt'" > load-test.yml

# Run load test
artillery run load-test.yml
```

### Memory Testing
```bash
# Monitor memory usage during upload
bun add -g clinic

# Profile memory usage
clinic doctor -- bun run src/server.ts

# Upload test files while monitoring
curl -X POST http://localhost:3000/files \
  -F "file=@test_5mb.bin"
```

## Monitoring Setup

### Basic Prometheus Metrics
Create `src/metrics/basic.ts`:
```typescript
import { register, Counter, Histogram, Gauge } from 'prom-client';

export const uploadCounter = new Counter({
  name: 'filesdb_uploads_total',
  help: 'Total number of file uploads',
  labelNames: ['status']
});

export const uploadDuration = new Histogram({
  name: 'filesdb_upload_duration_seconds',
  help: 'File upload duration',
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60]
});

export const memoryUsage = new Gauge({
  name: 'filesdb_memory_usage_bytes',
  help: 'Memory usage in bytes'
});

// Update memory usage every 10 seconds
setInterval(() => {
  const usage = process.memoryUsage();
  memoryUsage.set(usage.heapUsed);
}, 10000);
```

Add metrics endpoint to `src/server.ts`:
```typescript
import { register } from 'prom-client';

app.get('/metrics', async (c) => {
  return new Response(await register.metrics(), {
    headers: { 'Content-Type': register.contentType }
  });
});
```

## Configuration Management

### Environment Variables Priority
```bash
# .env.example - Updated with all new variables
cat >> .env.example << EOF

# Security Configuration
JWT_SECRET=your-jwt-secret-here
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=900000

# Performance Configuration
CHUNK_UPLOAD_CONCURRENCY=4
BATCH_SIZE=5
CACHE_TTL=300

# Monitoring Configuration
METRICS_ENABLED=true
LOG_LEVEL=info

# Redis Configuration (Phase 3)
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=your-redis-password

# Database Configuration
MAX_CONNECTIONS=10
CONNECTION_TIMEOUT=30000
EOF
```

### Docker Compose Updates
```yaml
# docker-compose.yml - Add Redis for caching
version: '3.8'
services:
  filesdb:
    image: moonplkr/filesdb:latest
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes

volumes:
  redis_data:
```

## Migration Strategy

### Phase 1 Migration (No Downtime)
1. Deploy security fixes immediately
2. Add new endpoints without removing old ones
3. Gradually migrate authentication
4. Monitor error rates and performance

### Phase 2 Migration (Scheduled Downtime)
1. Deploy Redis alongside current system
2. Implement dual-write for sessions
3. Migrate existing sessions
4. Switch to Redis-only operation
5. Remove in-memory session storage

### Rollback Plan
```bash
# Quick rollback procedure
ssh ubuntu@moon.dev.golem.network "
  docker-compose down &&
  docker tag moonplkr/filesdb:v1.0.0 moonplkr/filesdb:latest &&
  docker-compose up -d
"
```

## Success Metrics to Track

### Immediate (Week 1)
- Security vulnerabilities: 0
- Error rate: <1%
- Response time: <500ms avg
- Memory usage: <100MB

### Short-term (Month 1)
- Upload speed improvement: >50%
- Concurrent users: >100
- Cache hit rate: >80%
- Uptime: >99.9%

### Long-term (Month 3)
- File size support: Up to 100MB
- Global response time: <200ms
- Horizontal scaling: 5+ instances
- Data durability: 99.999%

This quick start guide should enable immediate implementation of the most critical improvements while providing a clear path for the full roadmap implementation.