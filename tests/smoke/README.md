# Smoke Tests

Smoke tests verify that the basic functionality of FileDB is working correctly. These tests should be run after deployment to ensure the system is operational.

## Test Suites

### 1. Health Check Tests (`health.test.ts`)
- ✅ Health endpoint returns 200
- ✅ Services status (Redis, Database)
- ✅ Timestamp is present

### 2. Authentication Tests (`auth.test.ts`)
- ✅ User registration
- ✅ User login with valid credentials
- ✅ Login rejection with invalid credentials
- ✅ JWT token validation

### 3. Upload/Download Tests (`upload-download.test.ts`)
- ✅ File upload
- ✅ File metadata retrieval
- ✅ File download with content verification
- ✅ Entity keys after blockchain upload
- ✅ Upload status tracking
- ✅ Quota updates

### 4. Query Tests (`query.test.ts`)
- ✅ Query files by extension
- ✅ Query files by content type
- ✅ Query files by owner
- ✅ Empty results for non-existent data

## Running Tests

### Run all smoke tests
```bash
bun run test:smoke
```

### Run against local development server
```bash
bun run test:smoke:local
```

### Run against production
```bash
bun run test:smoke:production
```

### Run specific test file
```bash
bun test tests/smoke/health.test.ts
```

### Run with custom URL
```bash
TEST_BASE_URL=https://custom.url.com bun test tests/smoke
```

## Requirements

- Server must be running at the target URL
- Redis must be available and connected
- Blockchain (Arkiv) connection must be working

## Expected Behavior

All tests should pass on a healthy deployment. Test failures indicate:

- **Health tests fail**: Basic infrastructure issues (server down, Redis disconnected)
- **Auth tests fail**: Authentication system problems (JWT secret, user storage)
- **Upload/Download tests fail**: Core functionality broken (chunking, storage, blockchain)
- **Query tests fail**: Search/indexing issues (metadata retrieval, filtering)

## Test Data

Tests create temporary data with unique identifiers (timestamps) to avoid conflicts. Data is scoped to test users and is not cleaned up automatically.

## Timeout Configuration

Some tests have extended timeouts for blockchain operations:
- Standard timeout: 5 seconds
- Blockchain operations: 10 seconds

## CI/CD Integration

Add to your deployment pipeline:

```yaml
# Example GitHub Actions
- name: Run smoke tests
  run: |
    bun run test:smoke:production
```

## Monitoring

Consider running smoke tests periodically (e.g., every 5 minutes) as synthetic monitoring to detect service degradation early.
