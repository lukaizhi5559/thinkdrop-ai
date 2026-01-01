/**
 * Nut.js Native UI Detection
 * 
 * Fast, local UI element detection using native OS APIs
 * Replaces slow Vision API calls (10-20s -> <100ms)
 * 
 * Uses libnut-core built from source for native mouse/keyboard control
 * Uses Tesseract.js for OCR-based text detection
 */

import { createWorker } from 'tesseract.js';

// Use IPC to communicate with main process for native automation
const ipcRenderer = (window as any).electron?.ipcRenderer;

// Tesseract worker for OCR (lazy initialized)
let ocrWorker: any = null;

if (ipcRenderer) {
  console.log('✅ [NUTJS] IPC available - native automation enabled via main process');
  console.log('💡 [NUTJS] To test: Run "window.testNutjs()" in console');
} else {
  console.warn('⚠️ [NUTJS] IPC not available - native automation disabled');
}

// Export for testing
export function isLibnutAvailable(): boolean {
  return ipcRenderer !                 
}

// Test function - gets screen info via IPC
export async function testNativeAutomation(): Promise<void> {
  if (!ipcRenderer) {
    console.error('❌ [NUTJS TEST] IPC not available');
    return;
  }
  
  try {
    console.log('🧪 [NUTJS TEST] Starting native automation test...');
    
    // Request test from main process
    return new Promise((resolve, reject) => {
      ipcRenderer.once('automation:native-test:result', (_event: any, result: any) => {
        if (result.success) {
          console.log('📐 [NUTJS TEST] Screen size:', result.screenSize);
          console.log('🖱️ [NUTJS TEST] Current mouse position:', result.currentPos);
          console.log('🎉 [NUTJS TEST] Native automation test completed successfully!');
          resolve();
        } else {
          console.error('❌ [NUTJS TEST] Test failed:', result.error);
          reject(new Error(result.error));
        }
      });
      
      ipcRenderer.send('automation:native-test');
    });
  } catch (error: any) {
    console.error('❌ [NUTJS TEST] Test failed:', error);
  }
}

// Expose test function globally for easy console access
if (typeof window !== 'undefined') {
  (window as any).testNutjs = testNativeAutomation;
  (window as any).isNutjsAvailable = isLibnutAvailable;
}

export interface DetectionLocator {
  strategy: 'text' | 'image' | 'element' | 'vision' | 'bbox';
  value?: string;
  context?: string;
  role?: string;
  description?: string;
  bbox?: [number, number, number, number]; // [x, y, width, height] for bbox strategy
}

export interface DetectionResult {
  success: boolean;
  coordinates?: { x: number; y: number };
  region?: any; // Region type from nut.js (not used currently)
  error?: string;
  usedVisionAPI?: boolean; // Flag to indicate if Vision API was used as fallback
}

/**
 * Initialize OCR worker (lazy initialization)
 */
async function initOCRWorker() {
  if (!ocrWorker) {
    console.log('🔧 [NUTJS] Initializing Tesseract OCR worker...');
    ocrWorker = await createWorker('eng', 1, {
      logger: (m: any) => console.log('📝 [TESSERACT]', m)
    });
    
    // Configure Tesseract to output word-level bounding boxes
    await ocrWorker.setParameters({
      tessedit_pageseg_mode: '1', // Auto page segmentation with OSD
    });
    
    console.log('✅ [NUTJS] OCR worker initialized with word-level detection');
  }
  return ocrWorker;
}

/**
 * Find and click element using text strategy
 * Fast OCR-based text detection on screen
 */
export async function findAndClickText(text: string, context?: string): Promise<DetectionResult> {
  console.log(`🔍 [NUTJS] Finding text: "${text}" (context: ${context})`);
  
  if (!ipcRenderer) {
    return {
      success: false,
      error: 'IPC not available for screen capture'
    };
  }
  
  try {
    // Capture screen
    console.log('📸 [NUTJS] Capturing screen for OCR...');
    const screenshot = await new Promise<string>((resolve, reject) => {
      ipcRenderer.once('automation:capture-screen:result', (_event: any, result: any) => {
        if (result.success) {
          resolve(result.screenshot);
        } else {
          reject(new Error(result.error || 'Failed to capture screen'));
        }
      });
      ipcRenderer.send('automation:capture-screen');
    });
    
    // Initialize OCR worker
    const worker = await initOCRWorker();
    
    // Run OCR on screenshot with word-level output (no preprocessing)
    console.log('🔍 [NUTJS] Running OCR...');
    // CRITICAL: Pass { blocks: true } as third argument to get word-level bounding boxes
    const result = await worker.recognize(screenshot, {}, { blocks: true });
    
    console.log('🔍 [NUTJS] Full OCR result:', result);
    console.log('🔍 [NUTJS] OCR result.data:', result.data);
    
    // Tesseract.js v7 with blocks: true returns hierarchical structure
    // Extract words from blocks -> paragraphs -> lines -> words
    let words: any[] = [];
    
    if (result.data?.blocks && Array.isArray(result.data.blocks)) {
      // Flatten blocks -> paragraphs -> lines -> words
      words = result.data.blocks
        .map((block: any) =>
          block.paragraphs?.map((paragraph: any) =>
            paragraph.lines?.map((line: any) => line.words || [])
          ) || []
        )
        .flat(3)
        .filter(Boolean);
    } else if (result.data?.words && Array.isArray(result.data.words)) {
      words = result.data.words;
    } else if (result.data?.lines && Array.isArray(result.data.lines)) {
      // Extract words from lines if blocks not available
      for (const line of result.data.lines) {
        if (line.words && Array.isArray(line.words)) {
          words.push(...line.words);
        }
      }
    } else if (result.data?.paragraphs && Array.isArray(result.data.paragraphs)) {
      // Extract from paragraphs -> lines -> words
      for (const para of result.data.paragraphs) {
        if (para.lines && Array.isArray(para.lines)) {
          for (const line of para.lines) {
            if (line.words && Array.isArray(line.words)) {
              words.push(...line.words);
            }
          }
        }
      }
    }
    
    console.log('🔍 [NUTJS] Extracted words:', {
      wordCount: words.length,
      sampleWords: words.slice(0, 5).map((w: any) => w.text),
      hasWords: words.length > 0
    });
    
    // DEBUG: Log ALL detected text with coordinates for debugging
    console.log('📊 [NUTJS-DEBUG] All detected text with coordinates:');
    words.forEach((word: any, idx: number) => {
      if (word.text && word.bbox) {
        console.log(`  [${idx}] "${word.text}" at (${word.bbox.x0}, ${word.bbox.y0}) confidence: ${word.confidence?.toFixed(2) || 'N/A'}`);
      }
    });
    
    // DEBUG: Log full OCR text for reference
    if (result.data?.text) {
      console.log('📄 [NUTJS-DEBUG] Full OCR text detected:');
      console.log(result.data.text);
    }
    
    // Find the text in OCR results
    const searchText = text.toLowerCase();
    let foundWord = null;
    
    if (!words || words.length === 0) {
      console.error('❌ [NUTJS] No words extracted from OCR:', {
        hasWords: !!words,
        wordsLength: words?.length || 0,
        dataKeys: result.data ? Object.keys(result.data) : [],
        hasText: !!result.data?.text,
        textSample: result.data?.text?.substring(0, 100)
      });
      
      return {
        success: false,
        error: `OCR failed: No word-level data available. Text found: ${!!result.data?.text}`
      };
    }
    
    console.log(`🔍 [NUTJS] Searching through ${words.length} words for "${searchText}"`);
    
    // Try exact word match first
    for (const word of words) {
      if (word.text.toLowerCase().includes(searchText)) {
        foundWord = word;
        console.log(`✅ [NUTJS] Found matching word:`, word);
        break;
      }
    }
    
    // If not found, try matching across consecutive words (for multi-word phrases)
    if (!foundWord && searchText.includes(' ')) {
      const searchWords = searchText.split(/\s+/);
      const fullText = words.map((w: any) => w.text.toLowerCase()).join(' ');
      
      if (fullText.includes(searchText)) {
        console.log(`✅ [NUTJS] Found phrase in combined text, using first word`);
        // Find the first word of the phrase
        const firstSearchWord = searchWords[0];
        for (const word of words) {
          if (word.text.toLowerCase().includes(firstSearchWord)) {
            foundWord = word;
            console.log(`✅ [NUTJS] Using first word of phrase:`, word);
            break;
          }
        }
      }
    }
    
    if (!foundWord) {
      console.warn(`⚠️ [NUTJS] Text "${text}" not found in ${words.length} OCR words`);
      console.log('📝 [NUTJS] Available text:', words.map((w: any) => w.text).join(' ').substring(0, 200));
      
      // Provide helpful hint about OCR limitations
      const looksLikePlaceholder = /ask|search|enter|type|input|message/i.test(text);
      if (looksLikePlaceholder) {
        console.warn('💡 [NUTJS] This looks like placeholder text - OCR cannot detect placeholders!');
        console.warn('💡 [NUTJS] Vision API fallback will be triggered automatically');
      }
      
      return {
        success: false,
        error: `Text "${text}" not found on screen (OCR detected ${words.length} words)`
      };
    }
    
    // Calculate center of found text
    const bbox = foundWord.bbox;
    let x = Math.floor(bbox.x0 + (bbox.x1 - bbox.x0) / 2);
    let y = Math.floor(bbox.y0 + (bbox.y1 - bbox.y0) / 2);
    
    // CRITICAL: For input fields with placeholder text, click slightly below the text
    // Placeholder text is often rendered above the actual input area
    // Context hints like "input", "field", "message", "search" indicate input fields
    const isInputField = context && /input|field|message|search|text|box|bar/i.test(context);
    if (isInputField) {
      const textHeight = bbox.y1 - bbox.y0;
      y += Math.floor(textHeight * 0.3); // Click 30% of text height below center
      console.log(`📝 [NUTJS] Input field detected - adjusting click Y offset by +${Math.floor(textHeight * 0.3)}px`);
    }
    
    console.log(`✅ [NUTJS] Found text "${text}" at (${x}, ${y})${isInputField ? ' [input field adjusted]' : ''}`);
    
    // Click at the found coordinates
    return await clickAtCoordinates(x, y);
    
  } catch (error: any) {
    console.error(`❌ [NUTJS] Text detection failed:`, error.message);
    return {
      success: false,
      error: `Text detection failed: ${error.message}`
    };
  }
}

/**
 * Find and click element using image template matching
 * Requires icon templates in /assets/icons/
 */
export async function findAndClickImage(imageName: string, context?: string): Promise<DetectionResult> {
  console.log(`🔍 [NUTJS] Finding image: "${imageName}" (context: ${context})`);
  
  // TODO: Implement image template matching
  // For now, return error - image detection requires additional image processing library
  return {
    success: false,
    error: `Image detection not yet implemented - requires image matching library`
  };
}

/**
 * Find element by coordinates (for vision API fallback)
 */
export async function clickAtCoordinates(x: number, y: number): Promise<DetectionResult> {
  console.log(`🖱️ [NUTJS] Clicking at coordinates (${x}, ${y})`);
  
  if (!ipcRenderer) {
    return {
      success: false,
      error: 'IPC not available - native automation disabled'
    };
  }
  
  try {
    return new Promise((resolve) => {
      ipcRenderer.once('automation:native-click:result', (_event: any, result: any) => {
        if (result.success) {
          console.log(`✅ [NUTJS] Clicked at (${x}, ${y})`);
          resolve({
            success: true,
            coordinates: { x, y }
          });
        } else {
          console.error(`❌ [NUTJS] Click failed:`, result.error);
          resolve({
            success: false,
            error: result.error || `Failed to click at (${x}, ${y})`
          });
        }
      });
      
      ipcRenderer.send('automation:native-click', { x, y });
    });
  } catch (error: any) {
    console.error(`❌ [NUTJS] Click failed at (${x}, ${y}):`, error.message);
    return {
      success: false,
      error: `Failed to click at (${x}, ${y})`
    };
  }
}

/**
 * Type text using keyboard
 */
export async function typeText(text: string): Promise<void> {
  console.log(`⌨️ [NUTJS] Typing text: "${text}"`);
  
  if (!ipcRenderer) {
    throw new Error('IPC not available - native automation disabled');
  }
  
  return new Promise((resolve, reject) => {
    ipcRenderer.once('automation:native-type:result', (_event: any, result: any) => {
      if (result.success) {
        console.log(`✅ [NUTJS] Text typed successfully`);
        resolve();
      } else {
        reject(new Error(result.error || 'Failed to type text'));
      }
    });
    
    ipcRenderer.send('automation:native-type', { text });
  });
}

/**
 * Press keyboard shortcut
 */
export async function pressKey(key: string, modifiers?: string[]): Promise<void> {
  console.log(`⌨️ [NUTJS] Pressing key: ${modifiers?.join('+')}+${key}`);
  
  if (!ipcRenderer) {
    throw new Error('IPC not available - native automation disabled');
  }
  
  // Build modifier array for libnut
  const mods: string[] = [];
  
  if (modifiers?.includes('Cmd') || modifiers?.includes('Command')) {
    mods.push('command');
  }
  if (modifiers?.includes('Shift')) {
    mods.push('shift');
  }
  if (modifiers?.includes('Alt') || modifiers?.includes('Option')) {
    mods.push('alt');
  }
  if (modifiers?.includes('Ctrl') || modifiers?.includes('Control')) {
    mods.push('control');
  }
  
  return new Promise((resolve, reject) => {
    ipcRenderer.once('automation:native-hotkey:result', (_event: any, result: any) => {
      if (result.success) {
        console.log(`✅ [NUTJS] Key pressed successfully`);
        resolve();
      } else {
        console.error(`❌ [NUTJS] Key press failed:`, result.error);
        reject(new Error(result.error || 'Failed to press key'));
      }
    });
    
    ipcRenderer.send('automation:native-hotkey', { key, modifiers: mods });
  });
}

/**
 * Detect element without clicking (for verification/waitForElement)
 */
export async function detect(locator: DetectionLocator): Promise<DetectionResult> {
  console.log(`🔍 [NUTJS] Detecting element (no click):`, locator);
  
  switch (locator.strategy) {
    case 'text':
      if (!locator.value) {
        return { success: false, error: 'Text value required for text strategy' };
      }
      // Use findText without clicking
      return await findText(locator.value, locator.context);
    
    case 'image':
      if (!locator.value) {
        return { success: false, error: 'Image name required for image strategy' };
      }
      // Image detection without click - not implemented yet
      return { success: false, error: 'Image detection without click not implemented' };
    
    case 'element':
      console.warn(`⚠️ [NUTJS] Element strategy not supported in fork, falling back to text`);
      if (!locator.value) {
        return { success: false, error: 'Element value required' };
      }
      return await findText(locator.value, locator.context);
    
    case 'vision':
      return { 
        success: false, 
        error: 'Vision strategy requires coordinates from backend' 
      };
    
    default:
      return { 
        success: false, 
        error: `Unknown detection strategy: ${locator.strategy}` 
      };
  }
}

/**
 * Find text on screen without clicking (for verification)
 */
async function findText(text: string, context?: string): Promise<DetectionResult> {
  console.log(`🔍 [NUTJS] Finding text (no click): "${text}" (context: ${context})`);
  
  if (!ipcRenderer) {
    return { success: false, error: 'IPC not available' };
  }
  
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ success: false, error: `Timeout finding text: ${text}` });
    }, 5000);
    
    ipcRenderer.once('automation:find-text:result', (_event: any, result: any) => {
      clearTimeout(timeout);
      resolve(result);
    });
    
    ipcRenderer.send('automation:find-text', { text, context, clickAfterFind: false });
  });
}

/**
 * Main detection handler - routes to appropriate strategy
 */
export async function detectAndClick(locator: DetectionLocator): Promise<DetectionResult> {
  console.log(`🎯 [NUTJS] Detecting element:`, locator);
  
  switch (locator.strategy) {
    case 'text':
      if (!locator.value) {
        return { success: false, error: 'Text value required for text strategy' };
      }
      return await findAndClickText(locator.value, locator.context);
    
    case 'image':
      if (!locator.value) {
        return { success: false, error: 'Image name required for image strategy' };
      }
      return await findAndClickImage(locator.value, locator.context);
    
    case 'element':
      // Element strategy requires @nut-tree/element-inspector (not in fork)
      // Fall back to text strategy for now
      console.warn(`⚠️ [NUTJS] Element strategy not supported in fork, falling back to text`);
      if (!locator.value) {
        return { success: false, error: 'Element value required' };
      }
      return await findAndClickText(locator.value, locator.context);
    
    case 'vision':
      // Vision strategy should have coordinates already resolved by backend
      return { 
        success: false, 
        error: 'Vision strategy requires coordinates from backend' 
      };
    
    default:
      return { 
        success: false, 
        error: `Unknown detection strategy: ${locator.strategy}` 
      };
  }
}
                                                                      