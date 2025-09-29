#!/bin/bash

echo "🧪 Post-Deployment Performance Verification Test"
echo "==============================================="

url="https://upload.filedb.online"

echo "Testing File DB performance after optimizations..."
echo ""

# Quick performance test with key file sizes
test_files=("test_1mb.bin:1MB" "test_5mb.bin:5MB" "test_10mb.bin:10MB")

echo "File Size | Upload Time | Upload Speed | Download Time | Download Speed | End-to-End | Status"
echo "----------|-------------|--------------|---------------|----------------|-------------|--------"

for test_entry in "${test_files[@]}"; do
    file=$(echo "$test_entry" | cut -d: -f1)
    size_label=$(echo "$test_entry" | cut -d: -f2)

    if [ ! -f "$file" ]; then
        echo "Skipping $size_label - file not found"
        continue
    fi

    size_bytes=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file")
    size_mb=$(echo "scale=2; $size_bytes / 1048576" | bc)

    echo -n "Testing $size_label... "

    # Upload test
    idempotency_key="post-deploy-$(date +%s)-$(basename $file .bin)"

    start=$(date +%s.%3N)
    response=$(curl -s -X POST "$url/files" \
        -F "file=@$file" \
        -H "Idempotency-Key: $idempotency_key")
    end=$(date +%s.%3N)

    upload_time=$(echo "$end - $start" | bc)

    # Check upload success
    file_id=$(echo "$response" | jq -r '.file_id // empty' 2>/dev/null)

    if [ -n "$file_id" ] && [ "$file_id" != "null" ] && [ "$file_id" != "empty" ]; then
        upload_speed=$(echo "scale=2; $size_mb / $upload_time" | bc)

        # Brief wait for blockchain processing
        sleep 2

        # Download test
        start=$(date +%s.%3N)
        download_response=$(curl -s -w "%{http_code}" "$url/files/$file_id" -o "/tmp/test_download_$size_label")
        end=$(date +%s.%3N)

        download_time=$(echo "$end - $start" | bc)
        http_code="${download_response: -3}"

        if [ "$http_code" = "200" ] && [ -f "/tmp/test_download_$size_label" ]; then
            # Verify file integrity
            original_size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file")
            downloaded_size=$(stat -f%z "/tmp/test_download_$size_label" 2>/dev/null || stat -c%s "/tmp/test_download_$size_label")

            if [ "$original_size" = "$downloaded_size" ]; then
                download_speed=$(echo "scale=2; $size_mb / $download_time" | bc)
                total_time=$(echo "$upload_time + $download_time" | bc)
                status="✅ SUCCESS"
            else
                download_speed="SIZE_ERR"
                total_time="N/A"
                status="❌ SIZE_MISMATCH"
            fi

            rm -f "/tmp/test_download_$size_label"
        else
            download_speed="N/A"
            download_time="N/A"
            total_time="N/A"
            status="❌ DOWNLOAD_FAILED"
        fi

        printf "%-9s | %-11s | %-12s | %-13s | %-14s | %-11s | %-8s\\n" \
            "$size_label" \
            "${upload_time}s" \
            "${upload_speed} MB/s" \
            "${download_time}s" \
            "${download_speed} MB/s" \
            "${total_time}s" \
            "$status"
    else
        error_msg=$(echo "$response" | jq -r '.error // .message // "Unknown error"' 2>/dev/null)
        printf "%-9s | %-11s | %-12s | %-13s | %-14s | %-11s | %-8s\\n" \
            "$size_label" \
            "${upload_time}s" \
            "FAILED" \
            "N/A" \
            "N/A" \
            "N/A" \
            "❌ $error_msg"
    fi

    sleep 1
done

echo ""
echo "📊 Expected Performance (after optimizations):"
echo "   • 1MB files: ~5-10s upload, ~1-2s download"
echo "   • 5MB files: ~15-25s upload, ~3-5s download"
echo "   • 10MB files: ~30-45s upload, ~5-8s download"
echo ""
echo "🎯 Improvements from baseline:"
echo "   • Blockchain timeout: 60s → 300s (5x increase)"
echo "   • Batch processing: 8 → 16 chunks (2x throughput)"
echo "   • Connection pooling with keepAlive enabled"
echo "   • Redis quota caching (10-minute TTL)"
echo ""
echo "✅ Performance verification completed!"