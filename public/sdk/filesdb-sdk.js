/**
 * FilesDB JavaScript SDK
 * A lightweight client for the FilesDB API
 * Version: 1.0.0
 */
class FilesDB {
  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.maxFileSize = 50 * 1024 * 1024; // 50MB
    this.allowedTypes = [
      // Documents
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'text/csv',
      'application/rtf',

      // Archives
      'application/zip',
      'application/x-rar-compressed',
      'application/x-7z-compressed',
      'application/x-tar',
      'application/gzip',

      // Images
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
      'image/bmp',
      'image/tiff',

      // Audio
      'audio/mpeg',
      'audio/wav',
      'audio/ogg',
      'audio/mp4',
      'audio/flac',

      // Video
      'video/mp4',
      'video/mpeg',
      'video/quicktime',
      'video/x-msvideo',
      'video/webm',

      // Code files
      'text/javascript',
      'text/html',
      'text/css',
      'application/json',
      'application/xml',
      'text/x-python',
      'text/x-java-source',
      'text/x-c',
      'text/x-c++',

      // Other
      'application/octet-stream'
    ];
  }

  /**
   * Validate a file before upload
   * @param {File} file - The file to validate
   * @returns {Object} Validation result with valid boolean and errors array
   */
  static validateFile(file) {
    const errors = [];
    const sdk = new FilesDB(); // Create instance to access validation rules

    if (!file) {
      errors.push('No file provided');
      return { valid: false, errors };
    }

    // Check file size
    if (file.size > sdk.maxFileSize) {
      errors.push(`File size exceeds maximum limit of ${sdk.formatFileSize(sdk.maxFileSize)}`);
    }

    // Check file type (if type is detected)
    if (file.type && !sdk.allowedTypes.includes(file.type)) {
      errors.push(`File type "${file.type}" is not supported`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Generate a unique idempotency key
   * @returns {string} UUID-like string
   */
  static generateIdempotencyKey() {
    return 'upload-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Upload a file to FilesDB
   * @param {File} file - The file to upload
   * @param {Object} options - Upload options
   * @param {string} options.idempotencyKey - Optional idempotency key
   * @param {number} options.ttlDays - Time to live in days (default: 7)
   * @returns {Promise<Object>} Upload result with file_id
   */
  async upload(file, options = {}) {
    const validation = FilesDB.validateFile(file);
    if (!validation.valid) {
      throw new Error(validation.errors.join(', '));
    }

    const formData = new FormData();
    formData.append('file', file);

    const headers = {};

    if (options.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    if (options.ttlDays) {
      headers['BTL-Days'] = options.ttlDays.toString();
    }

    try {
      const response = await fetch(`${this.baseUrl}/files`, {
        method: 'POST',
        body: formData,
        headers
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      return result;
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error('Network error: Unable to connect to FilesDB service');
      }
      throw error;
    }
  }

  /**
   * Retrieve a file from FilesDB
   * @param {string} fileId - The file ID to retrieve
   * @returns {Promise<Blob>} The file as a Blob
   */
  async get(fileId) {
    if (!fileId) {
      throw new Error('File ID is required');
    }

    try {
      const response = await fetch(`${this.baseUrl}/files/${fileId}`);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('File not found or expired');
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.blob();
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error('Network error: Unable to connect to FilesDB service');
      }
      throw error;
    }
  }

  /**
   * Get file information without downloading
   * @param {string} fileId - The file ID
   * @returns {Promise<Object>} File metadata
   */
  async getInfo(fileId) {
    if (!fileId) {
      throw new Error('File ID is required');
    }

    try {
      const response = await fetch(`${this.baseUrl}/files/${fileId}/info`);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('File not found or expired');
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error('Network error: Unable to connect to FilesDB service');
      }
      throw error;
    }
  }

  /**
   * Download a file and trigger browser download
   * @param {string} fileId - The file ID to download
   * @param {string} filename - Optional filename for download
   */
  async download(fileId, filename = null) {
    try {
      const blob = await this.get(fileId);

      // Get filename from metadata if not provided
      if (!filename) {
        try {
          const info = await this.getInfo(fileId);
          filename = info.original_filename || `file-${fileId}`;
        } catch (error) {
          filename = `file-${fileId}`;
        }
      }

      // Create download link
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      throw new Error(`Download failed: ${error.message}`);
    }
  }

  /**
   * Get current quota information
   * @returns {Promise<Object>} Quota information
   */
  async getQuota() {
    try {
      const response = await fetch(`${this.baseUrl}/quota`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error('Network error: Unable to connect to FilesDB service');
      }
      throw error;
    }
  }

  /**
   * Get upload status by idempotency key
   * @param {string} idempotencyKey - The idempotency key
   * @returns {Promise<Object>} Upload status
   */
  async getUploadStatus(idempotencyKey) {
    if (!idempotencyKey) {
      throw new Error('Idempotency key is required');
    }

    try {
      const response = await fetch(`${this.baseUrl}/status/${idempotencyKey}`);

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Upload session not found');
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error('Network error: Unable to connect to FilesDB service');
      }
      throw error;
    }
  }

  /**
   * Format file size in human readable format
   * @param {number} bytes - Size in bytes
   * @returns {string} Formatted size
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Check if the service is healthy
   * @returns {Promise<Object>} Health status
   */
  async health() {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return await response.json();
    } catch (error) {
      throw new Error('Service unavailable');
    }
  }
}

// Export for both CommonJS and ES modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = FilesDB;
} else if (typeof window !== 'undefined') {
  window.FilesDB = FilesDB;
}