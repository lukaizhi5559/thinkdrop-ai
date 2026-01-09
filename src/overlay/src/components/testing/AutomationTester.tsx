import React, { useState } from 'react';
import { Camera, Type, MousePointer, Eye, Play, X, CheckCircle } from 'lucide-react';
import * as capabilities from '../../automation/capabilities';
import * as nutjs from '../../automation/nutjs-detector';

interface OCRResult {
  text: string;
  confidence: number;
  blocks: Array<{
    text: string;
    bbox: { x0: number; y0: number; x1: number; y1: number };
    confidence: number;
  }>;
}

interface TestResult {
  success: boolean;
  message: string;
  data?: any;
}

interface AutomationTesterProps {
  onClose: () => void;
}

export default function AutomationTester({ onClose }: AutomationTesterProps) {
  const [screenshot, setScreenshot] = useState<string>('');
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [testInput, setTestInput] = useState('');
  const [selectedTest, setSelectedTest] = useState<'ocr' | 'click' | 'type' | 'find' | 'verify'>('ocr');

  const captureAndAnalyze = async () => {
    setIsLoading(true);
    setTestResult(null);
    setOcrResult(null);

    try {
      console.log('📸 [TESTER] Capturing screenshot...');
      const screenshot = await capabilities.captureScreenshot();
      setScreenshot(screenshot);

      if (selectedTest === 'ocr') {
        console.log('🔍 [TESTER] Running OCR...');
        const result = await runOCR(screenshot);
        setOcrResult(result);
        setTestResult({
          success: true,
          message: `OCR detected ${result.blocks.length} text blocks`,
          data: result
        });
      }
    } catch (error: any) {
      console.error('❌ [TESTER] Error:', error);
      setTestResult({
        success: false,
        message: error.message
      });
    } finally {
      setIsLoading(false);
    }
  };

  const addMarkerToScreenshot = (base64Image: string, x: number, y: number): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        
        // Draw original image
        ctx.drawImage(img, 0, 0);
        
        // Draw crosshair marker at coordinates
        ctx.strokeStyle = '#00ff00'; // Bright green
        ctx.lineWidth = 3;
        
        // Draw crosshair
        const size = 20;
        ctx.beginPath();
        ctx.moveTo(x - size, y);
        ctx.lineTo(x + size, y);
        ctx.moveTo(x, y - size);
        ctx.lineTo(x, y + size);
        ctx.stroke();
        
        // Draw circle around point
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, 2 * Math.PI);
        ctx.stroke();
        
        // Add coordinate label
        ctx.fillStyle = '#00ff00';
        ctx.font = '14px monospace';
        ctx.fillText(`(${x}, ${y})`, x + 15, y - 15);
        
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = base64Image;
    });
  };

  const saveScreenshotToFile = async (base64Image: string, testName: string) => {
    const ipcRenderer = (window as any).electron?.ipcRenderer;
    if (!ipcRenderer) {
      console.warn('[TESTER] IPC not available for saving screenshot');
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${testName}_${timestamp}.png`;
    
    console.log(`💾 [TESTER] Saving screenshot: ${filename}`);
    
    // Send IPC to save screenshot
    ipcRenderer.send('automation:save-screenshot', {
      screenshot: base64Image,
      filename
    });
  };

  const runOCR = async (screenshot: string): Promise<OCRResult> => {
    console.log('🔍 [TESTER] Running OCR directly with Tesseract.js...');
    
    // Import Tesseract dynamically from nutjs-detector's worker
    const { createWorker } = await import('tesseract.js');
    
    console.log('🔧 [TESTER] Creating Tesseract worker...');
    const worker = await createWorker('eng', 1, {
      logger: (m: any) => {
        if (m.status === 'recognizing text') {
          console.log(`📊 [TESTER] OCR Progress: ${Math.round(m.progress * 100)}%`);
        }
      }
    });

    console.log('🔍 [TESTER] Running OCR recognition...');
    const result = await worker.recognize(screenshot, {}, { blocks: true });
    
    console.log('📄 [TESTER] OCR Result:', result.data);
    
    // Extract words from the hierarchical structure
    let words: any[] = [];
    const data = result.data as any; // Cast to any since Tesseract types may vary
    
    if (data?.blocks && Array.isArray(data.blocks)) {
      words = data.blocks
        .map((block: any) =>
          block.paragraphs?.map((paragraph: any) =>
            paragraph.lines?.map((line: any) => line.words || [])
          ) || []
        )
        .flat(3)
        .filter(Boolean);
    } else if (data?.words && Array.isArray(data.words)) {
      words = data.words;
    } else if (data?.lines && Array.isArray(data.lines)) {
      // Fallback: extract words from lines if blocks not available
      for (const line of data.lines) {
        if (line.words && Array.isArray(line.words)) {
          words.push(...line.words);
        }
      }
    }
    
    console.log(`✅ [TESTER] Extracted ${words.length} words`);
    
    // Convert to our format
    const blocks = words.map((word: any) => ({
      text: word.text,
      bbox: {
        x0: word.bbox.x0,
        y0: word.bbox.y0,
        x1: word.bbox.x1,
        y1: word.bbox.y1
      },
      confidence: word.confidence
    }));
    
    await worker.terminate();
    
    return {
      text: result.data.text || '',
      confidence: result.data.confidence || 0,
      blocks
    };
  };

  const testFindElement = async () => {
    if (!testInput.trim()) {
      setTestResult({ success: false, message: 'Please enter a description' });
      return;
    }

    setIsLoading(true);
    setTestResult(null);

    try {
      const ipcRenderer = (window as any).electron?.ipcRenderer;
      if (ipcRenderer) {
        // CRITICAL: Hide the tester overlay to prevent interference
        console.log('👻 [TESTER] Hiding overlay to prevent interference');
        ipcRenderer.send('intent-overlay:hide');
        
        // Wait for overlay to hide
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      console.log('🔍 [TESTER] Finding element:', testInput);
      const result = await capabilities.findElement({
        strategy: 'vision',
        value: testInput,
        description: testInput
      });
      
      if (result.success && result.coordinates) {
        // Move ghost mouse to the found coordinates for visual feedback
        if (ipcRenderer) {
          console.log('👻 [TESTER] Moving ghost mouse to:', result.coordinates);
          ipcRenderer.send('ghost-overlay:move', {
            x: result.coordinates.x,
            y: result.coordinates.y
          });
          
          // Wait a moment for ghost to move, then capture screenshot with marker
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Capture screenshot and add visual marker
        const screenshot = await capabilities.captureScreenshot();
        const markedScreenshot = await addMarkerToScreenshot(
          screenshot, 
          result.coordinates.x, 
          result.coordinates.y
        );
        setScreenshot(markedScreenshot);
        
        // Save marked screenshot to file
        await saveScreenshotToFile(markedScreenshot, 'find-element');
        
        setTestResult({
          success: true,
          message: `Element found at (${result.coordinates.x}, ${result.coordinates.y})`,
          data: result.coordinates
        });
      } else {
        const screenshot = await capabilities.captureScreenshot();
        setScreenshot(screenshot);
        
        setTestResult({
          success: false,
          message: 'Element not found'
        });
      }
      
      // Show overlay again
      if (ipcRenderer) {
        await new Promise(resolve => setTimeout(resolve, 300));
        ipcRenderer.send('intent-overlay:show');
      }
    } catch (error: any) {
      // Show overlay again on error
      const ipcRendererErr = (window as any).electron?.ipcRenderer;
      if (ipcRendererErr) {
        ipcRendererErr.send('intent-overlay:show');
      }
      
      setTestResult({
        success: false,
        message: error.message
      });
    } finally {
      setIsLoading(false);
    }
  };

  const testTypeText = async () => {
    if (!testInput.trim()) {
      setTestResult({ success: false, message: 'Please enter text to type' });
      return;
    }

    setIsLoading(true);
    setTestResult(null);

    try {
      console.log('⌨️ [TESTER] Typing text:', testInput);
      
      const ipcRenderer = (window as any).electron?.ipcRenderer;
      if (ipcRenderer) {
        // CRITICAL: Hide the tester overlay to prevent focus stealing
        console.log('👻 [TESTER] Hiding overlay to prevent focus stealing');
        ipcRenderer.send('intent-overlay:hide');
        
        // Wait for overlay to hide
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Countdown timer - give user time to focus on input field
      console.log('⏱️ [TESTER] Starting 5 second countdown...');
      for (let i = 5; i > 0; i--) {
        setTestResult({
          success: false,
          message: `Focus on input field... typing in ${i} seconds`
        });
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      setTestResult({
        success: false,
        message: 'Typing now...'
      });
      
      // Now type the text
      await nutjs.typeText(testInput);
      
      // Show overlay again
      if (ipcRenderer) {
        await new Promise(resolve => setTimeout(resolve, 300));
        ipcRenderer.send('intent-overlay:show');
      }
      
      setTestResult({
        success: true,
        message: `Typed: "${testInput}"`
      });
    } catch (error: any) {
      console.error('❌ [TESTER] Type failed:', error);
      
      // Show overlay again on error
      const ipcRenderer = (window as any).electron?.ipcRenderer;
      if (ipcRenderer) {
        ipcRenderer.send('intent-overlay:show');
      }
      
      setTestResult({
        success: false,
        message: error.message
      });
    } finally {
      setIsLoading(false);
    }
  };

  const testVerify = async () => {
    if (!testInput.trim()) {
      setTestResult({ success: false, message: 'Please enter what to verify' });
      return;
    }

    setIsLoading(true);
    setTestResult(null);

    try {
      const ipcRenderer = (window as any).electron?.ipcRenderer;
      if (ipcRenderer) {
        // CRITICAL: Hide the tester overlay to prevent interference
        console.log('👻 [TESTER] Hiding overlay to prevent interference');
        ipcRenderer.send('intent-overlay:hide');
        
        // Wait for overlay to hide
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      console.log('✅ [TESTER] Verifying with Vision:', testInput);
      
      // Capture screenshot first
      const screenshot = await capabilities.captureScreenshot();
      setScreenshot(screenshot);
      
      // Use verifyStepWithVision to check if the expected state is visible
      const result = await capabilities.verifyStepWithVision(
        testInput, // expectedState - what we want to verify
        'Manual verification test' // stepDescription
      );
      
      console.log('✅ [TESTER] Verification result:', result);
      
      setTestResult({
        success: result.verified,
        message: result.verified 
          ? `Verified! Confidence: ${Math.round(result.confidence * 100)}%` 
          : `Not verified. Confidence: ${Math.round(result.confidence * 100)}%`,
        data: {
          verified: result.verified,
          confidence: result.confidence,
          reasoning: result.reasoning
        }
      });
      
      // Show overlay again
      if (ipcRenderer) {
        await new Promise(resolve => setTimeout(resolve, 300));
        ipcRenderer.send('intent-overlay:show');
      }
    } catch (error: any) {
      // Show overlay again on error
      const ipcRendererErr = (window as any).electron?.ipcRenderer;
      if (ipcRendererErr) {
        ipcRendererErr.send('intent-overlay:show');
      }
      
      setTestResult({
        success: false,
        message: error.message
      });
    } finally {
      setIsLoading(false);
    }
  };

  const testClick = async () => {
    if (!testInput.trim()) {
      setTestResult({ success: false, message: 'Please enter element description' });
      return;
    }

    setIsLoading(true);
    setTestResult(null);

    try {
      const ipcRenderer = (window as any).electron?.ipcRenderer;
      if (ipcRenderer) {
        // CRITICAL: Hide the tester overlay to prevent interference
        console.log('👻 [TESTER] Hiding overlay to prevent interference');
        ipcRenderer.send('intent-overlay:hide');
        
        // Wait for overlay to hide
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      console.log('🔍 [TESTER] Finding element to click:', testInput);
      // Use Vision API for better accuracy (OCR fails on styled text)
      const result = await capabilities.findElement({
        strategy: 'vision',
        value: testInput,
        description: testInput
      });
      
      if (result.success && result.coordinates) {
        // Move ghost mouse to show where we'll click
        if (ipcRenderer) {
          console.log('👻 [TESTER] Moving ghost mouse to click location:', result.coordinates);
          ipcRenderer.send('ghost-overlay:move', {
            x: result.coordinates.x,
            y: result.coordinates.y
          });
          
          // Wait for visual feedback, then capture screenshot
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Capture screenshot and add visual marker
        const screenshot = await capabilities.captureScreenshot();
        const markedScreenshot = await addMarkerToScreenshot(
          screenshot, 
          result.coordinates.x, 
          result.coordinates.y
        );
        setScreenshot(markedScreenshot);
        
        // Save marked screenshot to file
        await saveScreenshotToFile(markedScreenshot, 'click-element');
        
        console.log('🖱️ [TESTER] Clicking at:', result.coordinates);
        await nutjs.clickAtCoordinates(result.coordinates.x, result.coordinates.y);
        
        setTestResult({
          success: true,
          message: `Clicked at (${result.coordinates.x}, ${result.coordinates.y})`,
          data: result.coordinates
        });
      } else {
        const screenshot = await capabilities.captureScreenshot();
        setScreenshot(screenshot);
        
        setTestResult({
          success: false,
          message: 'Element not found for clicking'
        });
      }
      
      // Show overlay again
      if (ipcRenderer) {
        await new Promise(resolve => setTimeout(resolve, 300));
        ipcRenderer.send('intent-overlay:show');
      }
    } catch (error: any) {
      // Show overlay again on error
      const ipcRendererErr = (window as any).electron?.ipcRenderer;
      if (ipcRendererErr) {
        ipcRendererErr.send('intent-overlay:show');
      }
      
      setTestResult({
        success: false,
        message: error.message
      });
    } finally {
      setIsLoading(false);
    }
  };

  const runTest = async () => {
    switch (selectedTest) {
      case 'ocr':
        await captureAndAnalyze();
        break;
      case 'find':
        await testFindElement();
        break;
      case 'type':
        await testTypeText();
        break;
      case 'click':
        await testClick();
        break;
      case 'verify':
        await testVerify();
        break;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
      <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <Camera className="w-5 h-5 text-teal-400" />
            <h2 className="text-lg font-semibold text-white">Automation Tester</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* Test Selection */}
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-sm font-medium text-gray-300 mb-3">Select Test</h3>
            <div className="grid grid-cols-5 gap-2">
              <button
                onClick={() => setSelectedTest('ocr')}
                className={`p-3 rounded-lg border transition-colors ${
                  selectedTest === 'ocr'
                    ? 'bg-teal-600 border-teal-500 text-white'
                    : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                }`}
              >
                <Eye className="w-4 h-4 mx-auto mb-1" />
                <span className="text-xs">OCR Test</span>
              </button>
              <button
                onClick={() => setSelectedTest('find')}
                className={`p-3 rounded-lg border transition-colors ${
                  selectedTest === 'find'
                    ? 'bg-teal-600 border-teal-500 text-white'
                    : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                }`}
              >
                <MousePointer className="w-4 h-4 mx-auto mb-1" />
                <span className="text-xs">Find Element</span>
              </button>
              <button
                onClick={() => setSelectedTest('type')}
                className={`p-3 rounded-lg border transition-colors ${
                  selectedTest === 'type'
                    ? 'bg-teal-600 border-teal-500 text-white'
                    : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                }`}
              >
                <Type className="w-4 h-4 mx-auto mb-1" />
                <span className="text-xs">Type Text</span>
              </button>
              <button
                onClick={() => setSelectedTest('click')}
                className={`p-3 rounded-lg border transition-colors ${
                  selectedTest === 'click'
                    ? 'bg-teal-600 border-teal-500 text-white'
                    : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                }`}
              >
                <MousePointer className="w-4 h-4 mx-auto mb-1" />
                <span className="text-xs">Click Element</span>
              </button>
              <button
                onClick={() => setSelectedTest('verify')}
                className={`p-3 rounded-lg border transition-colors ${
                  selectedTest === 'verify'
                    ? 'bg-teal-600 border-teal-500 text-white'
                    : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                }`}
              >
                <CheckCircle className="w-4 h-4 mx-auto mb-1" />
                <span className="text-xs">Verify Vision</span>
              </button>
            </div>
          </div>

          {/* Test Input */}
          {selectedTest !== 'ocr' && (
            <div className="bg-gray-800 rounded-lg p-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                {selectedTest === 'type' ? 'Text to Type' : selectedTest === 'verify' ? 'What to Verify' : 'Element Description'}
              </label>
              <input
                type="text"
                value={testInput}
                onChange={(e) => setTestInput(e.target.value)}
                placeholder={
                  selectedTest === 'type'
                    ? 'Enter text to type...'
                    : selectedTest === 'verify'
                    ? 'Describe what should be visible (e.g., "Google search page is displayed")'
                    : 'Describe the element (e.g., "search input field")'
                }
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          )}

          {/* Run Test Button */}
          <button
            onClick={runTest}
            disabled={isLoading}
            className="w-full py-3 bg-teal-600 hover:bg-teal-700 disabled:bg-gray-700 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                Running Test...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Run Test
              </>
            )}
          </button>

          {/* Test Result */}
          {testResult && (
            <div
              className={`rounded-lg p-4 ${
                testResult.success
                  ? 'bg-green-900/30 border border-green-700'
                  : 'bg-red-900/30 border border-red-700'
              }`}
            >
              <h3
                className={`text-sm font-medium mb-2 ${
                  testResult.success ? 'text-green-400' : 'text-red-400'
                }`}
              >
                {testResult.success ? '✅ Test Passed' : '❌ Test Failed'}
              </h3>
              <p className="text-sm text-gray-300">{testResult.message}</p>
              {testResult.data && (
                <pre className="mt-2 text-xs text-gray-400 bg-gray-800 rounded p-2 overflow-auto max-h-32">
                  {JSON.stringify(testResult.data, null, 2)}
                </pre>
              )}
            </div>
          )}

          {/* OCR Results */}
          {ocrResult && (
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-300 mb-3">
                OCR Results ({ocrResult.blocks.length} blocks detected)
              </h3>
              <div className="space-y-2 max-h-64 overflow-auto">
                {ocrResult.blocks.map((block, index) => (
                  <div key={index} className="bg-gray-700 rounded p-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-white flex-1">{block.text}</p>
                      <span className="text-xs text-gray-400">
                        {Math.round(block.confidence * 100)}%
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Position: ({Math.round(block.bbox.x0)}, {Math.round(block.bbox.y0)}) →
                      ({Math.round(block.bbox.x1)}, {Math.round(block.bbox.y1)})
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Screenshot Preview */}
          {screenshot && (
            <div className="bg-gray-800 rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-300 mb-3">Screenshot</h3>
              <img
                src={screenshot}
                alt="Test screenshot"
                className="w-full rounded border border-gray-700"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
