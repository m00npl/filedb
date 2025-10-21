export interface ChunkEntity {
  id: string;
  file_id: string;
  chunk_index: number;
  data: Buffer;
  original_size?: number; // Size before compression
  compressed_size?: number; // Size after compression
  checksum: string;
  created_at: Date;
  expiration_block: number;
  entity_key?: string; // Arkiv entity key
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
  entity_key?: string; // Arkiv entity key
  owner?: string; // Custom owner annotation
}

export enum UploadStatus {
  UPLOADING = 'uploading',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export interface UploadSession {
  file_id: string;
  idempotency_key: string;
  metadata: FileMetadata;
  chunks_received: Set<number>;
  completed: boolean;
  status: UploadStatus;
  error?: string;
  chunks_uploaded_to_blockchain: number;
  total_chunks: number;
  started_at: Date;
  last_chunk_uploaded_at?: Date;
}

export interface QuotaInfo {
  used_bytes: number;
  max_bytes: number;
  uploads_today: number;
  max_uploads_per_day: number;
}

export const CONFIG = {
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10 MB
  CHUNK_SIZE: parseInt(process.env.CHUNK_SIZE || '32768'), // 32 KB - optimized for blockchain
  DEFAULT_BTL_DAYS: parseInt(process.env.DEFAULT_BTL_DAYS || '7'),
  FREE_TIER_MAX_BYTES: 500 * 1024 * 1024, // 500 MB
  FREE_TIER_MAX_UPLOADS_PER_DAY: 50,
  BLOCKS_PER_DAY: 2880, // Arkiv block timing
  STORAGE_MODE: process.env.STORAGE_MODE || 'memory',
  UNLIMITED_API_KEY: process.env.UNLIMITED_API_KEY,
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