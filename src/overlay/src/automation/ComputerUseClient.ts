/**
 * Computer Use Client
 * 
 * WebSocket client for agentic Computer Use automation
 * Connects directly to backend, bypassing MCP command service
 */

import * as capabilities from './capabilities';
import type { DetectionLocator } from './nutjs-detector';

export interface ComputerUseAction {
  type: string;
  reasoning?: string;
  locator?: DetectionLocator;  // NEW: Native detection locator (text/image/element strategies)
  coordinates?: { x: number; y: number };  // LEGACY: Vision API coordinates
  
  // clickAndDrag action fields
  fromLocator?: DetectionLocator;
  toLocator?: DetectionLocator;
  
  // zoom action fields
  zoomDirection?: 'in' | 'out';
  zoomLevel?: number;
  
  [key: string]: any;
}

export interface ClarificationQuestion {
  id: string;
  question: string;
  type?: 'text' | 'choice';
  choices?: string[];
  required?: boolean;
}

export interface ComputerUseTiming {
  llmDecisionMs?: number;
  totalProcessingMs?: number;
  timeSinceLastActionMs?: number;
  timestamp?: number;
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
  timing?: ComputerUseTiming;
}

export interface ComputerUseCallbacks {
  onAction?: (action: ComputerUseAction, iteration: number, timing?: ComputerUseTiming) => void;
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
  private activeApp: string | null = null;  // Track active app from focusApp
  private lastActionUsedVisionAPI: boolean = false;  // Track if last action used Vision API screenshot
  private capturedScreenshot: string | null = null; // Store screenshot captured during action execution
  
  // Session persistence for conversation history
  private static sessionId: string = `session-${Date.now()}`;
  private static conversationHistory: Array<{ timestamp: number; goal: string; completed: boolean }> = [];

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
          
          // Hide system cursor during automation
          capabilities.hideSystemCursor();
          
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
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('🔌 [COMPUTER-USE] WebSocket closed');
        };
      } catch (error: any) {
        console.error('❌ [COMPUTER-USE] Failed to connect:', error);
        this.callbacks.onError?.(error.message);
        reject(error);
      }
    });
  }
  
  /**
   * Execute automation task with a pre-generated plan (hybrid approach)
   */
  async executeWithPlan(
    plan: any,
    initialScreenshot: string | null,
    context: any,
    callbacks: ComputerUseCallbacks
  ): Promise<void> {
    this.goal = plan.goal || 'Execute automation plan';
    this.context = context;
    this.callbacks = callbacks;
    this.initialScreenshot = initialScreenshot;
    this.iteration = 0;

    return new Promise((resolve, reject) => {
      try {
        console.log('🌐 [COMPUTER-USE] Connecting to WebSocket with plan:', this.wsUrl);
        console.log('📋 [COMPUTER-USE] Plan:', plan);
        this.ws = new WebSocket(this.wsUrl);

        this.ws.onopen = () => {
          console.log('✅ [COMPUTER-USE] WebSocket connected');
          this.sendInitWithPlan(plan);
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
    console.log('📤 [COMPUTER-USE] Sending start message');
    
    // Add current goal to conversation history
    ComputerUseClient.conversationHistory.push({
      timestamp: Date.now(),
      goal: this.goal,
      completed: false
    });
    
    console.log(`📚 [COMPUTER-USE] Conversation history (${ComputerUseClient.conversationHistory.length} items):`, 
      ComputerUseClient.conversationHistory.map(h => ({
        goal: h.goal.substring(0, 50) + '...',
        completed: h.completed,
        age: `${Math.floor((Date.now() - h.timestamp) / 1000)}s ago`
      }))
    );
    
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
      context: {
        ...this.context,
        sessionId: ComputerUseClient.sessionId,
        conversationHistory: ComputerUseClient.conversationHistory
      },
      screenshot: initialScreenshotBase64 || undefined
    };

    this.send(message);
  }
  
  /**
   * Send initial message with pre-generated plan (hybrid approach)
   */
  private sendInitWithPlan(plan: any): void {
    console.log('📤 [COMPUTER-USE] Sending start_with_plan message');
    console.log('📋 [COMPUTER-USE] Plan details:', {
      planId: plan.planId,
      goal: plan.goal,
      stepsCount: plan.steps?.length || 0
    });
    
    // Add current goal to conversation history
    ComputerUseClient.conversationHistory.push({
      timestamp: Date.now(),
      goal: this.goal,
      completed: false
    });
    
    // Strip data URL prefix from initial screenshot if present
    let initialScreenshotBase64 = this.initialScreenshot;
    if (initialScreenshotBase64 && initialScreenshotBase64.startsWith('data:')) {
      const base64Index = initialScreenshotBase64.indexOf('base64,');
      if (base64Index !== -1) {
        initialScreenshotBase64 = initialScreenshotBase64.substring(base64Index + 7);
      }
    }
    
    const message: any = {
      type: 'start_with_plan',
      plan: plan,
      goal: this.goal,
      context: {
        ...this.context,
        sessionId: ComputerUseClient.sessionId,
        conversationHistory: ComputerUseClient.conversationHistory
      },
      screenshot: initialScreenshotBase64 || undefined,
      maxIterations: 50
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
        await this.handleAction(message.action!, message.iteration || this.iteration, message.timing);
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
  private async handleAction(action: ComputerUseAction, iteration: number, timing?: ComputerUseTiming): Promise<void> {
    console.log(`🎬 [COMPUTER-USE] Executing action (iteration ${iteration}):`, action.type);
    
    this.iteration = iteration;
    
    // Log timing data if available
    if (timing) {
      console.log('⏱️ [COMPUTER-USE] Timing data:', {
        llmDecision: timing.llmDecisionMs ? `${(timing.llmDecisionMs / 1000).toFixed(2)}s` : 'N/A',
        totalProcessing: timing.totalProcessingMs ? `${(timing.totalProcessingMs / 1000).toFixed(2)}s` : 'N/A',
        frontendExecution: timing.timeSinceLastActionMs ? `${(timing.timeSinceLastActionMs / 1000).toFixed(2)}s` : 'N/A'
      });
    }
    
    this.callbacks.onAction?.(action, iteration, timing);

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
        
        // Mark current goal as completed in conversation history
        const currentGoalIndex = ComputerUseClient.conversationHistory.findIndex(
          h => h.goal === this.goal && !h.completed
        );
        if (currentGoalIndex !== -1) {
          ComputerUseClient.conversationHistory[currentGoalIndex].completed = true;
          console.log(`✅ [COMPUTER-USE] Marked goal as completed in history: "${this.goal.substring(0, 50)}..."`);
        }
        
        this.callbacks.onComplete?.({ reason: action.reasoning });
        this.close();
        return;
      }

      // Determine how to respond to backend based on action type
      const shouldSkipScreenshot = this.shouldSkipScreenshot(action.type);
      
      if (shouldSkipScreenshot) {
        // Actions that don't change UI - send acknowledgment without screenshot
        console.log(`⏭️  [COMPUTER-USE] Action ${action.type} complete - no screenshot needed`);
        this.sendActionComplete(iteration + 1);
        return;
      }

      // If screenshot was already captured during action execution, use it
      let screenshot: string;
      if (this.capturedScreenshot) {
        console.log(`📸 [COMPUTER-USE] Using screenshot captured during ${action.type} action`);
        screenshot = this.capturedScreenshot;
        this.capturedScreenshot = null; // Clear after use
      } else {
        // Wait for UI to actually change after action
        screenshot = await this.waitForUIChange(action.type);
      }

      this.sendScreenshot(screenshot, iteration + 1);
    } catch (error: any) {
      console.error('❌ [COMPUTER-USE] Action execution failed:', error.message);
      this.callbacks.onError?.(error.message);
      this.close();
    }
  }

  /**
   * Determine if we should skip screenshot capture after this action
   */
  private shouldSkipScreenshot(actionType: string): boolean {
    // Actions that don't change UI state and don't need screenshots
    const noUIChangeActions = ['pause', 'log'];
    
    // If this action used Vision API, we already have a screenshot
    if (this.lastActionUsedVisionAPI) {
      console.log(`📸 [COMPUTER-USE] Skipping duplicate screenshot - Vision API already captured one`);
      this.lastActionUsedVisionAPI = false;  // Reset flag
      return true;
    }
    
    return noUIChangeActions.includes(actionType);
  }

  /**
   * Execute action using existing capabilities
   */
  private async executeAction(action: ComputerUseAction): Promise<void> {
    const { type } = action;
    
    // Reset flags at start of each action
    this.lastActionUsedVisionAPI = false;
    this.capturedScreenshot = null;

    switch (type) {
      case 'focusApp':
        console.log(`🎯 [COMPUTER-USE] Focusing app: ${action.appName}`);
        const actualApp = await capabilities.focusApp(action.appName);
        // Use the requested app name, not the actual process name, since backend LLM knows the requested name
        // (e.g., Warp's process name is "stable" but LLM expects "Warp")
        this.activeApp = action.appName;
        console.log(`✅ [COMPUTER-USE] Actually focused: ${actualApp} (tracking as: ${action.appName})`);
        
        // Wait for app window to stabilize and be fully rendered
        await capabilities.waitForAppStability(action.appName, 3000);
        // const isFullscreen = await capabilities.checkFullscreen(action.appName);
        // console.log(`🔍 [COMPUTER-USE] ${action.appName} fullscreen status: ${isFullscreen}`);
        
        // if (!isFullscreen) {
        //   console.log(`📺 [COMPUTER-USE] Entering fullscreen for ${action.appName}`);
        //   await capabilities.fullscreen();
          
        //   // Re-focus the app after fullscreen to ensure it stays focused
        //   await capabilities.wait(300);
        //   await capabilities.focusApp(action.appName);
        //   await capabilities.wait(300);
        // } else {
        //   console.log(`✅ [COMPUTER-USE] ${action.appName} already in fullscreen, skipping toggle`);
        // }
        break;

      case 'fullscreen':
        console.log('🖥️ [COMPUTER-USE] Fullscreening active application');
        await capabilities.fullscreen();
        break;

      case 'openUrl':
        await capabilities.openUrl(action.url);
        // Wait for browser page to finish loading before taking screenshot
        await capabilities.waitForPageLoad(10000);
        break;

      case 'findAndClick':
        // PRIORITY 1: Use backend-provided coordinates (backend already detected via OmniParser)
        if (action.coordinates) {
          console.log(`🎯 [COMPUTER-USE] Using backend-provided coordinates: (${action.coordinates.x}, ${action.coordinates.y})`);
          console.log(`✅ [COMPUTER-USE] No Vision API call needed - backend already detected element`);
          
          // Show ghost cursor and click
          capabilities.sendGhostMouseMove(action.coordinates.x, action.coordinates.y);
          await capabilities.wait(500);
          capabilities.sendGhostMouseClick(action.coordinates.x, action.coordinates.y);
          await capabilities.clickAt(action.coordinates.x, action.coordinates.y);
        }
        // PRIORITY 2: Fallback to native detection if no coordinates provided
        else if (action.locator) {
          console.log(`⚠️ [COMPUTER-USE] No coordinates provided by backend, using native detection:`, action.locator);
          const result = await capabilities.findAndClickElement(action.locator);
          
          if (!result.success) {
            throw new Error(result.error || 'Failed to find and click element');
          }
          
          // Check if Vision API was used (fallback scenario)
          if (result.usedVisionAPI) {
            console.log(`📸 [COMPUTER-USE] Vision API was used as fallback - marking to skip duplicate screenshot`);
            this.lastActionUsedVisionAPI = true;
          }
          
          // Show ghost cursor at detected position
          if (result.coordinates) {
            capabilities.sendGhostMouseMove(result.coordinates.x, result.coordinates.y);
            await capabilities.wait(300);
            capabilities.sendGhostMouseClick(result.coordinates.x, result.coordinates.y);
          }
        } else {
          console.error('❌ [COMPUTER-USE] findAndClick action missing both locator and coordinates');
          throw new Error('findAndClick requires either locator or coordinates');
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
        // Ensure activeApp is focused before typing
        if (this.activeApp) {
          console.log(`🎯 [COMPUTER-USE] Ensuring ${this.activeApp} is focused before typing`);
          await capabilities.focusApp(this.activeApp);
          await capabilities.wait(500); // Increased wait for focus to fully transfer
        }
        await capabilities.typeText(action.text, action.submit);
        break;

      case 'pressKey':
        // Ensure activeApp is focused before pressing keys (critical for Cmd+Q)
        if (this.activeApp) {
          console.log(`🎯 [COMPUTER-USE] Ensuring ${this.activeApp} is focused before pressKey`);
          await capabilities.focusApp(this.activeApp);
          await capabilities.wait(500); // Increased wait for focus to fully transfer
        }
        
        // Special handling for selection operations (Cmd+A) - need extra time for UI to update
        const isCmdA = action.modifiers?.includes('Cmd') && action.key?.toLowerCase() === 'a';
        const isCmdQ = action.modifiers?.includes('Cmd') && action.key?.toLowerCase() === 'q';
        
        // Backend sends: { key: "q", modifiers: ["Cmd"] }
        if (action.modifiers && action.modifiers.length > 0) {
          await capabilities.pressHotkey([...action.modifiers, action.key]);
        } else {
          await capabilities.pressHotkey([action.key]);
        }
        
        // Add extra wait for Cmd+A to ensure selection completes
        if (isCmdA) {
          console.log(`📝 [COMPUTER-USE] Cmd+A detected, adding extra wait for selection to complete`);
          await capabilities.wait(400); // Extra wait for selection to visually complete
        }
        
        // If this was Cmd+Q, clear activeApp
        if (isCmdQ) {
          console.log(`🚪 [COMPUTER-USE] Cmd+Q detected, clearing activeApp`);
          this.activeApp = null;
        }
        break;
        
      case 'hotkey':
        // Ensure activeApp is focused before hotkey (critical for Cmd+Q)
        if (this.activeApp) {
          console.log(`🎯 [COMPUTER-USE] Ensuring ${this.activeApp} is focused before hotkey`);
          await capabilities.focusApp(this.activeApp);
          await capabilities.wait(500); // Increased wait for focus to fully transfer
        }
        await capabilities.pressHotkey(action.keys || [action.key]);
        // If this was Cmd+Q, clear activeApp
        const keys = action.keys || [action.key];
        if (keys.includes('Cmd') && keys.some((k: string) => k.toLowerCase() === 'q')) {
          console.log(`🚪 [COMPUTER-USE] Cmd+Q detected, clearing activeApp`);
          this.activeApp = null;
        }
        break;

      case 'scroll':
        await capabilities.scroll(action.amount || 3, action.direction || 'down');
        break;

      case 'pause':
        await capabilities.wait(action.ms || 1000);
        break;

      case 'screenshot':
        // Capture and store screenshot for sending to backend
        this.capturedScreenshot = await capabilities.captureScreenshot();
        break;

      case 'waitForElement':
        // Wait for element to appear using Vision API verification
        console.log(`⏳ [COMPUTER-USE] Waiting for element:`, action.locator);
        
        if (!action.locator || !action.locator.description) {
          throw new Error('waitForElement requires a locator with description');
        }
        
        const timeout = action.timeout || 10000; // Default 10s timeout
        const startTime = Date.now();
        let found = false;
        
        while (Date.now() - startTime < timeout) {
          try {
            // Use verifyStepWithVision to check if element is visible
            const result = await capabilities.verifyStepWithVision(
              action.locator.description, // expectedState - what we're waiting for
              `Waiting for element: ${action.locator.description}` // stepDescription
            );
            
            if (result.verified && result.confidence > 0.7) {
              console.log(`✅ [COMPUTER-USE] Element found after ${Date.now() - startTime}ms (confidence: ${result.confidence})`);
              console.log(`📝 [COMPUTER-USE] Reasoning: ${result.reasoning}`);
              found = true;
              break;
            } else {
              console.log(`⏳ [COMPUTER-USE] Element not yet visible (confidence: ${result.confidence}) - ${result.reasoning}`);
            }
          } catch (error) {
            // Element not found yet, continue waiting
            console.log(`⏳ [COMPUTER-USE] Verification failed, retrying...`);
          }
          
          await capabilities.wait(500); // Check every 500ms
        }
        
        if (!found) {
          throw new Error(`Element not found after ${timeout}ms: ${action.locator.description}`);
        }
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

      case 'clickAndDrag':
        // Drag from one element to another
        console.log(`🎯 [COMPUTER-USE] Executing clickAndDrag`);
        
        if (!action.fromLocator || !action.toLocator) {
          throw new Error('clickAndDrag requires both fromLocator and toLocator');
        }
        
        const dragResult = await capabilities.clickAndDrag(action.fromLocator, action.toLocator);
        
        if (!dragResult.success) {
          throw new Error(dragResult.error || 'Failed to execute clickAndDrag');
        }
        
        // Check if Vision API was used
        if (dragResult.usedVisionAPI) {
          console.log(`📸 [COMPUTER-USE] clickAndDrag used Vision API - marking to skip duplicate screenshot`);
          this.lastActionUsedVisionAPI = true;
        }
        
        // Show ghost cursor at destination
        if (dragResult.coordinates) {
          capabilities.sendGhostMouseMove(dragResult.coordinates.x, dragResult.coordinates.y);
          await capabilities.wait(300);
        }
        break;

      case 'zoom':
        // Zoom in/out on content
        console.log(`🔍 [COMPUTER-USE] Executing zoom ${action.zoomDirection}`);
        
        if (!action.zoomDirection) {
          throw new Error('zoom requires zoomDirection (in/out)');
        }
        
        await capabilities.zoom(
          action.zoomDirection,
          action.zoomLevel,
          this.activeApp || undefined
        );
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

    // Calculate hash for backend comparison
    const screenshotHash = this.hashScreenshot(screenshot);
    console.log(`🔍 [COMPUTER-USE] Screenshot hash: ${screenshotHash.substring(0, 16)}...`);

    const message: ComputerUseMessage = {
      type: 'screenshot',
      screenshot: {
        base64: base64Data,
        mimeType: 'image/png'
      },
      iteration,
      goal: this.goal,
      context: {
        ...this.context,
        screenshotHash,  // Include hash for backend comparison
        activeApp: this.activeApp || undefined  // Send current active app to backend
      }
    };

    console.log(`📤 [COMPUTER-USE] Sending context to backend:`, {
      activeApp: this.activeApp,
      iteration,
      hasScreenshot: true
    });

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
   * Send action complete acknowledgment to backend (no screenshot needed)
   */
  private sendActionComplete(iteration: number): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('❌ [COMPUTER-USE] Cannot send action complete - WebSocket not connected');
      return;
    }

    console.log(`✅ [COMPUTER-USE] Sending action complete acknowledgment (iteration ${iteration})`);
    
    this.ws.send(JSON.stringify({
      type: 'action_complete',
      iteration
    }));
  }

  /**
   * Close WebSocket connection
   */
  close(): void {
    if (this.ws) {
      console.log('🔌 [COMPUTER-USE] Closing WebSocket');
      
      // Show system cursor when automation ends
      capabilities.showSystemCursor();
      
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
