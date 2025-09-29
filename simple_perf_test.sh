#!/bin/bash

echo "🚀 File DB Simple Performance Test"
echo "=================================="

url="https://upload.filedb.online"

# Test files
test_files=("test_512kb.bin" "test_1mb.bin" "test_2mb.bin" "test_5mb.bin")

echo "File Size | Upload Time | Upload Speed | Download Time | Download Speed"
echo "---------|-------------|--------------|---------------|---------------"

for file in "${test_files[@]}"; do
    if [ ! -f "$file" ]; then
        echo "Skipping $file - not found"
        continue
    fi

    size_bytes=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file")
    size_mb=$(echo "scale=2; $size_bytes / 1048576" | bc)
    size_display=$(ls -lh "$file" | awk '{print $5}')

    # Upload test
    idempotency_key="perf-$(date +%s)-$(basename $file .bin)"

    echo -n "Testing $size_display... "

    start=$(date +%s.%3N)
    response=$(curl -s -X POST "$url/files" \
        -F "file=@$file" \
        -H "Idempotency-Key: $idempotency_key")
    end=$(date +%s.%3N)

    upload_time=$(echo "$end - $start" | bc)

    # Check if upload successful
    file_id=$(echo "$response" | jq -r '.file_id // empty' 2>/dev/null)

    if [ -n "$file_id" ] && [ "$file_id" != "null" ] && [ "$file_id" != "empty" ]; then
        upload_speed=$(echo "scale=2; $size_mb / $upload_time" | bc)

        # Download test
        start=$(date +%s.%3N)
        curl -s "$url/files/$file_id" -o "/tmp/test_download" > /dev/null
        end=$(date +%s.%3N)

        download_time=$(echo "$end - $start" | bc)
        download_speed=$(echo "scale=2; $size_mb / $download_time" | bc)

        printf "%-8s | %-11s | %-12s | %-13s | %-14s\n" \
            "$size_display" \
            "${upload_time}s" \
            "${upload_speed} MB/s" \
            "${download_time}s" \
            "${download_speed} MB/s"

        rm -f "/tmp/test_download"
    else
        echo "FAILED - $response"
    fi

    sleep 1
done

echo ""
echo "✅ Performance test completed!"