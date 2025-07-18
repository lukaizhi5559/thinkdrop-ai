/**
 * ScreenCaptureAgent - Object-based approach
 * Handles screenshot capture and OCR processing
 */

const AGENT_FORMAT = {
    name: 'ScreenCaptureAgent',
    description: 'Captures screenshots and extracts text using OCR for visual context understanding',
    schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'Screenshot operation to perform',
          enum: [
            'capture-screen',
            'capture-window',
            'extract-text',
            'save-screenshot'
          ]
        },
        format: {
          type: 'string',
          description: 'Screenshot format',
          enum: ['png', 'jpg', 'base64'],
          default: 'png'
        },
        quality: {
          type: 'integer',
          description: 'Screenshot quality (1-100)',
          minimum: 1,
          maximum: 100,
          default: 90
        },
        enableOCR: {
          type: 'boolean',
          description: 'Whether to extract text from screenshot',
          default: true
        },
        savePath: {
          type: 'string',
          description: 'Path to save screenshot file'
        },
        screenshotData: {
          type: 'string',
          description: 'Base64 screenshot data for processing'
        }
      },
      required: ['action']
    },
    dependencies: ['screenshot-desktop', 'tesseract.js', 'path', 'fs', 'url'],
    execution_target: 'frontend',
    requires_database: false,
    database_type: undefined,
  
    // Object-based bootstrap method
    async bootstrap(config, context) {
      try {
        console.log('📸 ScreenCaptureAgent: Initializing screenshot capabilities...');
        
  
        const { path, fs, url, screenshotDesktop, tesseractJs } = context;
        
        // Store dependencies as instance properties for use during execution
        this.path = path;
        this.fs = fs;
        this.url = url;
        this.screenshotDesktop = screenshotDesktop;
        this.tesseractJs = tesseractJs;
        
        // Setup screenshot directory
        // In VM context, __filename might not be available, so we'll use a fallback
        const currentFilename = (typeof __filename !== 'undefined' && __filename) || 'ScreenCaptureAgent.cjs';
        const __dirname = path.dirname(currentFilename);
        
        const projectRoot = path.dirname(path.dirname(path.dirname(path.dirname(__dirname))));
        this.screenshotDir = path.join(projectRoot, 'screenshots');
        
        // Ensure screenshot directory exists
        if (!fs.existsSync(this.screenshotDir)) {
          fs.mkdirSync(this.screenshotDir, { recursive: true });
          console.log('📁 Created screenshot directory: ' + this.screenshotDir);
        }
        
        // Initialize OCR if available
        if (config.enableOCR !== false) {
          try {
            this.tesseract = tesseractJs;
            this.ocrEnabled = true;
            console.log('🔍 OCR capabilities enabled');
          } catch (error) {
            console.warn('⚠️ OCR not available, continuing without text extraction');
            this.ocrEnabled = false;
          }
        }
        
        console.log('✅ ScreenCaptureAgent: Setup complete');
        return { success: true, screenshotDir: this.screenshotDir };
        
      } catch (error) {
        console.error('❌ ScreenCaptureAgent setup failed:', error);
        throw error;
      }
    },
  
    // Object-based execute method
    async execute(params, context) {
      try {
        const { action } = params;
        
        switch (action) {
          case 'capture-screen':
            return await this.captureScreen(params, context);
          case 'capture-window':
            return await this.captureWindow(params, context);
          case 'extract-text':
            return await this.extractText(params, context);
          case 'save-screenshot':
            return await this.saveScreenshot(params, context);
          default:
            throw new Error('Unknown action: ' + action);
        }
      } catch (error) {
        console.error('[ERROR] ScreenCaptureAgent execution failed:', error);
        throw error;
      }
    },
  
    async captureScreen(params, context) {
      try {
        const { format = 'png', quality = 90, enableOCR = true } = params;
        
        console.log('📸 Capturing screen...');
        console.log('🔍 Context keys:', Object.keys(context));
        console.log('🔍 screenshotDesktop in context:', !!context.screenshotDesktop);
        console.log('🔍 screenshotDesktop in instance:', !!this.screenshotDesktop);
        
        // Use stored instance property instead of context
        const screenshot = this.screenshotDesktop;
        
        console.log('🔍 screenshot object:', typeof screenshot, Object.keys(screenshot || {}));
        
        // Capture screenshot as buffer - handle different export patterns
        let screenshotBuffer;
        if (typeof screenshot === 'function') {
          // Direct function export
          screenshotBuffer = await screenshot();
        } else if (screenshot && typeof screenshot.default === 'function') {
          // Default export
          screenshotBuffer = await screenshot.default();
        } else if (screenshot && typeof screenshot.screenshot === 'function') {
          // Named export
          screenshotBuffer = await screenshot.screenshot();
        } else {
          throw new Error('screenshot-desktop module not properly imported or has unexpected export format');
        }
        
        // Convert buffer to base64 data URL
        const base64Data = screenshotBuffer.toString('base64');
        const screenshotData = `data:image/png;base64,${base64Data}`;
      
        console.log('✅ Screen captured successfully');
        
        let ocrText = null;
        if (enableOCR && this.ocrEnabled) {
          console.log('🔍 Extracting text from screenshot...');
          ocrText = await this.performOCR(screenshotData);
          console.log('📝 Extracted ' + (ocrText?.length || 0) + ' characters of text');
        }
      
      // Generate filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = 'screenshot-' + timestamp + '.' + format;
      const path = require('path');
      const filePath = path.join(this.screenshotDir, filename);
      
      // Save screenshot
      await this.saveToFile(screenshotData, filePath, format);
      
      return {
        success: true,
        screenshot: {
          data: screenshotData,
          path: filePath,
          filename,
          format,
          quality,
          timestamp: new Date().toISOString()
        },
        ocr: ocrText ? {
          text: ocrText,
          enabled: true
        } : {
          text: null,
          enabled: false
        }
      };
      
    } catch (error) {
      console.error('❌ Screen capture failed:', error);
      throw error;
    }
    },
  
    async captureWindow(params, { screenshotDesktop }) {
      try {
        const { format = 'png', quality = 90, enableOCR = true } = params;
        
        console.log('🪟 Capturing screen (window mode)...');
        
        // Use screenshot-desktop for cross-platform screenshot capture
        // Note: screenshot-desktop captures full screen, but we'll name it as window capture
        const screenshot = this.screenshotDesktop;
        
        // Capture screenshot as buffer
        const screenshotBuffer = await screenshot.default();
        
        // Convert buffer to base64 data URL
        const base64Data = screenshotBuffer.toString('base64');
        const screenshotData = `data:image/png;base64,${base64Data}`;
        
        console.log('✅ Screen captured (window mode)');
      
        let ocrText = null;
        if (enableOCR && this.ocrEnabled) {
          console.log('🔍 Extracting text from screenshot...');
          ocrText = await this.performOCR(screenshotData);
          console.log('📝 Extracted ' + (ocrText?.length || 0) + ' characters of text');
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = 'window-' + timestamp + '.' + format;
        const path = require('path');
        const filePath = path.join(this.screenshotDir, filename);
      
      await this.saveToFile(screenshotData, filePath, format);
      
      return {
        success: true,
        screenshot: {
          data: screenshotData,
          path: filePath,
          filename,
          format,
          quality,
          windowName: 'Screen Capture',
          timestamp: new Date().toISOString()
        },
        ocr: ocrText ? {
          text: ocrText,
          enabled: true
        } : {
          text: null,
          enabled: false
        }
      };
      
    } catch (error) {
      console.error('❌ Window capture failed:', error);
      throw error;
    }
    },
  
    async extractText(params, context) {
    try {
      const { screenshotData } = params;
      
      if (!screenshotData) {
        throw new Error('Screenshot data is required for text extraction');
      }
      
      if (!this.ocrEnabled) {
        throw new Error('OCR is not enabled or available');
      }
      
      console.log('🔍 Extracting text from provided screenshot...');
      
      const ocrText = await this.performOCR(screenshotData);
      
      console.log('📝 Extracted ' + (ocrText?.length || 0) + ' characters of text');
      
      return {
        success: true,
        text: ocrText,
        length: ocrText?.length || 0,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('❌ Text extraction failed:', error);
      throw error;
    }
    },
  
    async saveScreenshot(params, context) {
    try {
      const { screenshotData, savePath, format = 'png' } = params;
      
      if (!screenshotData) {
        throw new Error('Screenshot data is required');
      }
      
      const finalPath = savePath || this.generateFilePath(format);
      
      console.log('💾 Saving screenshot to: ' + finalPath);
      
      await this.saveToFile(screenshotData, finalPath, format);
      
      console.log('✅ Screenshot saved successfully');
      
      return {
        success: true,
        path: finalPath,
        format,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('❌ Screenshot save failed:', error);
      throw error;
    }
    },
  
    async performOCR(screenshotData) {
    if (!this.ocrEnabled || !this.tesseract) {
      return null;
    }
    
    try {
      const { data: { text } } = await this.tesseract.recognize(screenshotData, 'eng', {
        logger: m => {
          if (m.status === 'recognizing text') {
            console.log('🔍 OCR Progress: ' + Math.round(m.progress * 100) + '%');
          }
        }
      });
      
      return text.trim();
      
    } catch (error) {
      console.error('❌ OCR failed:', error);
      return null;
    }
    },
  
    async saveToFile(screenshotData, filePath, format) {
      const fs = require('fs');
    
    // Convert data URL to buffer
    const base64Data = screenshotData.replace(/^data:image\/[a-z]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Write to file
    await new Promise((resolve, reject) => {
      fs.writeFile(filePath, buffer, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    },
  
    async generateFilePath(format) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = 'screenshot-' + timestamp + '.' + format;
      const path = require('path');
      return path.join(this.screenshotDir, filename);
    }
  };
  
module.exports = AGENT_FORMAT;
  