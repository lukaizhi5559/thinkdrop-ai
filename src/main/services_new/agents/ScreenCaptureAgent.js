import { nativeImage, BrowserWindow } from 'electron';
import screenshot from 'screenshot-desktop';

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
    let hiddenWindows = [];
    let windowStates = [];
    
    try {
      const platform = process.platform;
      console.log(`📸 Starting screenshot capture on ${platform}...`);
      
      // Hide ThinkDrop AI window during screenshot to exclude UI components
      try {
        const allWindows = BrowserWindow.getAllWindows();
        console.log(`📸 Found ${allWindows.length} windows:`);
        
        // Log all window titles for debugging
        allWindows.forEach((win, index) => {
          const title = win.getTitle();
          const isVisible = win.isVisible();
          const isMinimized = win.isMinimized();
          console.log(`📸 Window ${index}: "${title}" (visible: ${isVisible}, minimized: ${isMinimized})`);
        });
        
        // Find ALL ThinkDrop AI windows that need to be hidden
        const thinkdropWindows = allWindows.filter(win => {
          const title = win.getTitle();
          return title.includes('ThinkDrop') || 
                 title.includes('Thinkdrop') ||
                 title.includes('AI') ||
                 title.includes('Memory') ||
                 title.includes('Screenshot') ||
                 title.includes('Debugger') ||
                 title.includes('Insight') ||
                 title === '' || // Sometimes Electron windows have empty titles
                 win.isVisible(); // Include all visible windows as potential ThinkDrop windows
        });
        
        console.log(`📸 Found ${thinkdropWindows.length} ThinkDrop AI windows to hide`);
        
        // Hide all ThinkDrop AI windows
        for (const win of thinkdropWindows) {
          const title = win.getTitle();
          const isVisible = win.isVisible();
          
          if (isVisible) {
            console.log(`📸 Hiding window: "${title}"`);
            windowStates.push({ window: win, title, wasVisible: true });
            hiddenWindows.push(win);
            win.hide();
          } else {
            console.log(`📸 Window already hidden: "${title}"`);
            windowStates.push({ window: win, title, wasVisible: false });
          }
        }
        
        if (hiddenWindows.length > 0) {
          console.log(`📸 Hidden ${hiddenWindows.length} windows, waiting for them to disappear...`);
          // Wait longer for multiple windows to be fully hidden
          await new Promise(resolve => setTimeout(resolve, 500));
          console.log('📸 All windows hidden, proceeding with screenshot...');
        } else {
          console.log('📸 No windows needed hiding, proceeding with screenshot...');
        }
      } catch (windowError) {
        console.warn('📸 Could not hide main window:', windowError.message);
      }
      
      // Capture screenshot from primary display
      const imageBuffer = await screenshot({ format: 'png' });
      
      if (!imageBuffer || imageBuffer.length === 0) {
        throw new Error('Screenshot capture returned empty buffer');
      }
      
      // Get image dimensions using Electron's nativeImage
      const image = nativeImage.createFromBuffer(imageBuffer);
      const size = image.getSize();
      
      if (size.width === 0 || size.height === 0) {
        throw new Error('Screenshot has invalid dimensions');
      }
      
      const timestamp = new Date().toISOString();

      console.log(`📸 Screenshot captured successfully: ${size.width}x${size.height}, ${imageBuffer.length} bytes`);
      
      // Restore all ThinkDrop AI windows that were visible
      if (windowStates.length > 0) {
        console.log(`📸 Restoring ${windowStates.length} ThinkDrop AI windows...`);
        for (const { window, title, wasVisible } of windowStates) {
          if (wasVisible) {
            console.log(`📸 Restoring window: "${title}"`);
            window.show();
          }
        }
        console.log('📸 All windows restored');
      }
      
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
      console.error('Screenshot-desktop capture failed:', error);
      
      // Always restore all windows even if screenshot failed
      if (windowStates.length > 0) {
        console.log(`📸 Restoring ${windowStates.length} ThinkDrop AI windows after error...`);
        for (const { window, title, wasVisible } of windowStates) {
          if (wasVisible) {
            try {
              console.log(`📸 Restoring window after error: "${title}"`);
              window.show();
            } catch (restoreError) {
              console.error(`📸 Failed to restore window "${title}":`, restoreError.message);
            }
          }
        }
      }
      
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
