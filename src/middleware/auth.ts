import { Context, Next } from 'hono';
import jwt from 'jsonwebtoken';
import { AuthenticationError, AuthorizationError } from './error-handling';

export interface JWTPayload {
  userId: string;
  email?: string;
  role: 'user' | 'admin';
  permissions: string[];
  iat: number;
  exp: number;
}

export interface AuthConfig {
  jwtSecret: string;
  jwtExpiresIn: string;
  refreshTokenExpiresIn: string;
  issuer: string;
  audience: string;
}

export class AuthService {
  private config: AuthConfig;

  constructor() {
    this.config = {
      jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
      jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
      refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
      issuer: process.env.JWT_ISSUER || 'file-db',
      audience: process.env.JWT_AUDIENCE || 'file-db-users'
    };

    if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || this.config.jwtSecret === 'dev-secret-change-in-production')) {
      throw new Error('JWT_SECRET must be set in production environment');
    }
  }

  generateAccessToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
    return jwt.sign(payload, this.config.jwtSecret, {
      expiresIn: this.config.jwtExpiresIn,
      issuer: this.config.issuer,
      audience: this.config.audience
    });
  }

  generateRefreshToken(userId: string): string {
    return jwt.sign(
      { userId, type: 'refresh' },
      this.config.jwtSecret,
      {
        expiresIn: this.config.refreshTokenExpiresIn,
        issuer: this.config.issuer,
        audience: this.config.audience
      }
    );
  }

  verifyAccessToken(token: string): JWTPayload {
    try {
      const payload = jwt.verify(token, this.config.jwtSecret, {
        issuer: this.config.issuer,
        audience: this.config.audience
      }) as JWTPayload;

      return payload;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new AuthenticationError('Token expired');
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new AuthenticationError('Invalid token');
      }
      throw new AuthenticationError('Token verification failed');
    }
  }

  verifyRefreshToken(token: string): { userId: string; type: string } {
    try {
      const payload = jwt.verify(token, this.config.jwtSecret, {
        issuer: this.config.issuer,
        audience: this.config.audience
      }) as any;

      if (payload.type !== 'refresh') {
        throw new AuthenticationError('Invalid refresh token');
      }

      return payload;
    } catch (error) {
      throw new AuthenticationError('Invalid refresh token');
    }
  }

  refreshAccessToken(refreshToken: string, userPermissions: string[], userRole: 'user' | 'admin' = 'user'): string {
    const payload = this.verifyRefreshToken(refreshToken);

    return this.generateAccessToken({
      userId: payload.userId,
      role: userRole,
      permissions: userPermissions
    });
  }
}

// Default permissions for different roles
export const PERMISSIONS = {
  UPLOAD_FILES: 'upload:files',
  DOWNLOAD_FILES: 'download:files',
  DELETE_FILES: 'delete:files',
  LIST_FILES: 'list:files',
  VIEW_QUOTA: 'quota:view',
  ADMIN_ACCESS: 'admin:access',
  MANAGE_USERS: 'admin:users'
} as const;

export const ROLE_PERMISSIONS = {
  user: [
    PERMISSIONS.UPLOAD_FILES,
    PERMISSIONS.DOWNLOAD_FILES,
    PERMISSIONS.LIST_FILES,
    PERMISSIONS.VIEW_QUOTA
  ],
  admin: [
    PERMISSIONS.UPLOAD_FILES,
    PERMISSIONS.DOWNLOAD_FILES,
    PERMISSIONS.DELETE_FILES,
    PERMISSIONS.LIST_FILES,
    PERMISSIONS.VIEW_QUOTA,
    PERMISSIONS.ADMIN_ACCESS,
    PERMISSIONS.MANAGE_USERS
  ]
} as const;

// Initialize auth service
const authService = new AuthService();

// JWT Authentication middleware
export const jwtAuthMiddleware = async (c: Context, next: Next) => {
  try {
    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
      throw new AuthenticationError('Authorization header required');
    }

    const token = authHeader.replace('Bearer ', '');
    if (!token || token === authHeader) {
      throw new AuthenticationError('Bearer token required');
    }

    const payload = authService.verifyAccessToken(token);

    // Set user context
    c.set('user', payload);
    c.set('userId', payload.userId);
    c.set('userRole', payload.role);
    c.set('userPermissions', payload.permissions);

    await next();
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return c.json(error.toJSON(), error.statusCode);
    }

    console.error('❌ JWT Auth middleware error:', error);
    return c.json({
      error: 'Authentication failed',
      code: 'AUTH_ERROR'
    }, 401);
  }
};

// Optional JWT middleware (allows unauthenticated access)
export const optionalJwtAuthMiddleware = async (c: Context, next: Next) => {
  try {
    const authHeader = c.req.header('Authorization');

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      const payload = authService.verifyAccessToken(token);

      c.set('user', payload);
      c.set('userId', payload.userId);
      c.set('userRole', payload.role);
      c.set('userPermissions', payload.permissions);
    } else {
      // Anonymous user
      c.set('userId', 'anonymous');
      c.set('userRole', 'user');
      c.set('userPermissions', []);
    }

    await next();
  } catch (error) {
    // If token is invalid, treat as anonymous
    c.set('userId', 'anonymous');
    c.set('userRole', 'user');
    c.set('userPermissions', []);

    await next();
  }
};

// Permission check middleware
export const requirePermission = (permission: string) => {
  return async (c: Context, next: Next) => {
    const userPermissions = c.get('userPermissions') as string[];
    const userRole = c.get('userRole') as string;

    if (!userPermissions || !userPermissions.includes(permission)) {
      // Check if admin has blanket access
      if (userRole === 'admin' && userPermissions.includes(PERMISSIONS.ADMIN_ACCESS)) {
        await next();
        return;
      }

      throw new AuthorizationError(`Permission required: ${permission}`);
    }

    await next();
  };
};

// Role check middleware
export const requireRole = (role: 'user' | 'admin') => {
  return async (c: Context, next: Next) => {
    const userRole = c.get('userRole') as string;

    if (userRole !== role && !(role === 'user' && userRole === 'admin')) {
      throw new AuthorizationError(`Role required: ${role}`);
    }

    await next();
  };
};

// API Key fallback middleware (for backward compatibility)
export const apiKeyFallbackMiddleware = async (c: Context, next: Next) => {
  try {
    // Check if already authenticated via JWT
    const user = c.get('user');
    if (user) {
      await next();
      return;
    }

    // Check for API key
    const apiKey = c.req.header('X-API-Key');
    const unlimitedKey = process.env.UNLIMITED_API_KEY;

    if (apiKey && unlimitedKey && apiKey === unlimitedKey) {
      // Set admin context for unlimited API key
      c.set('userId', 'api-admin');
      c.set('userRole', 'admin');
      c.set('userPermissions', ROLE_PERMISSIONS.admin);
      c.set('user', {
        userId: 'api-admin',
        role: 'admin',
        permissions: ROLE_PERMISSIONS.admin
      });
    }

    await next();
  } catch (error) {
    console.error('❌ API Key fallback error:', error);
    await next();
  }
};

// User registration/login helpers
export const createUserToken = (userId: string, email?: string, role: 'user' | 'admin' = 'user') => {
  const permissions = ROLE_PERMISSIONS[role];

  const accessToken = authService.generateAccessToken({
    userId,
    email,
    role,
    permissions
  });

  const refreshToken = authService.generateRefreshToken(userId);

  return {
    accessToken,
    refreshToken,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    tokenType: 'Bearer'
  };
};

export { authService };