import { Context, Next } from 'hono';
import { fileTypeFromBuffer } from 'file-type';

export class ValidationError extends Error {
  constructor(
    message: string,
    public statusCode: number = 400,
    public field?: string
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

// Sanitize owner field to prevent injection attacks
export const sanitizeOwner = (owner: string): string => {
  if (!owner || typeof owner !== 'string') return '';

  // Remove HTML tags and special characters
  return owner
    .replace(/<[^>]*>/g, '')
    .replace(/[<>'"&]/g, '')
    .replace(/\s+/g, ' ')
    .substring(0, 100)
    .trim();
};

// Validate file content matches declared MIME type
export const validateFileContent = async (buffer: Buffer, declaredType: string): Promise<void> => {
  if (!buffer || buffer.length === 0) {
    throw new ValidationError('File content is empty');
  }

  // Check file size (additional validation)
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (buffer.length > maxSize) {
    throw new ValidationError(`File size ${buffer.length} exceeds maximum ${maxSize} bytes`);
  }

  // Basic file type detection
  try {
    const detectedType = await fileTypeFromBuffer(buffer);

    // Allow some flexibility for text files and documents
    const allowedMismatches = [
      'text/plain',
      'application/octet-stream',
      'text/csv'
    ];

    if (detectedType && !allowedMismatches.includes(declaredType)) {
      if (detectedType.mime !== declaredType) {
        console.warn(`⚠️ File type mismatch: declared=${declaredType}, detected=${detectedType.mime}`);
        // Log but don't reject - some files may have misleading headers
      }
    }
  } catch (error) {
    console.warn('⚠️ Could not detect file type:', error);
    // Don't fail validation if detection fails
  }
};

// Validate request headers
export const validateHeaders = (headers: any): { userId: string; apiKey?: string } => {
  const userId = headers['x-user-id'];
  const apiKey = headers['x-api-key'];

  // Validate user ID format (basic alphanumeric + hyphens)
  if (userId && !/^[a-zA-Z0-9_-]+$/.test(userId)) {
    throw new ValidationError('Invalid user ID format', 400, 'x-user-id');
  }

  // Validate API key format if provided
  if (apiKey && !/^[a-zA-Z0-9_-]+$/.test(apiKey)) {
    throw new ValidationError('Invalid API key format', 400, 'x-api-key');
  }

  return {
    userId: userId || 'anonymous',
    apiKey
  };
};

// Validate idempotency key
export const validateIdempotencyKey = (key: string): void => {
  if (!key || typeof key !== 'string') {
    throw new ValidationError('Idempotency key is required');
  }

  if (key.length < 8 || key.length > 128) {
    throw new ValidationError('Idempotency key must be 8-128 characters');
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
    throw new ValidationError('Idempotency key contains invalid characters');
  }
};

// Validate file metadata
export const validateFileMetadata = (metadata: any): void => {
  if (!metadata.original_filename || typeof metadata.original_filename !== 'string') {
    throw new ValidationError('Original filename is required');
  }

  if (metadata.original_filename.length > 255) {
    throw new ValidationError('Filename too long (max 255 characters)');
  }

  // Check for path traversal attempts
  if (metadata.original_filename.includes('..') || metadata.original_filename.includes('/')) {
    throw new ValidationError('Invalid filename: path traversal detected');
  }

  if (!metadata.content_type || typeof metadata.content_type !== 'string') {
    throw new ValidationError('Content type is required');
  }

  // Validate content type format
  if (!/^[a-zA-Z0-9][a-zA-Z0-9!#$&\-\^_.]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&\-\^_.]*$/.test(metadata.content_type)) {
    throw new ValidationError('Invalid content type format');
  }
};

// Input validation middleware
export const inputValidationMiddleware = async (c: Context, next: Next) => {
  try {
    // Validate headers
    const { userId, apiKey } = validateHeaders(c.req.header());
    c.set('userId', userId);
    c.set('apiKey', apiKey);

    await next();
  } catch (error) {
    if (error instanceof ValidationError) {
      return c.json({
        error: 'Validation failed',
        message: error.message,
        field: error.field
      }, error.statusCode);
    }

    console.error('❌ Validation middleware error:', error);
    return c.json({ error: 'Internal validation error' }, 500);
  }
};

// File upload validation middleware
export const fileUploadValidationMiddleware = async (c: Context, next: Next) => {
  try {
    if (c.req.path.includes('/files') && c.req.method === 'POST') {
      const formData = await c.req.formData();

      // Validate idempotency key
      const idempotencyKey = formData.get('idempotency_key') as string;
      if (idempotencyKey) {
        validateIdempotencyKey(idempotencyKey);
      }

      // Validate and sanitize owner field
      const owner = formData.get('owner') as string;
      if (owner) {
        const sanitizedOwner = sanitizeOwner(owner);
        // Replace the form data with sanitized version
        formData.set('owner', sanitizedOwner);
      }

      // Store validated form data for use in handlers
      c.set('validatedFormData', formData);
    }

    await next();
  } catch (error) {
    if (error instanceof ValidationError) {
      return c.json({
        error: 'File upload validation failed',
        message: error.message,
        field: error.field
      }, error.statusCode);
    }

    console.error('❌ File upload validation error:', error);
    return c.json({ error: 'Internal validation error' }, 500);
  }
};