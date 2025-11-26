/**
 * File DB JavaScript SDK
 * A lightweight client for the File DB API
 * Version: 1.0.0
 */
class FileDB {
  constructor(baseUrl = "http://localhost:3000", options = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "") // Remove trailing slash
    this.maxFileSize = 10 * 1024 * 1024 // 10MB
    this.accessToken = options.accessToken || null
    this.apiKey = options.apiKey || null
    this.allowedTypes = [
      // Documents
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
      "text/csv",
      "text/markdown",
      "text/x-markdown",
      "application/rtf",

      // Archives
      "application/zip",
      "application/x-rar-compressed",
      "application/x-7z-compressed",
      "application/x-tar",
      "application/gzip",

      // Images
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "image/svg+xml",
      "image/bmp",
      "image/tiff",

      // Audio
      "audio/mpeg",
      "audio/wav",
      "audio/ogg",
      "audio/mp4",
      "audio/flac",

      // Video
      "video/mp4",
      "video/mpeg",
      "video/quicktime",
      "video/x-msvideo",
      "video/webm",

      // Code files
      "text/javascript",
      "text/html",
      "text/css",
      "application/json",
      "application/xml",
      "text/x-python",
      "text/x-java-source",
      "text/x-c",
      "text/x-c++",

      // Other
      "application/octet-stream",
    ]
  }

  /**
   * Validate a file before upload
   * @param {File} file - The file to validate
   * @returns {Object} Validation result with valid boolean and errors array
   */
  static validateFile(file) {
    const errors = []
    const sdk = new FileDB() // Create instance to access validation rules

    if (!file) {
      errors.push("No file provided")
      return { valid: false, errors }
    }

    // Check file size
    if (file.size > sdk.maxFileSize) {
      errors.push(`File size exceeds maximum limit of ${sdk.formatFileSize(sdk.maxFileSize)}`)
    }

    // Check file type (if type is detected)
    if (file.type && !sdk.allowedTypes.includes(file.type)) {
      errors.push(`File type "${file.type}" is not supported`)
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  /**
   * Set access token for authentication
   * @param {string} token - JWT access token
   */
  setAccessToken(token) {
    this.accessToken = token
  }

  /**
   * Set API key for authentication
   * @param {string} apiKey - API key
   */
  setApiKey(apiKey) {
    this.apiKey = apiKey
  }

  /**
   * Get authentication headers
   * @returns {Object} Headers object with authentication
   */
  getAuthHeaders() {
    const headers = {}

    if (this.accessToken) {
      headers["Authorization"] = `Bearer ${this.accessToken}`
    } else if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey
    }

    return headers
  }

  /**
   * Register a new user
   * @param {string} email - User email
   * @param {string} password - User password
   * @param {string} role - User role ('user' or 'admin')
   * @returns {Promise<Object>} Registration result with tokens
   */
  async register(email, password, role = "user") {
    try {
      const response = await fetch(`${this.baseUrl}/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password, role }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}: ${response.statusText}`)
      }

      // Auto-set the access token
      if (result.accessToken) {
        this.setAccessToken(result.accessToken)
      }

      return result
    } catch (error) {
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new Error("Network error: Unable to connect to File DB service")
      }
      throw error
    }
  }

  /**
   * Login user
   * @param {string} email - User email
   * @param {string} password - User password
   * @returns {Promise<Object>} Login result with tokens
   */
  async login(email, password) {
    try {
      const response = await fetch(`${this.baseUrl}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}: ${response.statusText}`)
      }

      // Auto-set the access token
      if (result.accessToken) {
        this.setAccessToken(result.accessToken)
      }

      return result
    } catch (error) {
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new Error("Network error: Unable to connect to File DB service")
      }
      throw error
    }
  }

  /**
   * Get current user information
   * @returns {Promise<Object>} User information
   */
  async getMe() {
    try {
      const response = await fetch(`${this.baseUrl}/auth/me`, {
        method: "GET",
        headers: this.getAuthHeaders(),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}: ${response.statusText}`)
      }

      return result
    } catch (error) {
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new Error("Network error: Unable to connect to File DB service")
      }
      throw error
    }
  }

  /**
   * Refresh access token
   * @param {string} refreshToken - Refresh token
   * @returns {Promise<Object>} New access token
   */
  async refreshToken(refreshToken) {
    try {
      const response = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refreshToken }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}: ${response.statusText}`)
      }

      // Auto-set the new access token
      if (result.accessToken) {
        this.setAccessToken(result.accessToken)
      }

      return result
    } catch (error) {
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new Error("Network error: Unable to connect to File DB service")
      }
      throw error
    }
  }

  /**
   * Logout user
   * @returns {Promise<Object>} Logout result
   */
  async logout() {
    try {
      const response = await fetch(`${this.baseUrl}/auth/logout`, {
        method: "POST",
        headers: this.getAuthHeaders(),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}: ${response.statusText}`)
      }

      // Clear stored token
      this.accessToken = null

      return result
    } catch (error) {
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new Error("Network error: Unable to connect to File DB service")
      }
      throw error
    }
  }

  /**
   * Generate a unique idempotency key
   * @returns {string} UUID-like string
   */
  static generateIdempotencyKey() {
    return "upload-" + Date.now() + "-" + Math.random().toString(36).substr(2, 9)
  }

  /**
   * Upload a file to File DB
   * @param {File} file - The file to upload
   * @param {Object} options - Upload options
   * @param {string} options.idempotencyKey - Optional idempotency key
   * @param {number} options.ttlDays - Time to live in days (default: 7)
   * @returns {Promise<Object>} Upload result with file_id
   */
  async upload(file, options = {}) {
    const validation = FileDB.validateFile(file)
    if (!validation.valid) {
      throw new Error(validation.errors.join(", "))
    }

    const formData = new FormData()
    formData.append("file", file)

    const headers = { ...this.getAuthHeaders() }

    if (options.idempotencyKey) {
      headers["Idempotency-Key"] = options.idempotencyKey
    }

    if (options.ttlDays) {
      headers["BTL-Days"] = options.ttlDays.toString()
    }

    try {
      const response = await fetch(`${this.baseUrl}/files`, {
        method: "POST",
        body: formData,
        headers,
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}: ${response.statusText}`)
      }

      return result
    } catch (error) {
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new Error("Network error: Unable to connect to File DB service")
      }
      throw error
    }
  }

  /**
   * Retrieve a file from File DB
   * @param {string} fileId - The file ID to retrieve
   * @returns {Promise<Blob>} The file as a Blob
   */
  async get(fileId) {
    if (!fileId) {
      throw new Error("File ID is required")
    }

    try {
      const response = await fetch(`${this.baseUrl}/files/${fileId}`, {
        headers: this.getAuthHeaders(),
      })

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("File not found or expired")
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      return await response.blob()
    } catch (error) {
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new Error("Network error: Unable to connect to File DB service")
      }
      throw error
    }
  }

  /**
   * Get file information without downloading
   * @param {string} fileId - The file ID
   * @returns {Promise<Object>} File metadata
   */
  async getInfo(fileId) {
    if (!fileId) {
      throw new Error("File ID is required")
    }

    try {
      const response = await fetch(`${this.baseUrl}/files/${fileId}/info`, {
        headers: this.getAuthHeaders(),
      })

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("File not found or expired")
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new Error("Network error: Unable to connect to File DB service")
      }
      throw error
    }
  }

  /**
   * Download a file and trigger browser download
   * @param {string} fileId - The file ID to download
   * @param {string} filename - Optional filename for download
   */
  async download(fileId, filename = null) {
    try {
      const blob = await this.get(fileId)

      // Get filename from metadata if not provided
      if (!filename) {
        try {
          const info = await this.getInfo(fileId)
          filename = info.original_filename || `file-${fileId}`
        } catch (error) {
          filename = `file-${fileId}`
        }
      }

      // Create download link
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      throw new Error(`Download failed: ${error.message}`)
    }
  }

  /**
   * Get current quota information
   * @returns {Promise<Object>} Quota information
   */
  async getQuota() {
    try {
      const response = await fetch(`${this.baseUrl}/quota`, {
        headers: this.getAuthHeaders(),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new Error("Network error: Unable to connect to File DB service")
      }
      throw error
    }
  }

  /**
   * Get upload status by idempotency key
   * @param {string} idempotencyKey - The idempotency key
   * @returns {Promise<Object>} Upload status
   */
  async getUploadStatus(idempotencyKey) {
    if (!idempotencyKey) {
      throw new Error("Idempotency key is required")
    }

    try {
      const response = await fetch(`${this.baseUrl}/status/${idempotencyKey}`, {
        headers: this.getAuthHeaders(),
      })

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error("Upload session not found")
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      if (error instanceof TypeError && error.message.includes("fetch")) {
        throw new Error("Network error: Unable to connect to File DB service")
      }
      throw error
    }
  }

  /**
   * Format file size in human readable format
   * @param {number} bytes - Size in bytes
   * @returns {string} Formatted size
   */
  formatFileSize(bytes) {
    if (bytes === 0) return "0 Bytes"

    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))

    return parseFloat((bytes / k ** i).toFixed(2)) + " " + sizes[i]
  }

  /**
   * Check if the service is healthy
   * @returns {Promise<Object>} Health status
   */
  async health() {
    try {
      const response = await fetch(`${this.baseUrl}/health`)
      return await response.json()
    } catch (error) {
      throw new Error("Service unavailable")
    }
  }
}

// Export for both CommonJS and ES modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = FileDB
} else if (typeof window !== "undefined") {
  window.FileDB = FileDB
}
