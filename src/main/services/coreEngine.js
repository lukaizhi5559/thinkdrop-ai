/**
 * Core Engine - Handles audio capture, clipboard monitoring, and screen capture
 */
const { EventEmitter } = require('events');
const record = require('node-record-lpcm16');
const clipboard = require('electron').clipboard;
const screenshot = require('screenshot-desktop');
const Tesseract = require('tesseract.js');

class CoreEngine extends EventEmitter {
  constructor() {
    super();
    this.isRecording = false;
    this.clipboardWatcher = null;
    this.lastClipboardContent = '';
    this.screenshotInterval = null;
  }

  // Audio capture and STT
  startAudioCapture() {
    if (this.isRecording) return;
    
    console.log('🎤 Starting audio capture...');
    this.isRecording = true;

    const recording = record.record({
      sampleRateHertz: 16000,
      threshold: 0,
      verbose: false,
      recordProgram: 'rec', // or 'sox' on some systems
      silence: '1.0',
    });

    recording.stream()
      .on('data', (chunk) => {
        // Emit audio data for STT processing
        this.emit('audioData', chunk);
      })
      .on('error', (err) => {
        console.error('❌ Audio recording error:', err);
        this.emit('audioError', err);
      });

    this.recording = recording;
  }

  stopAudioCapture() {
    if (!this.isRecording) return;
    
    console.log('🔇 Stopping audio capture...');
    this.isRecording = false;
    
    if (this.recording) {
      this.recording.stop();
      this.recording = null;
    }
  }

  // Clipboard monitoring
  startClipboardMonitoring() {
    console.log('📋 Starting clipboard monitoring...');
    
    this.clipboardWatcher = setInterval(() => {
      const currentContent = clipboard.readText();
      
      if (currentContent && currentContent !== this.lastClipboardContent) {
        console.log('📋 Clipboard content changed');
        this.lastClipboardContent = currentContent;
        this.emit('clipboardChange', currentContent);
      }
    }, 500); // Check every 500ms
  }

  stopClipboardMonitoring() {
    if (this.clipboardWatcher) {
      console.log('📋 Stopping clipboard monitoring...');
      clearInterval(this.clipboardWatcher);
      this.clipboardWatcher = null;
    }
  }

  // Screen capture and OCR
  async captureScreen(displayId = 0) {
    try {
      console.log('📸 Capturing screen...');
      const imgPath = await screenshot({ 
        format: 'png',
        screen: displayId 
      });
      
      return imgPath;
    } catch (error) {
      console.error('❌ Screen capture error:', error);
      throw error;
    }
  }

  async performOCR(imagePath) {
    try {
      console.log('🔍 Performing OCR on captured screen...');
      
      const { data: { text, confidence } } = await Tesseract.recognize(
        imagePath,
        'eng',
        {
          logger: m => {
            if (m.status === 'recognizing text') {
              console.log(`OCR Progress: ${Math.round(m.progress * 100)}%`);
            }
          }
        }
      );

      const confidenceThreshold = parseFloat(process.env.OCR_CONFIDENCE_THRESHOLD) || 0.7;
      
      if (confidence >= confidenceThreshold) {
        console.log('✅ OCR completed successfully');
        return { text: text.trim(), confidence };
      } else {
        console.warn('⚠️ OCR confidence below threshold:', confidence);
        return { text: '', confidence };
      }
    } catch (error) {
      console.error('❌ OCR error:', error);
      throw error;
    }
  }

  // Automated screen monitoring
  startScreenMonitoring() {
    const interval = parseInt(process.env.SCREENSHOT_INTERVAL) || 5000;
    
    console.log(`📸 Starting screen monitoring (${interval}ms intervals)...`);
    
    this.screenshotInterval = setInterval(async () => {
      try {
        const imagePath = await this.captureScreen();
        const ocrResult = await this.performOCR(imagePath);
        
        if (ocrResult.text) {
          this.emit('screenTextDetected', ocrResult);
        }
      } catch (error) {
        console.error('❌ Screen monitoring error:', error);
      }
    }, interval);
  }

  stopScreenMonitoring() {
    if (this.screenshotInterval) {
      console.log('📸 Stopping screen monitoring...');
      clearInterval(this.screenshotInterval);
      this.screenshotInterval = null;
    }
  }

  // Start all monitoring services
  startAll() {
    this.startAudioCapture();
    this.startClipboardMonitoring();
    this.startScreenMonitoring();
  }

  // Stop all monitoring services
  stopAll() {
    this.stopAudioCapture();
    this.stopClipboardMonitoring();
    this.stopScreenMonitoring();
  }
}

module.exports = CoreEngine;
