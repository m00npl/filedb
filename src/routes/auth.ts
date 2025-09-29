import { Hono } from 'hono';
import { createUserToken, authService, ROLE_PERMISSIONS, jwtAuthMiddleware } from '../middleware/auth';
import { AuthenticationError, ValidationError } from '../middleware/error-handling';
import { sanitizeOwner } from '../middleware/validation';

const auth = new Hono();

// User registration endpoint
auth.post('/register', async (c) => {
  try {
    const body = await c.req.json();
    const { email, password, role = 'user' } = body;

    if (!email || !password) {
      throw new ValidationError('Email and password are required');
    }

    if (!email.includes('@') || password.length < 8) {
      throw new ValidationError('Invalid email format or password too short (min 8 characters)');
    }

    if (!['user', 'admin'].includes(role)) {
      throw new ValidationError('Invalid role');
    }

    // Generate user ID (in production, this would check database for existing users)
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const sanitizedEmail = sanitizeOwner(email);

    // Create tokens
    const tokens = createUserToken(userId, sanitizedEmail, role as 'user' | 'admin');

    return c.json({
      message: 'User registered successfully',
      user: {
        userId,
        email: sanitizedEmail,
        role,
        permissions: ROLE_PERMISSIONS[role as 'user' | 'admin']
      },
      ...tokens
    }, 201);

  } catch (error) {
    if (error instanceof ValidationError || error instanceof AuthenticationError) {
      return c.json(error.toJSON(), error.statusCode);
    }

    console.error('❌ Registration error:', error);
    return c.json({
      error: 'Registration failed',
      code: 'REGISTRATION_ERROR'
    }, 500);
  }
});

// User login endpoint
auth.post('/login', async (c) => {
  try {
    const body = await c.req.json();
    const { email, password } = body;

    if (!email || !password) {
      throw new ValidationError('Email and password are required');
    }

    // In production, this would verify against database
    // For demo purposes, we'll accept any valid format
    if (!email.includes('@') || password.length < 8) {
      throw new AuthenticationError('Invalid credentials');
    }

    const sanitizedEmail = sanitizeOwner(email);
    const userId = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const role = email.includes('admin') ? 'admin' : 'user';

    // Create tokens
    const tokens = createUserToken(userId, sanitizedEmail, role);

    return c.json({
      message: 'Login successful',
      user: {
        userId,
        email: sanitizedEmail,
        role,
        permissions: ROLE_PERMISSIONS[role]
      },
      ...tokens
    });

  } catch (error) {
    if (error instanceof ValidationError || error instanceof AuthenticationError) {
      return c.json(error.toJSON(), error.statusCode);
    }

    console.error('❌ Login error:', error);
    return c.json({
      error: 'Login failed',
      code: 'LOGIN_ERROR'
    }, 500);
  }
});

// Token refresh endpoint
auth.post('/refresh', async (c) => {
  try {
    const body = await c.req.json();
    const { refreshToken } = body;

    if (!refreshToken) {
      throw new ValidationError('Refresh token is required');
    }

    // In production, you'd get user permissions from database
    const userPermissions = ROLE_PERMISSIONS.user;
    const userRole = 'user';

    const newAccessToken = authService.refreshAccessToken(
      refreshToken,
      userPermissions,
      userRole
    );

    return c.json({
      accessToken: newAccessToken,
      tokenType: 'Bearer',
      expiresIn: process.env.JWT_EXPIRES_IN || '24h'
    });

  } catch (error) {
    if (error instanceof ValidationError || error instanceof AuthenticationError) {
      return c.json(error.toJSON(), error.statusCode);
    }

    console.error('❌ Token refresh error:', error);
    return c.json({
      error: 'Token refresh failed',
      code: 'REFRESH_ERROR'
    }, 401);
  }
});

// Get current user info
auth.get('/me', jwtAuthMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const userPermissions = c.get('userPermissions');

    if (!user) {
      throw new AuthenticationError('Authentication required');
    }

    return c.json({
      user: {
        userId: user.userId,
        email: user.email,
        role: user.role,
        permissions: userPermissions
      }
    });

  } catch (error) {
    if (error instanceof AuthenticationError) {
      return c.json(error.toJSON(), error.statusCode);
    }

    console.error('❌ Get user info error:', error);
    return c.json({
      error: 'Failed to get user info',
      code: 'USER_INFO_ERROR'
    }, 500);
  }
});

// Logout endpoint (invalidate token - in production would blacklist the token)
auth.post('/logout', async (c) => {
  try {
    // In production, you'd add the token to a blacklist/Redis
    return c.json({
      message: 'Logout successful'
    });

  } catch (error) {
    console.error('❌ Logout error:', error);
    return c.json({
      error: 'Logout failed',
      code: 'LOGOUT_ERROR'
    }, 500);
  }
});

export default auth;