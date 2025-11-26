// Demo functionality for the File DB documentation site

class FileDBDemo {
  constructor() {
    // Use current host for demo
    const baseUrl = window.location.origin
    this.client = new FileDB(baseUrl)
    this.currentFileId = null
    this.currentFileName = null
    this.initializeEventListeners()
  }

  initializeEventListeners() {
    const uploadBtn = document.getElementById("uploadBtn")
    const fileInput = document.getElementById("fileInput")
    const downloadBtn = document.getElementById("downloadBtn")

    if (uploadBtn) {
      uploadBtn.addEventListener("click", () => this.handleUpload())
    }

    if (fileInput) {
      fileInput.addEventListener("change", () => this.handleFileSelection())
    }

    if (downloadBtn) {
      downloadBtn.addEventListener("click", () => this.handleDownload())
    }
  }

  handleFileSelection() {
    const input = document.getElementById("fileInput")
    const uploadBtn = document.getElementById("uploadBtn")

    if (input.files && input.files[0]) {
      const file = input.files[0]
      const validation = FileDB.validateFile(file)

      if (validation.valid) {
        uploadBtn.disabled = false
        uploadBtn.textContent = `Upload ${file.name}`
        this.hideResults()
      } else {
        uploadBtn.disabled = true
        uploadBtn.textContent = "Invalid File"
        this.showError(validation.errors.join(", "))
      }
    } else {
      uploadBtn.disabled = true
      uploadBtn.textContent = "Upload File"
    }
  }

  async handleUpload() {
    const input = document.getElementById("fileInput")
    const file = input.files[0]

    if (!file) {
      this.showError("Please select a file first")
      return
    }

    this.showUploading()

    try {
      const idempotencyKey = FileDB.generateIdempotencyKey()

      // Upload the file
      const result = await this.client.upload(file, {
        idempotencyKey: idempotencyKey,
        ttlDays: 7,
      })

      this.currentFileId = result.file_id
      this.currentFileName = file.name

      // Get file info to verify upload (retry for up to 1 minute)
      const fileInfo = await this.getFileInfoWithRetry(result.file_id, 60000, 2000)

      this.showSuccess({
        fileId: result.file_id,
        fileSize: this.formatFileSize(file.size),
        chunkCount: fileInfo.chunk_count,
        fileType: file.type || "application/octet-stream",
        originalFile: file,
        fileInfo: fileInfo,
      })
    } catch (error) {
      this.showError(error.message)
    }
  }

  async getFileInfoWithRetry(fileId, maxDuration = 60000, interval = 2000) {
    const startTime = Date.now()
    const maxRetries = Math.floor(maxDuration / interval)

    return new Promise((resolve, reject) => {
      let attempts = 0

      const tryGetInfo = async () => {
        try {
          const fileInfo = await this.client.getInfo(fileId)
          resolve(fileInfo)
        } catch (error) {
          attempts++
          const elapsed = Date.now() - startTime

          if (elapsed >= maxDuration || attempts >= maxRetries) {
            reject(
              new Error(`Failed to get file info after ${attempts} attempts: ${error.message}`),
            )
          } else {
            setTimeout(tryGetInfo, interval)
          }
        }
      }

      tryGetInfo()
    })
  }

  async handleDownload() {
    if (!this.currentFileId) {
      this.showError("No file to download")
      return
    }

    try {
      await this.client.download(this.currentFileId, this.currentFileName || "retrieved-file")
    } catch (error) {
      this.showError(`Download failed: ${error.message}`)
    }
  }

  showUploading() {
    this.hideResults()
    const status = document.getElementById("uploadStatus")
    const uploadBtn = document.getElementById("uploadBtn")

    status.classList.remove("hidden")
    uploadBtn.disabled = true
    uploadBtn.textContent = "Uploading..."
  }

  showSuccess(data) {
    const status = document.getElementById("uploadStatus")
    const result = document.getElementById("uploadResult")
    const uploadBtn = document.getElementById("uploadBtn")

    // Hide uploading status
    status.classList.add("hidden")

    // Show success result
    result.classList.remove("hidden")

    // Populate result data
    document.getElementById("fileId").textContent = data.fileId
    document.getElementById("fileSize").textContent = data.fileSize
    document.getElementById("chunkCount").textContent = data.chunkCount
    document.getElementById("fileType").textContent = data.fileType

    // Reset upload button
    uploadBtn.disabled = false
    uploadBtn.textContent = "Upload Another File"

    // Show file integrity comparison
    this.showIntegrityCheck(data.originalFile, data.fileInfo)
  }

  showError(message) {
    this.hideResults()
    const error = document.getElementById("errorResult")
    const uploadBtn = document.getElementById("uploadBtn")

    error.classList.remove("hidden")
    document.getElementById("errorMessage").textContent = message

    uploadBtn.disabled = false
    uploadBtn.textContent = "Try Again"
  }

  hideResults() {
    const status = document.getElementById("uploadStatus")
    const result = document.getElementById("uploadResult")
    const error = document.getElementById("errorResult")

    status.classList.add("hidden")
    result.classList.add("hidden")
    error.classList.add("hidden")
  }

  async showIntegrityCheck(originalFile, fileInfo) {
    try {
      // Compare file metadata for integrity check
      const originalSize = originalFile.size
      const retrievedSize = fileInfo.total_size
      const originalType = originalFile.type || "application/octet-stream"
      const retrievedType = fileInfo.content_type

      const sizeMatch = originalSize === retrievedSize
      const typeMatch = originalType === retrievedType
      const integrityMatch = sizeMatch && typeMatch

      // Add integrity indicator to the result
      const resultDiv = document.getElementById("uploadResult")
      const integrityDiv = document.createElement("div")
      integrityDiv.className = `mt-2 p-2 rounded ${integrityMatch ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`
      integrityDiv.innerHTML = `
        <div class="flex items-center text-sm">
          <span class="mr-2">${integrityMatch ? "✅" : "❌"}</span>
          <span>Integrity Check: ${integrityMatch ? "PASSED" : "FAILED"}</span>
        </div>
        <div class="text-xs mt-1 ml-6">
          <div>Size: ${originalSize} bytes → ${retrievedSize} bytes ${sizeMatch ? "✅" : "❌"}</div>
          <div>Type: ${originalType} → ${retrievedType} ${typeMatch ? "✅" : "❌"}</div>
          <div>Checksum: ${fileInfo.checksum ? fileInfo.checksum.substring(0, 16) + "..." : "N/A"}</div>
        </div>
      `

      resultDiv.appendChild(integrityDiv)
    } catch (error) {
      console.warn("Could not perform integrity check:", error)
    }
  }

  formatFileSize(bytes) {
    if (bytes === 0) return "0 Bytes"

    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return parseFloat((bytes / k ** i).toFixed(2)) + " " + sizes[i]
  }
}

// Initialize demo when DOM is loaded and FileDB is available
document.addEventListener("DOMContentLoaded", () => {
  // Wait for FileDB to be available
  if (typeof FileDB !== "undefined") {
    new FileDBDemo()
  } else {
    // Retry after a short delay if FileDB is not yet loaded
    setTimeout(() => {
      if (typeof FileDB !== "undefined") {
        new FileDBDemo()
      } else {
        console.error("FileDB SDK not loaded")
      }
    }, 100)
  }
})

// Add smooth scrolling for anchor links
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", function (e) {
    e.preventDefault()
    const target = document.querySelector(this.getAttribute("href"))
    if (target) {
      target.scrollIntoView({
        behavior: "smooth",
        block: "start",
      })
    }
  })
})

// Add copy-to-clipboard functionality for code blocks
document.querySelectorAll("pre code").forEach((block) => {
  const wrapper = block.closest("pre")
  if (wrapper) {
    const button = document.createElement("button")
    button.className =
      "absolute top-2 right-2 bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity"
    button.textContent = "Copy"

    wrapper.style.position = "relative"
    wrapper.className += " group"
    wrapper.appendChild(button)

    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(block.textContent)
        button.textContent = "Copied!"
        setTimeout(() => {
          button.textContent = "Copy"
        }, 2000)
      } catch (err) {
        console.error("Failed to copy text: ", err)
      }
    })
  }
})
