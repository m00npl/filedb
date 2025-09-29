#!/bin/bash

echo "🚀 Deploying File DB Optimizations to Production"
echo "================================================"

SERVER="ubuntu@moon.dev.golem.network"

echo "1. Creating optimized environment configuration..."
ssh $SERVER "cd ~ && echo 'BLOCKCHAIN_TIMEOUT=300000' > .env.local"

echo "2. Pulling latest optimized Docker image..."
ssh $SERVER "docker pull moonplkr/filesdb:latest"

echo "3. Stopping current service..."
ssh $SERVER "cd ~ && docker compose down"

echo "4. Starting optimized service with new configuration..."
ssh $SERVER "cd ~ && docker compose up -d"

echo "5. Waiting for service to start..."
sleep 10

echo "6. Checking service health..."
for i in {1..6}; do
    if curl -s https://upload.filedb.online/health > /dev/null; then
        echo "✅ Service is healthy!"
        break
    else
        echo "⏳ Waiting for service to start... ($i/6)"
        sleep 5
    fi
done

echo "7. Verifying deployment..."
ssh $SERVER "docker ps | grep filesdb"

echo ""
echo "✅ Deployment completed! The following optimizations are now active:"
echo "   - Blockchain timeout: 60s → 300s (5 minutes)"
echo "   - Batch processing: 8 → 16 chunks per batch"
echo "   - Connection pooling with keepAlive and retry logic"
echo "   - Redis caching for quota checks (10-minute TTL)"
echo ""
echo "🧪 Ready for performance testing!"