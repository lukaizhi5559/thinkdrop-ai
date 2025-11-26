/**
 * IPC handlers for database notifications
 * Provides real-time database health and status updates to the UI
 */

const { ipcMain } = require('electron');

const logger = require('./../logger.cjs');
let DatabaseManager = null;

/**
 * Setup database notification IPC handlers
 * @returns {Promise<void>}
 */
async function setupDatabaseNotificationHandlers() {
  logger.debug('🔔 Setting up database notification IPC handlers...');
  
  // Dynamic import of ES module
  if (!DatabaseManager) {
    const module = await import('../services/utils/DatabaseManager.js');
    DatabaseManager = module.default;
  }

  // Register notification callback with DatabaseManager
  DatabaseManager.addNotificationCallback((notification) => {
    // Send notification to all renderer processes
    const allWindows = require('electron').BrowserWindow.getAllWindows();
    allWindows.forEach(window => {
      if (!window.isDestroyed()) {
        window.webContents.send('database-notification', notification);
      }
    });
  });

  // Get current database metrics
  ipcMain.handle('get-database-metrics', async () => {
    try {
      const metrics = DatabaseManager.getMetrics();
      return {
        success: true,
        metrics
      };
    } catch (error) {
      logger.error('❌ Failed to get database metrics:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // Trigger manual backup
  ipcMain.handle('create-database-backup', async () => {
    try {
      const result = await DatabaseManager.createBackup();
      return {
        success: result.success,
        ...result
      };
    } catch (error) {
      logger.error('❌ Failed to create database backup:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // Get database health status
  ipcMain.handle('get-database-health', async () => {
    try {
      const health = await DatabaseManager.performHealthCheck();
      return {
        success: true,
        health
      };
    } catch (error) {
      logger.error('❌ Failed to get database health:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // Force WAL checkpoint
  ipcMain.handle('force-wal-checkpoint', async () => {
    try {
      const result = await DatabaseManager.performWALCheckpoint();
      return {
        success: result.success,
        ...result
      };
    } catch (error) {
      logger.error('❌ Failed to force WAL checkpoint:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  logger.debug('✅ Database notification IPC handlers setup complete');
}

module.exports = {
  setupDatabaseNotificationHandlers
};
