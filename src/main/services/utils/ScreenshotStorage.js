const logger = require('./../../logger.cjs');
import { promises as fs } from 'fs';
import path from 'path';
import { app } from 'electron';
import crypto from 'crypto';

/**
 * Manages screenshot storage on disk for efficient binary data handling
 */
export class ScreenshotStorage {
  constructor() {
    // Store screenshots in user data directory
    this.storageDir = path.join(app.getPath('userData'), 'screenshots');
    this.ensureStorageDir();
  }

  async ensureStorageDir() {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
    } catch (error) {
      logger.error('Failed to create screenshot storage directory:', error);
    }
  }

  /**
   * Save screenshot buffer to disk and return the file path
   * @param {Buffer} buffer - Screenshot buffer
   * @param {string} memoryId - Associated memory ID
   * @returns {Promise<string>} File path relative to storage directory
   */
  async saveScreenshot(buffer, memoryId) {
    try {
      // Generate unique filename with memory ID and timestamp
      const timestamp = Date.now();
      const hash = crypto.createHash('md5').update(buffer).digest('hex').substring(0, 8);
      const filename = `${memoryId}_${timestamp}_${hash}.png`;
      const filepath = path.join(this.storageDir, filename);
      
      // Write buffer to disk
      await fs.writeFile(filepath, buffer);
      
      // Return relative filename for DB storage
      return filename;
    } catch (error) {
      logger.error('Failed to save screenshot:', error);
      throw error;
    }
  }

  /**
   * Load screenshot buffer from disk
   * @param {string} filename - Filename stored in DB
   * @returns {Promise<Buffer>} Screenshot buffer
   */
  async loadScreenshot(filename) {
    try {
      const filepath = path.join(this.storageDir, filename);
      return await fs.readFile(filepath);
    } catch (error) {
      logger.error('Failed to load screenshot:', error);
      return null;
    }
  }

  /**
   * Delete screenshot from disk
   * @param {string} filename - Filename to delete
   */
  async deleteScreenshot(filename) {
    try {
      const filepath = path.join(this.storageDir, filename);
      await fs.unlink(filepath);
    } catch (error) {
      logger.error('Failed to delete screenshot:', error);
    }
  }

  /**
   * Get screenshot as data URL for display
   * @param {string} filename - Filename stored in DB
   * @returns {Promise<string>} Data URL or null
   */
  async getScreenshotDataUrl(filename) {
    try {
      const buffer = await this.loadScreenshot(filename);
      if (!buffer) return null;
      
      // Convert to base64 data URL for display
      const base64 = buffer.toString('base64');
      return `data:image/png;base64,${base64}`;
    } catch (error) {
      logger.error('Failed to get screenshot data URL:', error);
      return null;
    }
  }

  /**
   * Clean up old screenshots (optional maintenance)
   * @param {number} daysToKeep - Number of days to keep screenshots
   */
  async cleanupOldScreenshots(daysToKeep = 30) {
    try {
      const files = await fs.readdir(this.storageDir);
      const now = Date.now();
      const maxAge = daysToKeep * 24 * 60 * 60 * 1000;
      
      for (const file of files) {
        const filepath = path.join(this.storageDir, file);
        const stats = await fs.stat(filepath);
        
        if (now - stats.mtimeMs > maxAge) {
          await fs.unlink(filepath);
          logger.debug(`Cleaned up old screenshot: ${file}`);
        }
      }
    } catch (error) {
      logger.error('Failed to cleanup screenshots:', error);
    }
  }
}

// Export singleton instance
export const screenshotStorage = new ScreenshotStorage();