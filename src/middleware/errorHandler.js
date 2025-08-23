// Error Handler Middleware
import logger from '../utils/logger.js';

/**
 * Global error handling middleware
 * Must be the last middleware in the application
 */
export const errorHandler = (error, req, res, next) => {
  // Log the error
  logger.error('Unhandled error occurred', {
    error: error.message,
    stack: error.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.userId,
    timestamp: new Date().toISOString()
  });

  // Default error response
  let status = 500;
  let message = 'Internal server error';
  let code = 'INTERNAL_ERROR';
  let details = null;

  // Handle different types of errors
  if (error.name === 'ValidationError') {
    status = 400;
    message = 'Validation error';
    code = 'VALIDATION_ERROR';
    details = error.details || error.message;
  } else if (error.name === 'CastError') {
    status = 400;
    message = 'Invalid data format';
    code = 'INVALID_FORMAT';
  } else if (error.code === 11000) {
    // MongoDB duplicate key error
    status = 409;
    message = 'Duplicate entry';
    code = 'DUPLICATE_ENTRY';
  } else if (error.name === 'JsonWebTokenError') {
    status = 401;
    message = 'Invalid authentication token';
    code = 'INVALID_TOKEN';
  } else if (error.name === 'TokenExpiredError') {
    status = 401;
    message = 'Authentication token expired';
    code = 'TOKEN_EXPIRED';
  } else if (error.name === 'UnauthorizedError') {
    status = 401;
    message = 'Unauthorized access';
    code = 'UNAUTHORIZED';
  } else if (error.name === 'ForbiddenError') {
    status = 403;
    message = 'Access forbidden';
    code = 'FORBIDDEN';
  } else if (error.name === 'NotFoundError') {
    status = 404;
    message = 'Resource not found';
    code = 'NOT_FOUND';
  } else if (error.name === 'TimeoutError') {
    status = 408;
    message = 'Request timeout';
    code = 'TIMEOUT';
  } else if (error.name === 'TooManyRequestsError') {
    status = 429;
    message = 'Too many requests';
    code = 'RATE_LIMIT_EXCEEDED';
  } else if (error.status) {
    // Error with explicit status
    status = error.status;
    message = error.message || message;
    code = error.code || code;
  }

  // Database connection errors
  if (error.message && error.message.includes('ECONNREFUSED')) {
    status = 503;
    message = 'Database connection failed';
    code = 'DATABASE_CONNECTION_ERROR';
  } else if (error.message && error.message.includes('ETIMEDOUT')) {
    status = 503;
    message = 'Database timeout';
    code = 'DATABASE_TIMEOUT';
  }

  // SendPulse API errors
  if (error.message && error.message.includes('SendPulse')) {
    status = 502;
    message = 'CRM service error';
    code = 'CRM_SERVICE_ERROR';
    details = process.env.NODE_ENV === 'development' ? error.message : null;
  }

  // Prisma errors
  if (error.constructor.name === 'PrismaClientKnownRequestError') {
    switch (error.code) {
      case 'P2000':
        status = 400;
        message = 'Value too long for field';
        code = 'VALUE_TOO_LONG';
        break;
      case 'P2001':
        status = 404;
        message = 'Record not found';
        code = 'RECORD_NOT_FOUND';
        break;
      case 'P2002':
        status = 409;
        message = 'Unique constraint violation';
        code = 'UNIQUE_CONSTRAINT';
        break;
      case 'P2003':
        status = 400;
        message = 'Foreign key constraint violation';
        code = 'FOREIGN_KEY_CONSTRAINT';
        break;
      case 'P2025':
        status = 404;
        message = 'Record not found';
        code = 'RECORD_NOT_FOUND';
        break;
      default:
        status = 500;
        message = 'Database error';
        code = 'DATABASE_ERROR';
    }
  } else if (error.constructor.name === 'PrismaClientValidationError') {
    status = 400;
    message = 'Invalid data provided';
    code = 'INVALID_DATA';
  } else if (error.constructor.name === 'PrismaClientInitializationError') {
    status = 503;
    message = 'Database connection failed';
    code = 'DATABASE_CONNECTION_ERROR';
  }

  // Build error response
  const errorResponse = {
    success: false,
    error: message,
    code,
    timestamp: new Date().toISOString(),
    requestId: req.id || req.headers['x-request-id'] || 'unknown'
  };

  // Add details in development mode or for validation errors
  if ((process.env.NODE_ENV === 'development' || status === 400) && details) {
    errorResponse.details = details;
  }

  // Add stack trace in development mode
  if (process.env.NODE_ENV === 'development') {
    errorResponse.stack = error.stack;
  }

  // Send error response
  res.status(status).json(errorResponse);
};

/**
 * 404 Not Found handler
 */
export const notFoundHandler = (req, res) => {
  logger.warn('404 Not Found', {
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    code: 'ENDPOINT_NOT_FOUND',
    message: `Cannot ${req.method} ${req.originalUrl}`,
    timestamp: new Date().toISOString()
  });
};

/**
 * Async wrapper for route handlers
 * Automatically catches and forwards errors to error handler
 */
export const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Create custom error classes
 */
export class AppError extends Error {
  constructor(message, statusCode = 500, code = 'APP_ERROR') {
    super(message);
    this.name = 'AppError';
    this.status = statusCode;
    this.code = code;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message, details = null) {
    super(message, 400, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
    this.details = details;
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized access') {
    super(message, 401, 'UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access forbidden') {
    super(message, 403, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict occurred') {
    super(message, 409, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable') {
    super(message, 503, 'SERVICE_UNAVAILABLE');
    this.name = 'ServiceUnavailableError';
  }
}