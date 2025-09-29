#!/bin/bash

url="https://upload.filedb.online"
file="test_40mb.bin"
size_mb=40
idempotency_key="test-40mb-$(date +%s)"

echo "🧪 Testing 40MB file upload performance with optimizations..."
echo "============================================================"

start=$(date +%s.%3N)
response=$(curl -s -X POST "$url/files" \
    -F "file=@$file" \
    -H "Idempotency-Key: $idempotency_key")
end=$(date +%s.%3N)

upload_time=$(echo "$end - $start" | bc)
upload_speed=$(echo "scale=2; $size_mb / $upload_time" | bc)

echo "Upload time: ${upload_time}s"
echo "Upload speed: ${upload_speed} MB/s"

file_id=$(echo "$response" | jq -r '.file_id // empty' 2>/dev/null)
if [ -n "$file_id" ] && [ "$file_id" != "null" ] && [ "$file_id" != "empty" ]; then
    echo "Upload successful! File ID: $file_id"

    echo ""
    echo "⏳ Waiting for blockchain processing..."
    sleep 3

    echo "🔄 Testing download..."
    start=$(date +%s.%3N)
    download_response=$(curl -s -w "%{http_code}" "$url/files/$file_id" -o "/tmp/test_40mb_download")
    end=$(date +%s.%3N)

    download_time=$(echo "$end - $start" | bc)
    download_speed=$(echo "scale=2; $size_mb / $download_time" | bc)
    http_code="${download_response: -3}"

    if [ "$http_code" = "200" ]; then
        echo "Download time: ${download_time}s"
        echo "Download speed: ${download_speed} MB/s"

        original_size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file")
        downloaded_size=$(stat -f%z "/tmp/test_40mb_download" 2>/dev/null || stat -c%s "/tmp/test_40mb_download")

        if [ "$original_size" = "$downloaded_size" ]; then
            total_time=$(echo "$upload_time + $download_time" | bc)
            echo ""
            echo "✅ SUCCESSFUL END-TO-END TEST"
            echo "   Upload: ${upload_time}s (${upload_speed} MB/s)"
            echo "   Download: ${download_time}s (${download_speed} MB/s)"
            echo "   Total time: ${total_time}s"
        else
            echo "❌ File size mismatch!"
        fi

        rm -f "/tmp/test_40mb_download"
    else
        echo "❌ Download failed (HTTP $http_code)"
    fi
else
    error_msg=$(echo "$response" | jq -r '.error // .message // "Unknown error"' 2>/dev/null)
    echo "❌ Upload failed: $error_msg"
fi