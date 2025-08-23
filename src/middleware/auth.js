// Authentication Middleware
import jwt from 'jsonwebtoken';
import logger from '../utils/logger.js';

/**
 * Authentication middleware for API routes
 * Supports both JWT tokens and API keys
 */
export const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const apiKey = req.headers['x-api-key'];

  // Skip auth for health checks
  if (req.path === '/health' || req.path === '/') {
    return next();
  }

  // Method 1: API Key authentication (for bot integration)
  if (apiKey) {
    return validateApiKey(apiKey, req, res, next);
  }

  // Method 2: JWT Token authentication (for admin/web interface)
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    return validateJWT(token, req, res, next);
  }

  // No authentication provided
  logger.warn('Authentication failed - no credentials provided', {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    path: req.path,
    method: req.method
  });

  return res.status(401).json({
    success: false,
    error: 'Authentication required',
    code: 'NO_AUTH_PROVIDED'
  });
};

/**
 * Validate API Key
 */
const validateApiKey = (apiKey, req, res, next) => {
  const validApiKey = process.env.CRM_API_KEY;

  if (!validApiKey) {
    logger.error('CRM_API_KEY not configured in environment');
    return res.status(500).json({
      success: false,
      error: 'Server configuration error',
      code: 'API_KEY_NOT_CONFIGURED'
    });
  }

  if (apiKey !== validApiKey) {
    logger.warn('Invalid API key attempt', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      path: req.path,
      providedKey: apiKey.substring(0, 8) + '...'
    });

    return res.status(401).json({
      success: false,
      error: 'Invalid API key',
      code: 'INVALID_API_KEY'
    });
  }

  // API key is valid
  req.user = {
    type: 'api_key',
    authenticated: true,
    permissions: ['bot_operations']
  };

  logger.info('API key authentication successful', {
    ip: req.ip,
    path: req.path
  });

  next();
};

/**
 * Validate JWT Token
 */
const validateJWT = (token, req, res, next) => {
  const jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    logger.error('JWT_SECRET not configured in environment');
    return res.status(500).json({
      success: false,
      error: 'Server configuration error',
      code: 'JWT_SECRET_NOT_CONFIGURED'
    });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    
    // Check if token is expired
    if (decoded.exp && decoded.exp < Date.now() / 1000) {
      logger.warn('Expired JWT token attempt', {
        ip: req.ip,
        userId: decoded.userId,
        exp: decoded.exp
      });

      return res.status(401).json({
        success: false,
        error: 'Token expired',
        code: 'TOKEN_EXPIRED'
      });
    }

    // Token is valid
    req.user = {
      type: 'jwt',
      authenticated: true,
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role || 'user',
      permissions: decoded.permissions || ['read'],
      exp: decoded.exp,
      iat: decoded.iat
    };

    logger.info('JWT authentication successful', {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      ip: req.ip,
      path: req.path
    });

    next();

  } catch (error) {
    logger.warn('Invalid JWT token attempt', {
      ip: req.ip,
      error: error.message,
      path: req.path
    });

    let errorMessage = 'Invalid token';
    let errorCode = 'INVALID_TOKEN';

    if (error.name === 'JsonWebTokenError') {
      errorMessage = 'Malformed token';
      errorCode = 'MALFORMED_TOKEN';
    } else if (error.name === 'TokenExpiredError') {
      errorMessage = 'Token expired';
      errorCode = 'TOKEN_EXPIRED';
    }

    return res.status(401).json({
      success: false,
      error: errorMessage,
      code: errorCode
    });
  }
};

/**
 * Role-based authorization middleware
 * Use after authMiddleware
 */
export const requireRole = (requiredRoles) => {
  return (req, res, next) => {
    if (!req.user || !req.user.authenticated) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'NOT_AUTHENTICATED'
      });
    }

    // API key users have limited permissions
    if (req.user.type === 'api_key') {
      const hasPermission = req.user.permissions.some(permission => 
        requiredRoles.includes(permission)
      );

      if (!hasPermission) {
        logger.warn('API key insufficient permissions', {
          ip: req.ip,
          path: req.path,
          requiredRoles,
          userPermissions: req.user.permissions
        });

        return res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
          code: 'INSUFFICIENT_PERMISSIONS'
        });
      }

      return next();
    }

    // JWT users - check role
    if (req.user.type === 'jwt') {
      const userRole = req.user.role;
      
      if (!requiredRoles.includes(userRole)) {
        logger.warn('JWT user insufficient role', {
          userId: req.user.userId,
          userRole,
          requiredRoles,
          ip: req.ip,
          path: req.path
        });

        return res.status(403).json({
          success: false,
          error: 'Insufficient privileges',
          code: 'INSUFFICIENT_ROLE'
        });
      }

      return next();
    }

    // Unknown user type
    return res.status(401).json({
      success: false,
      error: 'Invalid authentication type',
      code: 'INVALID_AUTH_TYPE'
    });
  };
};

/**
 * Permission-based authorization middleware
 * Use after authMiddleware
 */
export const requirePermission = (requiredPermissions) => {
  return (req, res, next) => {
    if (!req.user || !req.user.authenticated) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        code: 'NOT_AUTHENTICATED'
      });
    }

    const userPermissions = req.user.permissions || [];
    const hasPermission = requiredPermissions.some(permission => 
      userPermissions.includes(permission)
    );

    if (!hasPermission) {
      logger.warn('User insufficient permissions', {
        userId: req.user.userId || 'api_key',
        userPermissions,
        requiredPermissions,
        ip: req.ip,
        path: req.path
      });

      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    next();
  };
};