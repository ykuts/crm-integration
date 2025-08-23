// Logger Utility - Winston Configuration
import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
  silly: 6
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  verbose: 'white',
  debug: 'cyan',
  silly: 'grey'
};

winston.addColors(colors);

// Determine the environment
const isDevelopment = process.env.NODE_ENV === 'development';
const level = isDevelopment ? 'debug' : 'info';

// Create custom format
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:SSS' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => {
      const { timestamp, level, message, service, ...meta } = info;
      
      // Format the main message
      let logMessage = `${timestamp} [${level}]`;
      
      if (service) {
        logMessage += ` [${service}]`;
      }
      
      logMessage += `: ${message}`;
      
      // Add metadata if present
      if (Object.keys(meta).length > 0) {
        logMessage += ` ${JSON.stringify(meta, null, 0)}`;
      }
      
      return logMessage;
    }
  )
);

// Define which transports to use
const transports = [
  // Console transport for all environments
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize({ all: true }),
      winston.format.printf(
        (info) => {
          const { timestamp, level, message, service, ...meta } = info;
          
          let logMessage = `${timestamp} [${level}]`;
          
          if (service) {
            logMessage += ` [${service}]`;
          }
          
          logMessage += `: ${message}`;
          
          // Add metadata in a more readable format for console
          if (Object.keys(meta).length > 0) {
            const metaString = JSON.stringify(meta, null, 2);
            logMessage += `\n${metaString}`;
          }
          
          return logMessage;
        }
      )
    )
  })
];

// Add file transports for production
if (!isDevelopment) {
  // Ensure logs directory exists
  const logsDir = path.resolve(__dirname, '../../logs');
  
  // Combined log file
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      )
    })
  );
  
  // Error log file
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      )
    })
  );
  
  // HTTP access log file
  transports.push(
    new winston.transports.File({
      filename: path.join(logsDir, 'access.log'),
      level: 'http',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  );
}

// Create the logger
const logger = winston.createLogger({
  level,
  levels,
  format,
  transports,
  // Don't exit on handled exceptions
  exitOnError: false,
  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ],
  // Handle unhandled promise rejections
  rejectionHandlers: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Add file exception handlers for production
if (!isDevelopment) {
  logger.exceptions.handle(
    new winston.transports.File({ 
      filename: path.resolve(__dirname, '../../logs/exceptions.log')
    })
  );
  
  logger.rejections.handle(
    new winston.transports.File({ 
      filename: path.resolve(__dirname, '../../logs/rejections.log')
    })
  );
}

// Create child logger for specific services
export const createServiceLogger = (serviceName) => {
  return logger.child({ service: serviceName });
};

// Export the main logger
export default logger;

// Log startup message
logger.info('Logger initialized', {
  environment: process.env.NODE_ENV || 'development',
  level: level,
  transports: transports.length
});