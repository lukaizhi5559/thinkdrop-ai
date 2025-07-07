/**
 * Screenshot Agent - Handles screen capture, OCR, and visual analysis
 * Integrates with CoreEngine for screenshot capabilities and UI analysis
 */
import screenshot from 'screenshot-desktop';
import Tesseract from 'tesseract.js';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

class ScreenshotAgent extends EventEmitter {
  constructor(coreEngine) {
    super();
    this.coreEngine = coreEngine;
    this.ocrWorker = null;
    this.screenshotDir = path.join(process.cwd(), 'screenshots');
    this.isInitialized = false;
  }

  /**
   * Initialize the screenshot agent
   */
  async initialize() {
    try {
      console.log('🖼️ Initializing Screenshot Agent...');
      
      // Create screenshots directory if it doesn't exist
      if (!fs.existsSync(this.screenshotDir)) {
        fs.mkdirSync(this.screenshotDir, { recursive: true });
      }

      // Initialize OCR worker
      this.ocrWorker = await Tesseract.createWorker('eng');
      
      this.isInitialized = true;
      console.log('✅ Screenshot Agent initialized successfully');
      
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize Screenshot Agent:', error);
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * Capture screenshot and perform analysis
   */
  async captureAndAnalyze(options = {}) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      console.log('📸 Capturing screenshot...');
      
      // Generate unique filename
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `screenshot_${timestamp}.png`;
      const filepath = path.join(this.screenshotDir, filename);

      // Capture screenshot
      const screenshotBuffer = await screenshot({ format: 'png' });
      fs.writeFileSync(filepath, screenshotBuffer);

      console.log(`✅ Screenshot saved: ${filename}`);

      // Perform OCR if requested
      let ocrResult = null;
      if (options.performOCR !== false) {
        console.log('🔍 Performing OCR analysis...');
        ocrResult = await this.performOCR(filepath);
      }

      // Get UI elements if CoreEngine has UI indexer
      let uiElements = [];
      if (this.coreEngine && this.coreEngine.isUIIndexerRunning) {
        try {
          const uiScanResult = await this.coreEngine.scanCurrentApp();
          uiElements = uiScanResult ? uiScanResult.elements : [];
        } catch (error) {
          console.warn('⚠️ Could not get UI elements:', error.message);
        }
      }

      // Build analysis result
      const analysisResult = {
        screenshot: {
          filename,
          filepath,
          timestamp: new Date().toISOString(),
          size: screenshotBuffer.length
        },
        ocr: ocrResult,
        uiElements: uiElements,
        analysis: this.analyzeScreenContent(ocrResult, uiElements),
        suggestions: this.generateSuggestions(ocrResult, uiElements)
      };

      // Emit event for other services
      this.emit('screenshot-analyzed', analysisResult);

      return analysisResult;

    } catch (error) {
      console.error('❌ Screenshot capture and analysis failed:', error);
      throw error;
    }
  }

  /**
   * Perform OCR on screenshot
   */
  async performOCR(imagePath) {
    try {
      if (!this.ocrWorker) {
        this.ocrWorker = await Tesseract.createWorker('eng');
      }

      const { data } = await this.ocrWorker.recognize(imagePath);
      
      return {
        text: data.text,
        confidence: data.confidence,
        words: data.words.map(word => ({
          text: word.text,
          confidence: word.confidence,
          bbox: word.bbox
        })),
        lines: data.lines.map(line => ({
          text: line.text,
          confidence: line.confidence,
          bbox: line.bbox
        }))
      };
    } catch (error) {
      console.error('❌ OCR failed:', error);
      return {
        text: '',
        confidence: 0,
        words: [],
        lines: [],
        error: error.message
      };
    }
  }

  /**
   * Analyze screen content and extract insights
   */
  analyzeScreenContent(ocrResult, uiElements) {
    const analysis = {
      contentType: 'unknown',
      detectedApplications: [],
      textContent: ocrResult ? ocrResult.text : '',
      interactiveElements: uiElements.length,
      insights: []
    };

    if (ocrResult && ocrResult.text) {
      const text = ocrResult.text.toLowerCase();
      
      // Detect application types
      if (text.includes('code') || text.includes('function') || text.includes('import')) {
        analysis.contentType = 'code_editor';
        analysis.insights.push('Code editor detected - development environment');
      } else if (text.includes('email') || text.includes('inbox') || text.includes('compose')) {
        analysis.contentType = 'email';
        analysis.insights.push('Email application detected');
      } else if (text.includes('browser') || text.includes('http') || text.includes('www')) {
        analysis.contentType = 'web_browser';
        analysis.insights.push('Web browser detected');
      } else if (text.includes('document') || text.includes('paragraph')) {
        analysis.contentType = 'document_editor';
        analysis.insights.push('Document editor detected');
      }

      // Detect specific patterns
      if (text.includes('error') || text.includes('exception')) {
        analysis.insights.push('Error or exception detected on screen');
      }
      
      if (text.includes('login') || text.includes('password')) {
        analysis.insights.push('Login form detected');
      }
    }

    // Analyze UI elements
    if (uiElements.length > 0) {
      const buttonCount = uiElements.filter(el => el.role === 'button').length;
      const inputCount = uiElements.filter(el => el.role === 'textfield').length;
      
      if (buttonCount > 0) {
        analysis.insights.push(`${buttonCount} interactive buttons available`);
      }
      
      if (inputCount > 0) {
        analysis.insights.push(`${inputCount} input fields detected`);
      }
    }

    return analysis;
  }

  /**
   * Generate actionable suggestions based on screen content
   */
  generateSuggestions(ocrResult, uiElements) {
    const suggestions = [];

    if (ocrResult && ocrResult.text) {
      const text = ocrResult.text.toLowerCase();
      
      // Code-related suggestions
      if (text.includes('error') || text.includes('exception')) {
        suggestions.push({
          action: 'debug_error',
          description: 'Debug the error shown on screen',
          confidence: 0.8
        });
      }

      // Form-related suggestions
      if (text.includes('login') || text.includes('sign in')) {
        suggestions.push({
          action: 'fill_login',
          description: 'Fill login credentials',
          confidence: 0.7
        });
      }

      // General text suggestions
      if (ocrResult.text.length > 100) {
        suggestions.push({
          action: 'summarize_content',
          description: 'Summarize the text content on screen',
          confidence: 0.6
        });
      }
    }

    // UI element suggestions
    if (uiElements.length > 0) {
      const buttons = uiElements.filter(el => el.role === 'button');
      if (buttons.length > 0) {
        suggestions.push({
          action: 'interact_buttons',
          description: `${buttons.length} buttons available for interaction`,
          confidence: 0.9,
          elements: buttons.slice(0, 3) // Show first 3 buttons
        });
      }

      const inputs = uiElements.filter(el => el.role === 'textfield');
      if (inputs.length > 0) {
        suggestions.push({
          action: 'fill_inputs',
          description: `${inputs.length} input fields can be filled`,
          confidence: 0.8,
          elements: inputs.slice(0, 3) // Show first 3 inputs
        });
      }
    }

    return suggestions;
  }

  /**
   * Process screenshot request with specific intent
   */
  async processScreenshotRequest(intent, options = {}) {
    try {
      console.log(`🎯 Processing screenshot request with intent: ${intent}`);
      
      const analysisResult = await this.captureAndAnalyze(options);
      
      // Customize response based on intent
      let response = {
        success: true,
        timestamp: new Date().toISOString(),
        intent,
        ...analysisResult
      };

      switch (intent) {
        case 'analyze_screen':
          response.focus = 'analysis';
          response.summary = this.generateAnalysisSummary(analysisResult);
          break;
          
        case 'extract_text':
          response.focus = 'text';
          response.extractedText = analysisResult.ocr ? analysisResult.ocr.text : '';
          break;
          
        case 'find_elements':
          response.focus = 'elements';
          response.interactiveElements = analysisResult.uiElements;
          break;
          
        case 'debug_screen':
          response.focus = 'debugging';
          response.debugInfo = this.generateDebugInfo(analysisResult);
          break;
          
        default:
          response.focus = 'general';
      }

      return response;

    } catch (error) {
      console.error('❌ Screenshot request processing failed:', error);
      return {
        success: false,
        error: error.message,
        intent,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Generate analysis summary
   */
  generateAnalysisSummary(analysisResult) {
    const { analysis, ocr, uiElements } = analysisResult;
    
    let summary = `Screen Analysis Summary:\n`;
    summary += `- Content Type: ${analysis.contentType}\n`;
    summary += `- Interactive Elements: ${uiElements.length}\n`;
    
    if (ocr && ocr.text) {
      summary += `- Text Content: ${ocr.text.length} characters detected\n`;
      summary += `- OCR Confidence: ${Math.round(ocr.confidence)}%\n`;
    }
    
    if (analysis.insights.length > 0) {
      summary += `- Key Insights:\n`;
      analysis.insights.forEach(insight => {
        summary += `  • ${insight}\n`;
      });
    }

    return summary;
  }

  /**
   * Generate debug information
   */
  generateDebugInfo(analysisResult) {
    return {
      screenshotInfo: analysisResult.screenshot,
      ocrStats: analysisResult.ocr ? {
        textLength: analysisResult.ocr.text.length,
        wordCount: analysisResult.ocr.words.length,
        lineCount: analysisResult.ocr.lines.length,
        confidence: analysisResult.ocr.confidence
      } : null,
      uiElementStats: {
        total: analysisResult.uiElements.length,
        byRole: analysisResult.uiElements.reduce((acc, el) => {
          acc[el.role] = (acc[el.role] || 0) + 1;
          return acc;
        }, {})
      },
      analysisInsights: analysisResult.analysis.insights
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    try {
      if (this.ocrWorker) {
        await this.ocrWorker.terminate();
        this.ocrWorker = null;
      }
      
      console.log('✅ Screenshot Agent cleaned up');
    } catch (error) {
      console.error('❌ Screenshot Agent cleanup failed:', error);
    }
  }

  /**
   * Get agent status
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      ocrWorkerReady: !!this.ocrWorker,
      screenshotDirectory: this.screenshotDir,
      coreEngineConnected: !!this.coreEngine
    };
  }
}

export default ScreenshotAgent;
