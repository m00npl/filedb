export interface ChunkEntity {
  id: string;
  file_id: string;
  chunk_index: number;
  data: Buffer;
  checksum: string;
  created_at: Date;
  expiration_block: number;
}

export interface FileMetadata {
  file_id: string;
  original_filename: string;
  content_type: string;
  file_extension: string;
  total_size: number;
  chunk_count: number;
  checksum: string;
  created_at: Date;
  expiration_block: number;
  btl_days: number;
}

export interface UploadSession {
  file_id: string;
  idempotency_key: string;
  metadata: FileMetadata;
  chunks_received: Set<number>;
  completed: boolean;
}

export interface QuotaInfo {
  used_bytes: number;
  max_bytes: number;
  uploads_today: number;
  max_uploads_per_day: number;
}

export const CONFIG = {
  MAX_FILE_SIZE: 50 * 1024 * 1024, // 50 MB
  CHUNK_SIZE: 64 * 1024, // 64 KB per chunk
  DEFAULT_BTL_DAYS: 7,
  FREE_TIER_MAX_BYTES: 500 * 1024 * 1024, // 500 MB
  FREE_TIER_MAX_UPLOADS_PER_DAY: 50,
  BLOCKS_PER_DAY: 2880, // Golem DB block timing
  ALLOWED_FILE_TYPES: [
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
  ]
};