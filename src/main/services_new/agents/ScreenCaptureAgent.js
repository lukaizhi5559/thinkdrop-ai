/**
 * ScreenCaptureAgent - LLM-compatible agent for screenshot capture and OCR
 */
const code = {
  async execute(params, context) {
    try {
      console.log('Executing ScreenCaptureAgent with params:', params);
      
      const { action = 'capture_and_extract', options = {} } = params;
      
      // Import required modules dynamically
      const { desktopCapturer } = await import('electron');
      const fs = await import('fs/promises');
      const path = await import('path');
      
      switch (action) {
        case 'capture_and_extract':
          return await this.captureAndExtract(options, context, { desktopCapturer, fs, path });
        case 'capture_only':
          return await this.captureScreenshot(options, { desktopCapturer });
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

  async captureAndExtract(options = {}, context = {}, modules) {
    try {
      const { desktopCapturer } = modules;
      
      // Step 1: Capture screenshot
      const screenshotResult = await this.captureScreenshot(options, { desktopCapturer });
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
          ocr: {
            text: ocrResult.text || '',
            confidence: ocrResult.confidence || 0,
            success: ocrResult.success
          },
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

  async captureScreenshot(options = {}, modules) {
    try {
      const { desktopCapturer } = modules;
      const {
        displayId = null,
        format = 'png',
        quality = 0.9,
        thumbnailSize = null
      } = options;

      // Get available sources
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: thumbnailSize || { width: 1920, height: 1080 }
      });

      if (sources.length === 0) {
        throw new Error('No screen sources available');
      }

      // Select the appropriate display
      let selectedSource = sources[0];
      if (displayId) {
        const found = sources.find(source => source.display_id === displayId);
        if (found) selectedSource = found;
      }

      // Capture the screenshot
      const thumbnail = selectedSource.thumbnail;
      const imageBuffer = thumbnail.toPNG();
      
      const timestamp = new Date().toISOString();
      const size = {
        width: thumbnail.getSize().width,
        height: thumbnail.getSize().height
      };

      console.log(`Screenshot captured: ${size.width}x${size.height}, ${imageBuffer.length} bytes`);

      return {
        success: true,
        imageBuffer,
        format: 'png',
        timestamp,
        size,
        displayId: selectedSource.display_id,
        sourceName: selectedSource.name
      };
    } catch (error) {
      console.error('Screenshot capture failed:', error);
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
  dependencies: ['electron', 'tesseract.js'],
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
