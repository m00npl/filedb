#!/bin/bash

echo "🚀 File DB Performance Test - Upload & Download Speed"
echo "====================================================="

# Array of test files
files=("test_512kb.bin" "test_1mb.bin" "test_2mb.bin" "test_5mb.bin" "test_10mb.bin" "test_25mb.bin" "test_50mb.bin")
url="https://upload.filedb.online"

# Results arrays
declare -a upload_times
declare -a download_times
declare -a file_ids
declare -a file_sizes

echo "📊 Starting performance tests..."
echo ""

for file in "${files[@]}"; do
    if [ ! -f "$file" ]; then
        echo "❌ File $file not found, skipping..."
        continue
    fi

    size=$(ls -lh "$file" | awk '{print $5}')
    echo "📁 Testing file: $file ($size)"

    # Upload test
    echo "  ⬆️  Upload test..."
    idempotency_key="perf-test-$(date +%s)-$(basename $file)"

    start_time=$(date +%s.%3N)
    response=$(curl -s -X POST "$url/files" \
        -F "file=@$file" \
        -H "Idempotency-Key: $idempotency_key" \
        -w "HTTPSTATUS:%{http_code}")
    end_time=$(date +%s.%3N)

    # Parse response
    body=$(echo "$response" | sed -E 's/HTTPSTATUS:[0-9]{3}$//')
    http_status=$(echo "$response" | grep -o '[0-9]*$')

    upload_time=$(echo "$end_time - $start_time" | bc)

    if [ "$http_status" -eq 200 ]; then
        file_id=$(echo "$body" | jq -r '.file_id // empty')

        if [ -n "$file_id" ] && [ "$file_id" != "null" ]; then
            echo "  ✅ Upload successful: ${upload_time}s"
            upload_times+=("$upload_time")
            file_ids+=("$file_id")
            file_sizes+=("$size")

            # Download test
            echo "  ⬇️  Download test..."
            start_time=$(date +%s.%3N)
            curl -s "$url/files/$file_id" -o "/tmp/downloaded_$(basename $file)" > /dev/null
            end_time=$(date +%s.%3N)

            download_time=$(echo "$end_time - $start_time" | bc)
            echo "  ✅ Download successful: ${download_time}s"
            download_times+=("$download_time")

            # Cleanup
            rm -f "/tmp/downloaded_$(basename $file)"
        else
            echo "  ❌ Upload failed: Invalid file_id"
            upload_times+=("ERROR")
            download_times+=("ERROR")
        fi
    else
        echo "  ❌ Upload failed: HTTP $http_status"
        echo "  Response: $body"
        upload_times+=("ERROR")
        download_times+=("ERROR")
    fi

    echo ""
    sleep 1  # Brief pause between tests
done

# Results summary
echo "📈 PERFORMANCE RESULTS SUMMARY"
echo "=============================="
printf "%-12s %-12s %-12s %-12s %-12s\n" "File Size" "Upload (s)" "Upload MB/s" "Download (s)" "Download MB/s"
echo "------------------------------------------------------------------------"

for i in "${!files[@]}"; do
    if [ -f "${files[$i]}" ]; then
        file="${files[$i]}"
        size_bytes=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file")
        size_mb=$(echo "scale=2; $size_bytes / 1024 / 1024" | bc)

        if [ "${upload_times[$i]}" != "ERROR" ] && [ "${download_times[$i]}" != "ERROR" ]; then
            upload_speed=$(echo "scale=2; $size_mb / ${upload_times[$i]}" | bc)
            download_speed=$(echo "scale=2; $size_mb / ${download_times[$i]}" | bc)

            printf "%-12s %-12s %-12s %-12s %-12s\n" \
                "${file_sizes[$i]}" \
                "${upload_times[$i]}" \
                "${upload_speed}" \
                "${download_times[$i]}" \
                "${download_speed}"
        else
            printf "%-12s %-12s %-12s %-12s %-12s\n" \
                "${file_sizes[$i]}" \
                "ERROR" \
                "ERROR" \
                "ERROR" \
                "ERROR"
        fi
    fi
done

echo ""
echo "✅ Performance test completed!"