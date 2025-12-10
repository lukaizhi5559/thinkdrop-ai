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
  
  // Add automation plans log (JSON per line for easy parsing - ONLY plans, no other logs)
  const automationPlansTransport = new winston.transports.File({
    filename: path.join(logsDir, 'automation-plans.log'),
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf(({ timestamp, planId, command, stepCount, provider, fullPlan }) => {
        // Only log if this is an automation plan entry
        if (!fullPlan) return '';
        
        return JSON.stringify({
          timestamp,
          planId,
          command,
          stepCount,
          provider,
          fullPlan
        });
      })
    ),
    level: 'info'
  });
  
  logger.add(automationPlansTransport);
} catch (err) {
  // Logs directory not available, continue with console only
}

/**
 * Log automation plan for debugging
 * @param {Object} plan - Automation plan object
 * @param {string} command - Original command
 */
logger.logAutomationPlan = function(plan, command) {
  this.info('🤖 [AUTOMATION_PLAN]', {
    timestamp: new Date().toISOString(),
    planId: plan.planId,
    command: command,
    stepCount: plan.steps?.length || 0,
    provider: plan.metadata?.provider,
    fullPlan: plan
  });
};

module.exports = logger;
