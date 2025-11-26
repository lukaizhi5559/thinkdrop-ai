/**
 * Logger utility using Winston for main app
 */

const winston = require('winston');
const path = require('path');

const logLevel = process.env.LOG_LEVEL || 'info';
const debugMode = process.env.DEBUG_MODE === 'true';

const logger = winston.createLogger({
  level: debugMode ? 'debug' : logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'main-app' },
  transports: [
    // Console output
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
          return `${timestamp} [${level}]: ${message} ${metaStr}`;
        })
      ),
      silent: !debugMode // Only show console logs when DEBUG_MODE is true
    })
  ]
});

// Add file transport if logs directory exists
const logsDir = path.join(__dirname, '../../logs');
try {
  const fs = require('fs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
  
  logger.add(new winston.transports.File({
    filename: path.join(logsDir, 'main-error.log'),
    level: 'error'
  }));
  
  logger.add(new winston.transports.File({
    filename: path.join(logsDir, 'main-combined.log')
  }));
} catch (err) {
  // Logs directory not available, continue with console only
}

module.exports = logger;
