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
  locator?: DetectionLocator;  // LEGACY: Native detection locator (text/image/element strategies)
  coordinates?: { x: number; y: number };  // LEGACY: Vision API coordinates
  selector?: any;  // NEW: Multi-driver semantic selector (css, xpath, axRole, etc.)
  
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
  type: 'start' | 'screenshot' | 'action' | 'complete' | 'error' | 'status' | 'clarification' | 'clarification_needed' | 'clarification_answer' | 'execute_intent' | 'action_complete' | 'intent_complete' | 'intent_failed' | 'execute_action' | 'pause' | 'resume' | 'stop' | 'paused' | 'resumed' | 'stopped';
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
  sessionId?: string;
  requestId?: string;
  data?: any;
  stepId?: string; // For intent-driven mode: step ID from backend
  actionResult?: { // For intent-driven mode: action result to send back to backend
    actionType: string;
    success: boolean;
    timestamp?: number;
    error?: string;
    metadata?: any;
  };
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

  constructor(private wsUrl: string) {
    // Initialize multi-driver system
    this.initializeDrivers();
  }
  
  /**
   * Initialize multi-driver automation system
   */
  private async initializeDrivers(): Promise<void> {
    try {
      console.log('🚀 [COMPUTER-USE] Initializing multi-driver system');
      await capabilities.initializeDrivers();
      console.log('✅ [COMPUTER-USE] Multi-driver system ready');
    } catch (error: any) {
      console.warn('⚠️ [COMPUTER-USE] Multi-driver initialization failed, will use legacy mode:', error.message);
    }
  }

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
        // PRIORITY 1: Multi-driver semantic selector (NEW - high reliability)
        if (action.selector && (action.selector.css || action.selector.xpath || action.selector.role || 
            action.selector.axRole || action.selector.uiaType)) {
          console.log(`🌐 [COMPUTER-USE] Using multi-driver system with selector:`, action.selector);
          const smartResult = await capabilities.smartFindAndClick(action.selector);
          
          if (!smartResult.success) {
            throw new Error(smartResult.error || 'Multi-driver click failed');
          }
          
          console.log(`✅ [COMPUTER-USE] Clicked using ${smartResult.driver} driver`);
        }
        // PRIORITY 2: Legacy backend-provided coordinates (vision-based)
        else if (action.coordinates) {
          console.log(`🎯 [COMPUTER-USE] LEGACY: Using backend-provided coordinates: (${action.coordinates.x}, ${action.coordinates.y})`);
          console.log(`✅ [COMPUTER-USE] No Vision API call needed - backend already detected element`);
          
          // Show ghost cursor and click
          capabilities.sendGhostMouseMove(action.coordinates.x, action.coordinates.y);
          await capabilities.wait(500);
          capabilities.sendGhostMouseClick(action.coordinates.x, action.coordinates.y);
          await capabilities.clickAt(action.coordinates.x, action.coordinates.y);
        }
        // PRIORITY 3: Legacy native detection fallback
        else if (action.locator) {
          console.log(`⚠️ [COMPUTER-USE] LEGACY: No coordinates provided by backend, using native detection:`, action.locator);
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
          console.error('❌ [COMPUTER-USE] findAndClick action missing selector, locator, and coordinates');
          throw new Error('findAndClick requires either selector, locator, or coordinates');
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
        console.log(`📝 [COMPUTER-USE] typeText action received:`, {
          text: action.text,
          submit: action.submit,
          activeApp: this.activeApp,
          hasSelector: !!action.selector,
          fullAction: JSON.stringify(action, null, 2)
        });
        
        // Check if this is generated content (from generate_and_type, compose, or generate_form intents)
        const isGeneratedContent = action.metadata?.contentGenerated;
        const contentLength = action.text?.length || 0;
        
        if (isGeneratedContent) {
          console.log(`🎨 [COMPUTER-USE] Typing generated content (${contentLength} chars, provider: ${action.metadata.provider})`);
        } else if (contentLength > 500) {
          console.log(`📝 [COMPUTER-USE] Typing long content (${contentLength} chars)`);
        }
        
        // PRIORITY 1: Multi-driver semantic selector (NEW - high reliability)
        if (action.selector && (action.selector.css || action.selector.xpath || action.selector.role || 
            action.selector.axRole || action.selector.uiaType)) {
          console.log(`🌐 [COMPUTER-USE] Using multi-driver system to type into selector:`, action.selector);
          const smartResult = await capabilities.smartTypeText(action.selector, action.text);
          
          if (!smartResult.success) {
            throw new Error(smartResult.error || 'Multi-driver type failed');
          }
          
          console.log(`✅ [COMPUTER-USE] Typed using ${smartResult.driver} driver`);
          
          // Handle submit if requested
          if (action.submit) {
            console.log(`⏎ [COMPUTER-USE] Pressing Enter after typing`);
            await capabilities.pressHotkey(['Return']);
          }
        }
        // PRIORITY 2: Legacy direct typing (no element targeting)
        else {
          console.log(`⌨️ [COMPUTER-USE] LEGACY: Direct typing without element targeting`);
          
          // NOTE: Removed automatic re-focus before typeText
          // Re-focusing opens Spotlight on macOS which interferes with typing
          // The app should already be focused from the initial focusApp action
          // If focus is lost, the backend should send an explicit focusApp action
          
          await capabilities.typeText(action.text, action.submit);
        }
        
        if (isGeneratedContent) {
          console.log(`✅ [COMPUTER-USE] Generated content typed successfully`);
        }
        break;

      case 'pressKey':
        // NOTE: Removed automatic re-focus before pressKey
        // Re-focusing opens Spotlight on macOS which interferes with keyboard actions
        // The app should already be focused from the initial focusApp action
        // If focus is lost, the backend should send an explicit focusApp action
        
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

      // File System Operations
      case 'readFile':
        console.log(`📖 [COMPUTER-USE] Reading file: ${action.path}`);
        await capabilities.readFile(action.path, action.encoding);
        break;

      case 'writeFile':
        console.log(`✍️ [COMPUTER-USE] Writing file: ${action.path}`);
        await capabilities.writeFile(action.path, action.content, action.encoding);
        break;

      case 'appendFile':
        console.log(`➕ [COMPUTER-USE] Appending to file: ${action.path}`);
        await capabilities.appendFile(action.path, action.content);
        break;

      case 'fileExists':
        console.log(`🔍 [COMPUTER-USE] Checking file exists: ${action.path}`);
        await capabilities.fileExists(action.path);
        break;

      case 'listDirectory':
        console.log(`📁 [COMPUTER-USE] Listing directory: ${action.path}`);
        await capabilities.listDirectory(action.path);
        break;

      case 'createDirectory':
        console.log(`📂 [COMPUTER-USE] Creating directory: ${action.path}`);
        await capabilities.createDirectory(action.path);
        break;

      case 'deleteFile':
        console.log(`🗑️ [COMPUTER-USE] Deleting file: ${action.path}`);
        await capabilities.deleteFile(action.path);
        break;

      case 'getFileStats':
        console.log(`📊 [COMPUTER-USE] Getting file stats: ${action.path}`);
        await capabilities.getFileStats(action.path);
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
   * Execute automation using intent-driven approach (NEW)
   * Iterates through plan steps, sending each intent to backend
   * Backend returns actions to execute, frontend executes and sends results back
   */
  async executeWithIntents(
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

    // Generate unique session ID
    const sessionId = `intent-session-${Date.now()}`;
    
    // Initialize stored data for context passing between intents
    const storedData: Record<string, any> = {};
    let currentStepIndex = 0;

    return new Promise((resolve, reject) => {
      try {
        console.log('🌐 [INTENT-MODE] Connecting to Intent WebSocket:', this.wsUrl);
        this.ws = new WebSocket(this.wsUrl);

        this.ws.onopen = () => {
          console.log('✅ [INTENT-MODE] WebSocket connected');
          
          // Hide system cursor during automation
          capabilities.hideSystemCursor();
          
          // Start executing first intent
          this.executeNextIntent(plan, currentStepIndex, storedData, sessionId);
        };

        this.ws.onmessage = async (event) => {
          try {
            const message = JSON.parse(event.data);
            console.log('📥 [INTENT-MODE] Received message:', message.type);

            switch (message.type) {
              case 'execute_action':
                // Backend sends action to execute
                // Handle both message.action and message.actionData (backend inconsistency)
                const action = message.action || message.actionData;
                
                if (!action) {
                  console.error('❌ [INTENT-MODE] No action data in message:', message);
                  throw new Error('No action data in execute_action message');
                }
                
                console.log('📦 [INTENT-MODE] Action data:', JSON.stringify(action, null, 2));
                
                // Log deterministic decisions (backend skipped LLM call)
                if (action?.metadata?.deterministic) {
                  console.log('⚡ [INTENT-MODE] Fast decision (deterministic):', action.type);
                  console.log('💡 [INTENT-MODE] Reasoning:', action.reasoning);
                } else {
                  console.log('🎬 [INTENT-MODE] Executing action:', action?.type, 'for stepId:', message.stepId);
                }
                
                await this.executeAction(action);
                
                // Capture new screenshot after action
                const screenshot = await capabilities.captureScreenshot();
                
                // Send action complete with new screenshot and preserve stepId from backend
                this.sendActionCompleteIntent(sessionId, screenshot, action, message.stepId);
                break;

              case 'intent_complete':
                // Current intent completed successfully
                console.log('✅ [INTENT-MODE] Intent complete:', message.data);
                
                // Store any output data from this intent
                if (message.data?.outputData) {
                  Object.assign(storedData, message.data.outputData);
                }
                
                // Notify callback
                this.callbacks.onAction?.(
                  { type: 'intent_complete', reasoning: message.data?.reasoning },
                  currentStepIndex
                );
                
                // Move to next step
                currentStepIndex++;
                if (currentStepIndex < plan.steps.length) {
                  await this.executeNextIntent(plan, currentStepIndex, storedData, sessionId);
                } else {
                  // All steps completed
                  console.log('✅ [INTENT-MODE] All intents completed');
                  this.callbacks.onComplete?.({ success: true });
                  this.close();
                  resolve();
                }
                break;

              case 'intent_failed':
                // Intent failed after retries
                console.error('❌ [INTENT-MODE] Intent failed:', message.error);
                this.callbacks.onError?.(message.error || 'Intent execution failed');
                this.close();
                reject(new Error(message.error || 'Intent execution failed'));
                break;

              case 'clarification_needed':
                // Backend needs clarification
                console.log('❓ [INTENT-MODE] Clarification needed:', message.questions);
                
                if (!this.callbacks.onClarificationNeeded) {
                  this.callbacks.onError?.('Clarification needed but no callback registered');
                  this.close();
                  reject(new Error('Clarification needed but no callback registered'));
                  return;
                }

                // Ask user for clarification
                const answers = await this.callbacks.onClarificationNeeded(
                  message.questions,
                  currentStepIndex
                );

                // Send answers back
                this.send({
                  type: 'clarification_answer',
                  sessionId,
                  answers
                });
                break;

              case 'paused':
                console.log('⏸️ [INTENT-MODE] Automation paused');
                this.callbacks.onStatus?.('Automation paused');
                break;

              case 'resumed':
                console.log('▶️ [INTENT-MODE] Automation resumed');
                this.callbacks.onStatus?.('Automation resumed');
                break;

              case 'stopped':
                console.log('⏹️ [INTENT-MODE] Automation stopped');
                this.callbacks.onComplete?.({ stopped: true });
                this.close();
                resolve();
                break;

              case 'error':
                console.error('❌ [INTENT-MODE] Backend error:', message.error);
                this.callbacks.onError?.(message.error);
                this.close();
                reject(new Error(message.error));
                break;

              default:
                console.warn('⚠️ [INTENT-MODE] Unknown message type:', message.type);
            }
          } catch (error: any) {
            console.error('❌ [INTENT-MODE] Error handling message:', error);
            this.callbacks.onError?.(error.message);
            reject(error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('❌ [INTENT-MODE] WebSocket error:', error);
          this.callbacks.onError?.('WebSocket connection error');
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('🔌 [INTENT-MODE] WebSocket closed');
        };
      } catch (error: any) {
        console.error('❌ [INTENT-MODE] Failed to connect:', error);
        reject(error);
      }
    });
  }

  /**
   * Execute next intent in plan
   */
  private async executeNextIntent(
    plan: any,
    stepIndex: number,
    storedData: Record<string, any>,
    sessionId: string
  ): Promise<void> {
    if (stepIndex >= plan.steps.length) {
      console.log('✅ [INTENT-MODE] All steps completed');
      this.callbacks.onComplete?.({ success: true });
      this.close();
      return;
    }

    const step = plan.steps[stepIndex];
    console.log(`🎯 [INTENT-MODE] Executing step ${stepIndex + 1}/${plan.steps.length}: ${step.intent}`);

    // Capture current screenshot
    const screenshot = await capabilities.captureScreenshot();
    
    // Strip data URL prefix
    let screenshotBase64 = screenshot;
    if (screenshot.startsWith('data:')) {
      const base64Index = screenshot.indexOf('base64,');
      if (base64Index !== -1) {
        screenshotBase64 = screenshot.substring(base64Index + 7);
      }
    }

    // Get active window bounds for coordinate offset (CRITICAL)
    const windowBounds = await this.getActiveWindowBounds();

    // Build intent execution request
    const request = {
      intentType: step.intent,
      stepData: {
        id: step.id,
        description: step.description,
        target: step.target,
        query: step.query,
        element: step.element,
        successCriteria: step.successCriteria,
        maxAttempts: step.maxAttempts || 3,
        notes: step.notes
      },
      context: {
        screenshot: {
          base64: screenshotBase64,
          mimeType: 'image/png'
        },
        storedData, // Pass accumulated data
        os: this.context.os,
        userId: this.context.userId,
        sessionId,
        activeApp: this.activeApp || undefined,
        activeUrl: this.context.activeUrl,
        screenWidth: this.context.screenWidth,
        screenHeight: this.context.screenHeight,
        windowBounds // CRITICAL: For coordinate offset fix
      },
      userId: this.context.userId
    };

    // Send to backend
    this.send({
      type: 'execute_intent',
      sessionId,
      requestId: `step-${stepIndex}`,
      data: request
    });
  }

  /**
   * Get active window bounds for coordinate offset
   * CRITICAL: Fixes Vision API coordinate mismatch bug
   */
  private async getActiveWindowBounds(): Promise<{ x: number; y: number; width: number; height: number } | undefined> {
    const ipcRenderer = (window as any).electron?.ipcRenderer;
    if (!ipcRenderer) return undefined;

    // Skip if no active app is set yet (e.g., before first focusApp action)
    if (!this.activeApp) {
      console.log('⏭️ [INTENT-MODE] Skipping window bounds - no active app set yet');
      return undefined;
    }

    try {
      const bounds = await ipcRenderer.invoke('automation:get-window-bounds', {
        appName: this.activeApp
      });
      return bounds;
    } catch (error) {
      console.warn('⚠️ [INTENT-MODE] Could not get window bounds:', error);
      return undefined;
    }
  }

  /**
   * Send action complete message with screenshot (intent-driven mode)
   */
  private sendActionCompleteIntent(sessionId: string, screenshot: string, action: any, stepId: string): void {
    // Strip data URL prefix
    let screenshotBase64 = screenshot;
    if (screenshot.startsWith('data:')) {
      const base64Index = screenshot.indexOf('base64,');
      if (base64Index !== -1) {
        screenshotBase64 = screenshot.substring(base64Index + 7);
      }
    }

    // Build detailed metadata for deterministic execution
    const metadata: any = {
      reasoning: action.reasoning,
      timestamp: Date.now(),
    };

    // Add action-specific metadata for deterministic checks
    switch (action.type) {
      case 'findAndClick':
        // CRITICAL: targetDescription and targetType enable deterministic checks
        metadata.targetDescription = action.locator?.description || action.description || 'unknown';
        metadata.targetType = action.locator?.strategy || 'unknown';
        metadata.coordinates = action.coordinates;
        metadata.usedVisionAPI = this.lastActionUsedVisionAPI;
        break;

      case 'typeText':
        metadata.text = action.text;
        metadata.textLength = action.text?.length || 0;
        metadata.submit = action.submit;
        // Check if this was generated content
        if (action.metadata?.contentGenerated) {
          metadata.contentGenerated = true;
          metadata.contentLength = action.metadata.contentLength;
          metadata.provider = action.metadata.provider;
        }
        break;

      case 'focusApp':
        metadata.appName = action.appName;
        metadata.actualAppName = this.activeApp;
        break;

      case 'openUrl':
        metadata.url = action.url;
        break;

      case 'pressHotkey':
        metadata.keys = action.keys;
        break;

      case 'clickAt':
        metadata.coordinates = action.coordinates;
        break;

      case 'scroll':
        metadata.direction = action.direction;
        metadata.amount = action.amount;
        break;

      case 'readFile':
      case 'writeFile':
      case 'appendFile':
      case 'deleteFile':
      case 'fileExists':
      case 'getFileStats':
        metadata.path = action.path;
        if (action.type === 'writeFile' || action.type === 'appendFile') {
          metadata.contentLength = action.content?.length || 0;
        }
        break;

      case 'listDirectory':
      case 'createDirectory':
        metadata.path = action.path;
        break;

      default:
        // Include any other metadata from the action
        if (action.metadata) {
          Object.assign(metadata, action.metadata);
        }
    }

    // Check if action was deterministic (set by backend)
    if (action.metadata?.deterministic) {
      metadata.deterministic = true;
    }

    this.send({
      type: 'action_complete',
      sessionId,
      stepId, // CRITICAL: Must match the stepId from execute_action message
      actionResult: {
        actionType: action.type,
        success: true,
        timestamp: Date.now(),
        metadata
      },
      screenshot: {
        base64: screenshotBase64,
        mimeType: 'image/png'
      }
    });
  }

  /**
   * Pause automation (intent-driven mode)
   */
  pause(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({
        type: 'pause'
      });
    }
  }

  /**
   * Resume automation (intent-driven mode)
   */
  resume(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({
        type: 'resume'
      });
    }
  }

  /**
   * Stop automation (intent-driven mode)
   */
  stop(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({
        type: 'stop'
      });
    }
    this.close();
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
