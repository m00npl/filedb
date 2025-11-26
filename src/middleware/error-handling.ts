import type { Context, Next } from "hono"

export class FileDBError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public context?: any,
  ) {
    super(message)
    this.name = "FileDBError"
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      ...(this.context && { context: this.context }),
    }
  }
}

// Specific error types
export class ValidationError extends FileDBError {
  constructor(message: string, field?: string) {
    super(message, "VALIDATION_ERROR", 400, field ? { field } : undefined)
  }
}

export class QuotaExceededError extends FileDBError {
  constructor(used: number, limit: number) {
    super(`Quota exceeded: ${used}/${limit} bytes`, "QUOTA_EXCEEDED", 429, { used, limit })
  }
}

export class FileNotFoundError extends FileDBError {
  constructor(fileId: string) {
    super(`File not found: ${fileId}`, "FILE_NOT_FOUND", 404, { fileId })
  }
}

export class UploadError extends FileDBError {
  constructor(message: string, context?: any) {
    super(message, "UPLOAD_ERROR", 500, context)
  }
}

export class BlockchainError extends FileDBError {
  constructor(message: string, operation?: string, attempt?: number) {
    super(`Blockchain operation failed: ${message}`, "BLOCKCHAIN_ERROR", 503, {
      operation,
      attempt,
    })
  }
}

export class AuthenticationError extends FileDBError {
  constructor(message: string = "Authentication required") {
    super(message, "AUTHENTICATION_ERROR", 401)
  }
}

export class AuthorizationError extends FileDBError {
  constructor(message: string = "Access denied") {
    super(message, "AUTHORIZATION_ERROR", 403)
  }
}

export class RateLimitError extends FileDBError {
  constructor(retryAfter?: number) {
    super("Rate limit exceeded", "RATE_LIMIT_ERROR", 429, retryAfter ? { retryAfter } : undefined)
  }
}

// Error sanitization - remove sensitive information
export const sanitizeError = (error: any): any => {
  // Remove sensitive fields that might leak internal information
  const sensitiveFields = [
    "stack",
    "config",
    "request",
    "response",
    "headers",
    "auth",
    "authorization",
    "cookie",
    "password",
    "key",
    "secret",
    "token",
  ]

  if (typeof error === "object" && error !== null) {
    const sanitized = { ...error }

    sensitiveFields.forEach((field) => {
      delete sanitized[field]
    })

    // Recursively sanitize nested objects
    Object.keys(sanitized).forEach((key) => {
      if (typeof sanitized[key] === "object" && sanitized[key] !== null) {
        sanitized[key] = sanitizeError(sanitized[key])
      }
    })

    return sanitized
  }

  return error
}

// Main error handling middleware
export const errorHandlingMiddleware = async (c: Context, next: Next) => {
  try {
    await next()
  } catch (error) {
    console.error("❌ Request error:", error)

    // Handle known error types
    if (error instanceof FileDBError) {
      return c.json(error.toJSON(), error.statusCode as any)
    }

    // Handle validation errors from other libraries
    if (error instanceof Error && error.name === "ValidationError") {
      return c.json(
        {
          error: error.message,
          code: "VALIDATION_ERROR",
        },
        400,
      )
    }

    // Handle quota errors
    if (error instanceof Error && error.message.includes("quota exceeded")) {
      return c.json(
        {
          error: "Quota exceeded",
          code: "QUOTA_EXCEEDED",
        },
        429,
      )
    }

    // Handle timeout errors
    if (
      error instanceof Error &&
      (error.message.includes("timeout") ||
        error.message.includes("ETIMEDOUT") ||
        error.message.includes("Request timed out"))
    ) {
      return c.json(
        {
          error: "Request timeout",
          code: "TIMEOUT_ERROR",
        },
        408,
      )
    }

    // Handle connection errors
    if (
      error instanceof Error &&
      (error.message.includes("ECONNREFUSED") ||
        error.message.includes("ENOTFOUND") ||
        error.message.includes("ECONNRESET"))
    ) {
      return c.json(
        {
          error: "Service temporarily unavailable",
          code: "CONNECTION_ERROR",
        },
        503,
      )
    }

    // Handle file size errors
    if (error instanceof Error && error.message.includes("file too large")) {
      return c.json(
        {
          error: "File size exceeds maximum limit",
          code: "FILE_TOO_LARGE",
        },
        413,
      )
    }

    // Handle blockchain/RPC errors
    if (
      error instanceof Error &&
      (error.message.includes("HttpRequestError") ||
        error.message.includes("TransactionExecutionError") ||
        error.message.includes("RPC") ||
        error.message.includes("blockchain"))
    ) {
      return c.json(
        {
          error: "Blockchain service temporarily unavailable",
          code: "BLOCKCHAIN_ERROR",
        },
        503,
      )
    }

    // Generic error handling - don't expose internal details
    const isDevelopment = process.env.NODE_ENV === "development"

    if (isDevelopment) {
      // In development, provide more details
      return c.json(
        {
          error: "Internal server error",
          code: "INTERNAL_ERROR",
          details: sanitizeError(error),
          message: error instanceof Error ? error.message : "Unknown error",
        },
        500,
      )
    } else {
      // In production, provide minimal information
      return c.json(
        {
          error: "Internal server error",
          code: "INTERNAL_ERROR",
        },
        500,
      )
    }
  }
}

// 404 handler for unmatched routes
export const notFoundHandler = (c: Context) => {
  return c.json(
    {
      error: "Endpoint not found",
      code: "NOT_FOUND",
      path: c.req.path,
      method: c.req.method,
    },
    404,
  )
}

// Request timeout middleware
export const timeoutMiddleware = (timeoutMs: number = 300000) => {
  // 5 minutes default
  return async (c: Context, next: Next) => {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Request timeout after ${timeoutMs}ms`))
      }, timeoutMs)
    })

    try {
      await Promise.race([next(), timeoutPromise])
    } catch (error) {
      if (error instanceof Error && error.message.includes("timeout")) {
        return c.json(
          {
            error: "Request timeout",
            code: "TIMEOUT_ERROR",
          },
          408,
        )
      }
      throw error
    }
  }
}

// Health check error wrapper
export const withHealthCheck = async <T>(
  operation: () => Promise<T>,
  serviceName: string,
): Promise<T> => {
  try {
    return await operation()
  } catch (error) {
    console.error(`❌ Health check failed for ${serviceName}:`, error)
    throw new FileDBError(`Service ${serviceName} is unhealthy`, "HEALTH_CHECK_FAILED", 503, {
      service: serviceName,
    })
  }
}

// Retry wrapper with exponential backoff
export const withRetry = async <T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number
    baseDelay?: number
    maxDelay?: number
    operationName?: string
  } = {},
): Promise<T> => {
  const {
    maxAttempts = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    operationName = "operation",
  } = options

  let lastError: Error | undefined

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error as Error

      if (attempt === maxAttempts) {
        console.error(`❌ ${operationName} failed after ${maxAttempts} attempts:`, error)
        throw new FileDBError(
          `Operation failed after ${maxAttempts} attempts`,
          "RETRY_EXHAUSTED",
          503,
          { operationName, attempts: maxAttempts, lastError: lastError.message },
        )
      }

      const delay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay)
      console.warn(`⚠️ ${operationName} attempt ${attempt} failed, retrying in ${delay}ms:`, error)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  if (lastError) {
    throw lastError
  }
  throw new FileDBError("Operation failed", "RETRY_EXHAUSTED", 503)
}
