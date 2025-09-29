#!/bin/bash

echo "🚀 File DB Comprehensive Performance Analysis"
echo "============================================="

url="https://upload.filedb.online"

# Test files with varying sizes
test_files=(
    "test_512kb.bin:512KB"
    "test_1mb.bin:1MB"
    "test_2mb.bin:2MB"
    "test_5mb.bin:5MB"
    "test_10mb.bin:10MB"
    "test_25mb.bin:25MB"
    "test_50mb.bin:50MB"
)

echo "File Size | Upload Time | Upload Speed | Upload Status | Download Time | Download Speed | Download Status | Persistence Check"
echo "----------|-------------|--------------|---------------|---------------|----------------|-----------------|------------------"

success_count=0
total_tests=0
max_working_size=""

for test_entry in "${test_files[@]}"; do
    file=$(echo "$test_entry" | cut -d: -f1)
    size_label=$(echo "$test_entry" | cut -d: -f2)

    if [ ! -f "$file" ]; then
        echo "Skipping $size_label - file not found"
        continue
    fi

    total_tests=$((total_tests + 1))

    size_bytes=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file")
    size_mb=$(echo "scale=2; $size_bytes / 1048576" | bc)

    # Upload test
    idempotency_key="comprehensive-$(date +%s)-$(basename $file .bin)"

    echo -n "Testing $size_label... "

    start=$(date +%s.%3N)
    response=$(curl -s -X POST "$url/files" \
        -F "file=@$file" \
        -H "Idempotency-Key: $idempotency_key")
    end=$(date +%s.%3N)

    upload_time=$(echo "$end - $start" | bc)

    # Check upload response
    file_id=$(echo "$response" | jq -r '.file_id // empty' 2>/dev/null)
    upload_status="FAILED"
    download_time="N/A"
    download_speed="N/A"
    download_status="FAILED"
    persistence_check="FAILED"

    if [ -n "$file_id" ] && [ "$file_id" != "null" ] && [ "$file_id" != "empty" ]; then
        upload_status="SUCCESS"
        upload_speed=$(echo "scale=2; $size_mb / $upload_time" | bc)

        # Wait a moment for blockchain processing
        sleep 2

        # Download test
        start=$(date +%s.%3N)
        download_response=$(curl -s -w "%{http_code}" "$url/files/$file_id" -o "/tmp/test_download_$size_label")
        end=$(date +%s.%3N)

        http_code="${download_response: -3}"

        if [ "$http_code" = "200" ] && [ -f "/tmp/test_download_$size_label" ]; then
            download_time=$(echo "$end - $start" | bc)
            download_speed=$(echo "scale=2; $size_mb / $download_time" | bc)
            download_status="SUCCESS"

            # Verify file integrity
            original_size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file")
            downloaded_size=$(stat -f%z "/tmp/test_download_$size_label" 2>/dev/null || stat -c%s "/tmp/test_download_$size_label")

            if [ "$original_size" = "$downloaded_size" ]; then
                persistence_check="SUCCESS"
                success_count=$((success_count + 1))
                max_working_size="$size_label"
            else
                persistence_check="SIZE_MISMATCH"
            fi

            rm -f "/tmp/test_download_$size_label"
        else
            download_status="HTTP_$http_code"
            persistence_check="NO_DOWNLOAD"
        fi
    else
        upload_speed="N/A"
        error_msg=$(echo "$response" | jq -r '.error // .message // "Unknown error"' 2>/dev/null)
        upload_status="FAILED ($error_msg)"
    fi

    printf "%-9s | %-11s | %-12s | %-13s | %-13s | %-14s | %-15s | %-17s\\n" \
        "$size_label" \
        "${upload_time}s" \
        "${upload_speed} MB/s" \
        "$upload_status" \
        "${download_time}s" \
        "${download_speed} MB/s" \
        "$download_status" \
        "$persistence_check"

    # Brief pause between tests
    sleep 1
done

echo ""
echo "📊 Performance Summary"
echo "====================="
echo "Total tests: $total_tests"
echo "Successful end-to-end: $success_count"
echo "Success rate: $(echo "scale=1; $success_count * 100 / $total_tests" | bc)%"
if [ -n "$max_working_size" ]; then
    echo "Max working file size: $max_working_size"
else
    echo "Max working file size: None (all tests failed)"
fi

echo ""
echo "✅ Comprehensive performance test completed!"