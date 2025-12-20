/**
 * Computer Use Client
 * 
 * WebSocket client for agentic Computer Use automation
 * Connects directly to backend, bypassing MCP command service
 */

import * as capabilities from './capabilities';

export interface ComputerUseAction {
  type: string;
  reasoning?: string;
  [key: string]: any;
}

export interface ClarificationQuestion {
  id: string;
  question: string;
  type?: 'text' | 'choice';
  choices?: string[];
  required?: boolean;
}

export interface ComputerUseMessage {
  type: 'start' | 'screenshot' | 'action' | 'complete' | 'error' | 'status' | 'clarification' | 'clarification_needed' | 'clarification_answer';
  goal?: string;
  screenshot?: string | { base64: string; mimeType: string };
  action?: ComputerUseAction;
  iteration?: number;
  message?: string;
  error?: string;
  result?: any;
  context?: any;
  questions?: ClarificationQuestion[];
  answers?: Record<string, string>;
}

export interface ComputerUseCallbacks {
  onAction?: (action: ComputerUseAction, iteration: number) => void;
  onComplete?: (result: any) => void;
  onError?: (error: string) => void;
  onStatus?: (message: string) => void;
  onClarificationNeeded?: (questions: ClarificationQuestion[], iteration: number) => Promise<Record<string, string>>;
}

export class ComputerUseClient {
  private ws: WebSocket | null = null;
  private goal: string = '';
  private iteration: number = 0;
  private callbacks: ComputerUseCallbacks = {};
  private context: any = {};
  private initialScreenshot: string | null = null;
  private maxIterations: number = 20;
  private lastScreenshotHash: string | null = null;

  constructor(private wsUrl: string) {}

  /**
   * Execute automation task using Computer Use agentic loop
   */
  async execute(
    goal: string,
    initialScreenshot: string | null,
    context: any,
    callbacks: ComputerUseCallbacks
  ): Promise<void> {
    this.goal = goal;
    this.context = context;
    this.callbacks = callbacks;
    this.initialScreenshot = initialScreenshot;
    this.iteration = 0;

    return new Promise((resolve, reject) => {
      try {
        console.log('🌐 [COMPUTER-USE] Connecting to WebSocket:', this.wsUrl);
        this.ws = new WebSocket(this.wsUrl);

        this.ws.onopen = () => {
          console.log('✅ [COMPUTER-USE] WebSocket connected');
          this.sendInit();
        };

        this.ws.onmessage = async (event) => {
          try {
            console.log('🔍 [COMPUTER-USE] Raw WebSocket message received:', event.data);
            const message: ComputerUseMessage = JSON.parse(event.data);
            console.log('📦 [COMPUTER-USE] Parsed message:', JSON.stringify(message, null, 2));
            await this.handleMessage(message);

            // Resolve on complete
            if (message.type === 'complete') {
              resolve();
            }
          } catch (error: any) {
            console.error('❌ [COMPUTER-USE] Error handling message:', error);
            this.callbacks.onError?.(error.message);
            reject(error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('❌ [COMPUTER-USE] WebSocket error:', error);
          this.callbacks.onError?.('WebSocket connection error');
          reject(new Error('WebSocket connection error'));
        };

        this.ws.onclose = () => {
          console.log('🔌 [COMPUTER-USE] WebSocket closed');
        };
      } catch (error: any) {
        console.error('❌ [COMPUTER-USE] Failed to connect:', error);
        reject(error);
      }
    });
  }

  /**
   * Send initialization message with goal
   */
  private sendInit(): void {
    console.log('📤 [COMPUTER-USE] Sending start message:', this.goal);
    
    // Strip data URL prefix from initial screenshot if present
    let initialScreenshotBase64 = this.initialScreenshot;
    if (initialScreenshotBase64 && initialScreenshotBase64.startsWith('data:')) {
      const base64Index = initialScreenshotBase64.indexOf('base64,');
      if (base64Index !== -1) {
        initialScreenshotBase64 = initialScreenshotBase64.substring(base64Index + 7);
      }
    }
    
    const message: ComputerUseMessage = {
      type: 'start',
      goal: this.goal,
      context: this.context,
      screenshot: initialScreenshotBase64 || undefined
    };

    this.send(message);
  }

  /**
   * Handle incoming WebSocket message
   */
  private async handleMessage(message: ComputerUseMessage): Promise<void> {
    console.log('📥 [COMPUTER-USE] Received message:', message.type);
    console.log('📋 [COMPUTER-USE] Message details:', {
      type: message.type,
      hasQuestions: !!message.questions,
      questionsCount: message.questions?.length || 0,
      hasAction: !!message.action,
      iteration: message.iteration
    });

    switch (message.type) {
      case 'action':
        await this.handleAction(message.action!, message.iteration || this.iteration);
        break;

      case 'clarification':
      case 'clarification_needed':
        await this.handleClarification(message.questions!, message.iteration || this.iteration);
        break;

      case 'complete':
        console.log('✅ [COMPUTER-USE] Task complete:', message.result);
        this.callbacks.onComplete?.(message.result);
        this.close();
        break;

      case 'error':
        console.error('❌ [COMPUTER-USE] Backend error:', message.error);
        this.callbacks.onError?.(message.error || 'Unknown error');
        this.close();
        break;

      case 'status':
        console.log('ℹ️ [COMPUTER-USE] Status:', message.message);
        this.callbacks.onStatus?.(message.message || '');
        break;

      default:
        console.warn('⚠️ [COMPUTER-USE] Unknown message type:', message.type);
    }
  }

  /**
   * Handle clarification request from backend
   */
  private async handleClarification(questions: ClarificationQuestion[], iteration: number): Promise<void> {
    console.log(`❓ [COMPUTER-USE] handleClarification called`);
    console.log(`❓ [COMPUTER-USE] Iteration: ${iteration}`);
    console.log(`❓ [COMPUTER-USE] Questions:`, JSON.stringify(questions, null, 2));
    
    this.iteration = iteration;

    if (!this.callbacks.onClarificationNeeded) {
      console.error('❌ [COMPUTER-USE] No clarification callback registered');
      this.callbacks.onError?.('Clarification needed but no callback registered');
      this.close();
      return;
    }

    try {
      // Ask UI to prompt user for answers
      const answers = await this.callbacks.onClarificationNeeded(questions, iteration);
      
      console.log('📤 [COMPUTER-USE] Sending clarification answers:', answers);

      // Send answers back to backend
      const message: ComputerUseMessage = {
        type: 'clarification_answer',
        answers,
        iteration,
        goal: this.goal,
        context: this.context
      };

      this.send(message);
    } catch (error: any) {
      console.error('❌ [COMPUTER-USE] Clarification failed:', error.message);
      this.callbacks.onError?.(error.message);
      this.close();
    }
  }

  /**
   * Handle action from backend
   */
  private async handleAction(action: ComputerUseAction, iteration: number): Promise<void> {
    console.log(`🎬 [COMPUTER-USE] Executing action (iteration ${iteration}):`, action.type);
    
    this.iteration = iteration;
    this.callbacks.onAction?.(action, iteration);

    // Check if max iterations reached
    if (iteration >= this.maxIterations) {
      console.error(`❌ [COMPUTER-USE] Max iterations (${this.maxIterations}) reached`);
      this.callbacks.onError?.(`Max iterations (${this.maxIterations}) reached`);
      this.close();
      return;
    }

    // Execute action using existing capabilities
    try {
      await this.executeAction(action);

      // If action is 'end', we're done
      if (action.type === 'end') {
        console.log('✅ [COMPUTER-USE] End action received:', action.reasoning);
        this.callbacks.onComplete?.({ reason: action.reasoning });
        this.close();
        return;
      }

      // Wait for UI to actually change after action
      const screenshot = await this.waitForUIChange(action.type);

      this.sendScreenshot(screenshot, iteration + 1);
    } catch (error: any) {
      console.error('❌ [COMPUTER-USE] Action execution failed:', error.message);
      this.callbacks.onError?.(error.message);
      this.close();
    }
  }

  /**
   * Execute action using existing capabilities
   */
  private async executeAction(action: ComputerUseAction): Promise<void> {
    const { type } = action;

    switch (type) {
      case 'fullscreen':
        console.log('🖥️ [COMPUTER-USE] Fullscreening active application');
        await capabilities.fullscreen();
        break;

      case 'focusApp':
        console.log(`🎯 [COMPUTER-USE] Focusing app: ${action.appName}`);
        await capabilities.focusApp(action.appName);
        
        // Automatically fullscreen after focusing app
        console.log('🖥️ [COMPUTER-USE] Auto-fullscreening after focus');
        await capabilities.wait(500); // Wait for app to focus
        await capabilities.fullscreen();
        break;

      case 'openUrl':
        await capabilities.openUrl(action.url);
        break;

      case 'findAndClick':
        // Backend should convert findAndClick to click action with coordinates
        // If we receive findAndClick here, backend has already resolved coordinates
        if (action.coordinates) {
          console.log(`🎯 [COMPUTER-USE] Executing findAndClick at (${action.coordinates.x}, ${action.coordinates.y})`);
          capabilities.sendGhostMouseMove(action.coordinates.x, action.coordinates.y);
          await capabilities.wait(800);
          capabilities.sendGhostMouseClick(action.coordinates.x, action.coordinates.y);
          await capabilities.clickAt(action.coordinates.x, action.coordinates.y);
        } else {
          console.error('❌ [COMPUTER-USE] findAndClick action missing coordinates - backend should provide them');
        }
        break;

      case 'click':
        if (action.coordinates) {
          capabilities.sendGhostMouseMove(action.coordinates.x, action.coordinates.y);
          await capabilities.wait(500);
          capabilities.sendGhostMouseClick(action.coordinates.x, action.coordinates.y);
          await capabilities.clickAt(action.coordinates.x, action.coordinates.y);
        }
        break;

      case 'typeText':
        await capabilities.typeText(action.text, action.submit);
        break;

      case 'pressKey':
      case 'hotkey':
        await capabilities.pressHotkey(action.keys || [action.key]);
        break;

      case 'scroll':
        await capabilities.scroll(action.amount || 3, action.direction || 'down');
        break;

      case 'pause':
        await capabilities.wait(action.ms || 1000);
        break;

      case 'screenshot':
        await capabilities.captureScreenshot();
        break;

      case 'log':
        // Backend sends log messages (e.g., Vision API failures, self-learning suggestions)
        const level = action.level || 'info';
        const logMessage = action.message || 'No message';
        
        if (level === 'error') {
          console.error(`❌ [COMPUTER-USE] Backend log:`, logMessage);
        } else if (level === 'warn') {
          console.warn(`⚠️ [COMPUTER-USE] Backend log:`, logMessage);
        } else {
          console.log(`ℹ️ [COMPUTER-USE] Backend log:`, logMessage);
        }
        
        // Notify UI callback if available
        this.callbacks.onStatus?.(logMessage);
        break;

      case 'end':
        console.log('🏁 [COMPUTER-USE] End action - task complete');
        break;

      default:
        console.warn('⚠️ [COMPUTER-USE] Unknown action type:', type);
    }
  }

  /**
   * Send screenshot to backend for analysis
   */
  private sendScreenshot(screenshot: string, iteration: number): void {
    console.log(`📤 [COMPUTER-USE] Sending screenshot (iteration ${iteration})`);

    // Strip data URL prefix if present (e.g., "data:image/png;base64,")
    let base64Data = screenshot;
    if (screenshot.startsWith('data:')) {
      const base64Index = screenshot.indexOf('base64,');
      if (base64Index !== -1) {
        base64Data = screenshot.substring(base64Index + 7);
      }
    }

    const message: ComputerUseMessage = {
      type: 'screenshot',
      screenshot: {
        base64: base64Data,
        mimeType: 'image/png'
      },
      iteration,
      goal: this.goal,
      context: this.context
    };

    this.send(message);
  }

  /**
   * Send message to WebSocket
   */
  private send(message: ComputerUseMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.error('❌ [COMPUTER-USE] WebSocket not open, cannot send message');
    }
  }

  /**
   * Wait for UI to actually change after an action by comparing screenshots
   * Uses progressive waits and hash comparison to detect real changes
   */
  private async waitForUIChange(actionType: string): Promise<string> {
    const config = this.getWaitConfig(actionType);
    let totalWait = 0;
    let attempts = 0;
    const maxAttempts = config.maxAttempts;

    console.log(`⏳ [COMPUTER-USE] Waiting for UI change after ${actionType}`);

    while (attempts < maxAttempts) {
      // Initial wait before first check
      const waitTime = attempts === 0 ? config.initialWait : config.retryWait;
      await capabilities.wait(waitTime);
      totalWait += waitTime;

      // Capture screenshot
      const screenshot = await capabilities.captureScreenshot();
      const screenshotHash = this.hashScreenshot(screenshot);

      console.log(`📸 [COMPUTER-USE] Screenshot check #${attempts + 1}`, {
        hash: screenshotHash.substring(0, 16),
        totalWait: `${totalWait}ms`,
        changed: screenshotHash !== this.lastScreenshotHash
      });

      // Check if screenshot has changed from last iteration
      if (this.lastScreenshotHash === null || screenshotHash !== this.lastScreenshotHash) {
        console.log(`✅ [COMPUTER-USE] UI changed detected after ${totalWait}ms`);
        this.lastScreenshotHash = screenshotHash;
        return screenshot;
      }

      attempts++;

      // If we've reached max attempts, return anyway to avoid infinite loop
      if (attempts >= maxAttempts) {
        console.warn(`⚠️ [COMPUTER-USE] UI unchanged after ${totalWait}ms, proceeding anyway`);
        this.lastScreenshotHash = screenshotHash;
        return screenshot;
      }
    }

    // Fallback (should never reach here)
    const screenshot = await capabilities.captureScreenshot();
    this.lastScreenshotHash = this.hashScreenshot(screenshot);
    return screenshot;
  }

  /**
   * Get wait configuration for different action types
   */
  private getWaitConfig(actionType: string): { initialWait: number; retryWait: number; maxAttempts: number } {
    switch (actionType) {
      case 'openUrl':
        return { initialWait: 1500, retryWait: 500, maxAttempts: 6 }; // Up to 4s total
      case 'focusApp':
        return { initialWait: 1000, retryWait: 300, maxAttempts: 4 }; // Up to 1.9s total
      case 'fullscreen':
        return { initialWait: 800, retryWait: 200, maxAttempts: 3 }; // Up to 1.2s total
      case 'click':
      case 'findAndClick':
        return { initialWait: 500, retryWait: 200, maxAttempts: 3 }; // Up to 0.9s total
      case 'typeText':
        return { initialWait: 300, retryWait: 150, maxAttempts: 3 }; // Up to 0.6s total
      case 'scroll':
        return { initialWait: 300, retryWait: 100, maxAttempts: 2 }; // Up to 0.4s total
      case 'pressKey':
      case 'hotkey':
        return { initialWait: 200, retryWait: 100, maxAttempts: 2 }; // Up to 0.3s total
      default:
        return { initialWait: 500, retryWait: 200, maxAttempts: 3 }; // Up to 0.9s total
    }
  }

  /**
   * Create a simple hash of screenshot for comparison
   * Uses first 1KB and length to detect changes without full comparison
   */
  private hashScreenshot(screenshot: string): string {
    const sample = screenshot.substring(0, 1024);
    return `${sample.length}-${screenshot.length}-${sample}`;
  }

  /**
   * Close WebSocket connection
   */
  close(): void {
    if (this.ws) {
      console.log('🔌 [COMPUTER-USE] Closing WebSocket');
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}
