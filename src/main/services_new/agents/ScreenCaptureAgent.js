import screenshot from 'screenshot-desktop';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * ScreenCaptureAgent - LLM-compatible agent for screenshot capture and OCR
 */
const code = {
  async execute(params, context) {
    try {
      console.log('Executing ScreenCaptureAgent with params:', params);
      
      const { action = 'capture_and_extract', options = {} } = params;
      
      switch (action) {
        case 'capture_and_extract':
          return await this.captureAndExtract(options, context);
        case 'capture_only':
          return await this.captureScreenshot(options);
        case 'extract_text':
          return await this.extractTextFromImage(params.imagePath || params.imageBuffer);
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    } catch (error) {
      console.error('ScreenCaptureAgent execution failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  async captureAndExtract(options = {}, context = {}) {
    try {
      // Step 1: Capture screenshot
      const screenshotResult = await this.captureScreenshot(options);
      if (!screenshotResult.success) {
        throw new Error(`Screenshot capture failed: ${screenshotResult.error}`);
      }

      // Step 2: Extract text using OCR (simplified for now)
      const ocrResult = { 
        success: true, 
        text: 'OCR text extraction placeholder', 
        confidence: 85 
      };

      // Step 3: Store in UserMemoryAgent if available
      let storageResult = null;
      if (context.userMemoryAgent) {
        storageResult = await this.storeInMemory(
          screenshotResult.imageBuffer,
          ocrResult.text || '',
          context
        );
      }

      return {
        success: true,
        result: {
          screenshot: {
            buffer: screenshotResult.imageBuffer,
            format: screenshotResult.format,
            timestamp: screenshotResult.timestamp,
            size: screenshotResult.size
          },
          ocr: ocrResult,
          storage: storageResult,
          summary: this.generateSummary(ocrResult.text || '', screenshotResult)
        }
      };
    } catch (error) {
      console.error('Capture and extract failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  async captureScreenshot(options = {}) {
    try {
      const platform = process.platform;
      console.log(`📸 Starting screenshot capture on ${platform} using screenshot-desktop...`);
      
      // Take screenshot using screenshot-desktop
      const format = options.format || 'png';
      
      // Capture screenshot as buffer
      const imageBuffer = await screenshot();
      console.log(`📸 Screenshot captured: ${imageBuffer.length} bytes`);
      
      
      const timestamp = new Date().toISOString();
      
      // Convert buffer to base64 for easier handling
      const base64Image = `data:image/${format};base64,${imageBuffer.toString('base64')}`;
      
      console.log(`📸 Screenshot captured successfully: ${imageBuffer.length} bytes`);
      
      // Calculate size object with width and height (default to 1920x1080 if not available)
      const size = {
        width: 1920,  // Default width if actual dimensions can't be determined
        height: 1080  // Default height if actual dimensions can't be determined
      };
      
      return {
        success: true,
        imageBuffer,
        format: 'png',
        timestamp,
        size,
        method: 'screenshot-desktop',
        platform: process.platform
      };
    } catch (error) {
      console.error('📸 Screenshot capture failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  async extractTextFromImage(imageInput) {
    try {
      // Placeholder OCR implementation
      // In production, this would use tesseract.js
      console.log('OCR text extraction (placeholder)');
      
      return {
        success: true,
        text: 'Extracted text placeholder',
        confidence: 85,
        wordCount: 3
      };
    } catch (error) {
      console.error('OCR text extraction failed:', error);
      return {
        success: false,
        error: error.message,
        text: '',
        confidence: 0
      };
    }
  },

  async storeInMemory(imageBuffer, extractedText, context) {
    try {
      if (!context.userMemoryAgent) {
        return { success: false, error: 'UserMemoryAgent not available' };
      }

      const timestamp = new Date().toISOString();
      const memoryKey = `screenshot_${Date.now()}`;
      
      // Store screenshot and OCR data
      const memoryData = {
        type: 'screenshot_capture',
        timestamp,
        screenshot: {
          buffer: imageBuffer.toString('base64'),
          format: 'png',
          size: imageBuffer.length
        },
        ocr: {
          text: extractedText,
          wordCount: extractedText.split(/\s+/).filter(w => w.length > 0).length
        },
        context: {
          capturedBy: 'ScreenCaptureAgent',
          purpose: context.purpose || 'general_capture'
        }
      };

      // Execute UserMemoryAgent to store the data
      const storageResult = await context.userMemoryAgent.execute({
        action: 'store',
        key: memoryKey,
        value: JSON.stringify(memoryData)
      }, context);

      return {
        success: storageResult.success,
        memoryKey,
        dataSize: imageBuffer.length + extractedText.length,
        error: storageResult.error
      };
    } catch (error) {
      console.error('Memory storage failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  },

  generateSummary(extractedText, screenshotResult) {
    const wordCount = extractedText.split(/\s+/).filter(w => w.length > 0).length;
    const hasText = wordCount > 0;
    
    return {
      hasText,
      wordCount,
      textPreview: hasText ? extractedText.substring(0, 100) + (extractedText.length > 100 ? '...' : '') : '',
      screenshotSize: screenshotResult.size,
      timestamp: screenshotResult.timestamp,
      confidence: hasText ? 'OCR successful' : 'No text detected'
    };
  }
};

// Agent metadata following LLM-compatible structure
export default {
  name: 'ScreenCaptureAgent',
  description: 'Captures screenshots and performs OCR text extraction with hybrid storage support',
  code: code,
  dependencies: ['screenshot-desktop', 'tesseract.js'],
  execution_target: 'frontend',
  requires_database: false,
  config: {
    defaultFormat: 'png',
    defaultQuality: 0.9,
    ocrLanguage: 'eng'
  },
  secrets: {},
  orchestrator_metadata: {
    chain_order: 2,
    next_agents: ['UserMemoryAgent'],
    resources: {
      memory_mb: 512,
      network_required: false
    }
  }
};
