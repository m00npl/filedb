# FileDB

[![Docker](https://img.shields.io/badge/docker-ready-blue)](https://hub.docker.com/r/moonplkr/filesdb)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Live Demo](https://img.shields.io/badge/demo-live-success)](https://filedb.online)

File chunking middleware for Golem DB that splits large files into safe-sized chunks, stores them securely, and serves them back as single files. Perfect for documents, media, archives, and any file type up to 50MB.

## ✨ Features

- **Universal File Support** - Upload any file type: documents, images, videos, archives, code files
- **Large File Handling** - Support for files up to 50MB with automatic 64KB chunking
- **Data Integrity** - SHA-256 checksums ensure perfect file reconstruction
- **Idempotent Uploads** - Resume failed uploads and prevent duplicates
- **TTL Management** - Configurable file expiration (default 7 days)
- **Rate Limiting** - Built-in quota system (500MB storage, 50 uploads/day free tier)
- **RESTful API** - Simple endpoints for upload, download, and management
- **JavaScript SDK** - Lightweight 2KB client library

## 🚀 Quick Start

### Using Docker (Recommended)

```bash
# Pull and run the latest image
docker run -p 3000:3000 moonplkr/filesdb:latest

# Or with docker-compose
curl -O https://raw.githubusercontent.com/m00npl/filedb/main/docker-compose.yml
docker-compose up -d
```

### Manual Installation

```bash
# Clone the repository
git clone https://github.com/m00npl/filedb.git
cd filedb

# Install dependencies
bun install

# Copy environment file and configure
cp .env.example .env

# Start development server
bun run dev

# Or build and start production
bun run build
bun run start
```

## 📚 API Usage

### Upload a File

```bash
curl -X POST http://localhost:3000/files \
  -F "file=@document.pdf" \
  -H "Idempotency-Key: unique-key-123" \
  -H "BTL-Days: 7"
```

Response:
```json
{
  "file_id": "6bc95b27-1a5d-46e7-96e7-8edde7de5c70",
  "message": "Upload successful"
}
```

### Download a File

```bash
curl http://localhost:3000/files/6bc95b27-1a5d-46e7-96e7-8edde7de5c70 \
  -o downloaded-file.pdf
```

### Get File Information

```bash
curl http://localhost:3000/files/6bc95b27-1a5d-46e7-96e7-8edde7de5c70/info
```

Response:
```json
{
  "file_id": "6bc95b27-1a5d-46e7-96e7-8edde7de5c70",
  "original_filename": "document.pdf",
  "content_type": "application/pdf",
  "file_extension": "pdf",
  "total_size": 1048576,
  "chunk_count": 16,
  "checksum": "sha256...",
  "created_at": "2024-01-01T00:00:00Z",
  "expires_at": "2024-01-08T00:00:00Z"
}
```

## 🛠 JavaScript SDK

Download the SDK from your FileDB instance at `/sdk/filesdb-sdk.js` or use it directly:

```javascript
import FileDB from './filesdb-sdk.js';

const client = new FileDB('http://localhost:3000');

// Upload a file
const result = await client.upload(file, {
  idempotencyKey: 'unique-key',
  ttlDays: 30
});

console.log('File ID:', result.file_id);

// Download file
const fileBlob = await client.get(result.file_id);
const fileUrl = URL.createObjectURL(fileBlob);

// Get file info
const info = await client.getInfo(result.file_id);

// Check quota
const quota = await client.getQuota();
```

## 🏗 Deployment Guide

### 1. Prerequisites

- Docker and Docker Compose
- Domain name (optional, for HTTPS)
- Reverse proxy (nginx, Traefik, etc.)

### 2. Basic Deployment

```bash
# Create project directory
mkdir filedb && cd filedb

# Download docker-compose.yml
curl -O https://raw.githubusercontent.com/m00npl/filedb/main/docker-compose.yml

# Create environment file
curl -O https://raw.githubusercontent.com/m00npl/filedb/main/.env.example
mv .env.example .env

# Edit environment variables
nano .env

# Start the service
docker-compose up -d
```

### 3. Production Deployment with Nginx

Create nginx configuration (`/etc/nginx/sites-available/filedb`):

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # File upload settings
        client_max_body_size 50M;
        proxy_request_buffering off;
    }
}
```

Enable site and reload nginx:
```bash
sudo ln -s /etc/nginx/sites-available/filedb /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 4. HTTPS with Let's Encrypt

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal is usually set up automatically
sudo systemctl status certbot.timer
```

### 5. Environment Configuration

Edit `.env` file for your deployment:

```env
# Server Configuration
PORT=3000
NODE_ENV=production

# Optional: Golem DB Configuration (for future blockchain integration)
# GOLEM_CHAIN_ID=60138453025
# GOLEM_PRIVATE_KEY=your_private_key_here
# GOLEM_RPC_URL=https://kaolin.holesky.golemdb.io/rpc
# GOLEM_WS_URL=wss://kaolin.holesky.golemdb.io/rpc/ws
```

### 6. Docker Compose Configuration

Example production `docker-compose.yml`:

```yaml
version: '3.8'

services:
  filedb:
    image: moonplkr/filesdb:latest
    ports:
      - "127.0.0.1:3000:3000"  # Bind to localhost only
    environment:
      - NODE_ENV=production
      - PORT=3000
    volumes:
      - ./data:/usr/src/app/data  # Persistent data storage
      - ./.env:/usr/src/app/.env   # Environment variables
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

### 7. Monitoring and Logs

```bash
# View logs
docker-compose logs -f filedb

# Check health
curl http://localhost:3000/health

# Monitor quota usage
curl http://localhost:3000/quota
```

## 🔧 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/files` | Upload a file |
| `GET` | `/files/:file_id` | Download a file |
| `GET` | `/files/:file_id/info` | Get file metadata |
| `GET` | `/files/by-extension/:ext` | List files by extension |
| `GET` | `/files/by-type/:mime_type` | List files by MIME type |
| `GET` | `/quota` | Check quota usage |
| `GET` | `/status/:idempotency_key` | Check upload status |
| `GET` | `/health` | Health check |

## 📊 Supported File Types

- **Documents**: PDF, Word, Excel, PowerPoint, Text, CSV, RTF
- **Archives**: ZIP, RAR, 7Z, TAR, GZIP
- **Images**: JPEG, PNG, GIF, WebP, SVG, BMP, TIFF
- **Audio**: MP3, WAV, OGG, MP4, FLAC
- **Video**: MP4, MPEG, QuickTime, AVI, WebM
- **Code**: JavaScript, HTML, CSS, JSON, XML, Python, Java, C/C++
- **Other**: Any binary file as application/octet-stream

## ⚙️ Configuration

### File Limits
- Maximum file size: 50 MB
- Chunk size: 64 KB
- Default TTL: 7 days

### Free Tier Quotas
- Storage: 500 MB total
- Uploads: 50 per day
- Rate limiting: Built-in

### Customization

Environment variables for customization:

```env
# Adjust in docker-compose.yml or when running
MAX_FILE_SIZE=52428800     # 50MB in bytes
CHUNK_SIZE=65536          # 64KB in bytes
DEFAULT_TTL_DAYS=7        # Default expiration
FREE_TIER_STORAGE=524288000  # 500MB in bytes
FREE_TIER_UPLOADS=50      # Daily upload limit
```

## 🛡 Security

- No hardcoded secrets in source code
- Environment-based configuration
- Input validation and sanitization
- File type verification
- Checksum integrity verification
- Rate limiting and quota management

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🔗 Links

- **Live Demo**: [filedb.online](https://filedb.online)
- **Docker Hub**: [moonplkr/filesdb](https://hub.docker.com/r/moonplkr/filesdb)
- **GitHub**: [m00npl/filedb](https://github.com/m00npl/filedb)

## 🆘 Support

- 📧 Email: maciej.maciejowski@golem.network
- 🐛 Issues: [GitHub Issues](https://github.com/m00npl/filedb/issues)
- 📖 Documentation: Available at your deployment root URL

---

Built with ❤️ for the Golem DB ecosystem