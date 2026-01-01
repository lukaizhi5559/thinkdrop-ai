/**
 * Plan Interpreter
 * 
 * Executes automation plans step-by-step using NutJS capabilities
 * Handles step execution, error recovery, and progress reporting
 */

import * as capabilities from './capabilities';

interface AutomationPlan {
  planId: string;
  version: number;
  intent: string;
  goal: string;
  steps: AutomationStep[];
  metadata?: {
    provider?: string;
    generationTime?: number;
    targetOS?: string;
    estimatedDuration?: number;
  };
}

interface AutomationStep {
  id: string;
  description: string;
  kind: StepKind;
  waitAfter?: number;
  verify?: boolean;
  status?: string;
  dependsOn?: string[];
  retry?: {
    maxAttempts: number;
    delayMs?: number;
  };
  onError?: {
    strategy: 'continue' | 'fail_plan' | 'retry' | 'replan' | 'ask_user' | 'skip_step';
    maxRetries?: number;
    reason?: string;
    questionId?: string;
    message?: string;
  };
}

type StepKind =
  | { type: 'focusApp'; appName: string }
  | { type: 'openUrl'; url: string }
  | { type: 'typeText'; text: string; submit?: boolean }
  | { type: 'hotkey'; keys: string[] }
  | { type: 'click'; x?: number; y?: number }
  | { type: 'scroll'; amount?: number; direction?: 'down' | 'up' }
  | { type: 'pause'; ms: number }
  | { type: 'apiAction'; skill: string; params: Record<string, any> }
  | { type: 'waitForElement'; locator: { description: string; roleHint?: string; strategy?: string }; timeoutMs?: number }
  | { type: 'screenshot'; tag?: string; analyzeWithVision?: boolean; speedMode?: string }
  | { type: 'findAndClick'; locator: { description: string; strategy?: string }; timeoutMs?: number }
  | { type: 'webScrape'; url: string; action: 'navigate' | 'search' | 'extract' | 'click'; params: { selector?: string; text?: string; waitTime?: number }; storeAs?: string }
  | { type: 'log'; level: string; message: string }
  | { type: 'pressKey'; key: string }
  | { type: 'end'; reason?: string };

interface ExecutionCallbacks {
  onStepStart?: (step: AutomationStep, index: number) => void;
  onStepComplete?: (step: AutomationStep, index: number) => void;
  onStepFailed?: (step: AutomationStep, index: number, error: string) => void;
  onComplete?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onReplanNeeded?: (context: {
    failedStep: AutomationStep;
    stepIndex: number;
    error: string;
    screenshot?: string;
    previousPlan: AutomationPlan;
  }) => void;
  onUserInputNeeded?: (context: {
    questionId?: string;
    message: string;
    step: AutomationStep;
    stepIndex: number;
  }) => void;
}

export class PlanInterpreter {
  private plan: AutomationPlan;
  private isPaused: boolean = false;
  private isCancelled: boolean = false;
  private lastCoordinates: { x: number; y: number } | null = null;
  private replanTriggered: boolean = false; // Guard to prevent multiple replan triggers

  constructor(plan: AutomationPlan) {
    this.plan = plan;
  }

  /**
   * Reset replan lock (called when new plan is received)
   */
  resetReplanLock(): void {
    this.replanTriggered = false;
  }

  /**
   * Stop the interpreter immediately
   */
  stop(): void {
    console.log('🛑 [INTERPRETER] Stop called - cancelling execution');
    this.isCancelled = true;
  }

  /**
   * Execute the automation plan
   */
  async execute(callbacks: ExecutionCallbacks): Promise<void> {
    for (let i = 0; i < this.plan.steps.length; i++) {
      // Check if cancelled
      if (this.isCancelled) {
        throw new Error('Automation cancelled by user');
      }

      // Wait if paused
      while (this.isPaused) {
        await capabilities.wait(100);
        if (this.isCancelled) {
          throw new Error('Automation cancelled by user');
        }
      }

      const step = this.plan.steps[i];

      console.log(`🤖 [INTERPRETER] Starting step ${i + 1}/${this.plan.steps.length}:`, step.description);
      callbacks.onStepStart?.(step, i);

      // Retry logic - only trigger replan AFTER exhausting all retries
      const maxAttempts = step.retry?.maxAttempts || 1;
      let lastError: Error | null = null;
      let attemptNumber = 0;

      for (attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
        try {
          await this.executeStep(step);

          // Verify critical steps that need validation
          const needsVerification = this.shouldVerifyStep(step);
          if (needsVerification) {
            console.log(`🔍 [INTERPRETER] Verifying step ${i + 1}...`);
            
            const verification = await capabilities.verifyStepWithVision(
              this.getExpectedState(step),
              step.description
            );
            
            if (!verification.verified) {
              const errorMsg = `Step verification failed: ${verification.reasoning} (confidence: ${verification.confidence})`;
              const errorStrategy = step.onError?.strategy || 'fail_plan';
              
              // Check if any downstream steps depend on this one
              const hasDownstreamDependents = this.plan.steps.some((s, idx) => 
                idx > i && s.dependsOn?.includes(step.id)
              );
              
              // If skip_step but has dependents, we should replan instead of continuing blindly
              if (errorStrategy === 'skip_step' && hasDownstreamDependents) {
                console.warn(`⚠️  [INTERPRETER] ${errorMsg} - strategy is skip_step but downstream steps depend on this, triggering replan`);
                throw new Error(errorMsg);
              } else if (errorStrategy === 'skip_step') {
                console.warn(`⚠️  [INTERPRETER] ${errorMsg} - strategy is skip_step and no dependents, continuing...`);
              } else {
                // For replan or fail_plan strategies, throw error to trigger replan
                console.error(`❌ [INTERPRETER] ${errorMsg}`);
                throw new Error(errorMsg);
              }
            } else {
              console.log(`✅ [INTERPRETER] Step verified (confidence: ${verification.confidence})`);
            }
          }

          console.log(`✅ [INTERPRETER] Completed step ${i + 1}:`, step.description);
          callbacks.onStepComplete?.(step, i);

          // Wait after step if specified
          if (step.waitAfter) {
            await capabilities.wait(step.waitAfter);
          }

          // Success - break out of retry loop
          lastError = null;
          break;
        } catch (error: any) {
          lastError = error;
          console.error(`❌ [INTERPRETER] Step ${i + 1} attempt ${attemptNumber}/${maxAttempts} failed:`, error.message);
          
          // Wait before retry (except on last attempt)
          if (attemptNumber < maxAttempts) {
            const retryDelay = step.retry?.delayMs || 1000;
            console.log(`⏳ [INTERPRETER] Waiting ${retryDelay}ms before retry ${attemptNumber + 1}/${maxAttempts}`);
            await capabilities.wait(retryDelay);
          }
          
          // If this was the last attempt, handle error strategy
          if (attemptNumber >= maxAttempts) {
            console.error(`🛑 [INTERPRETER] All ${maxAttempts} attempts exhausted for step ${i + 1}`);
            
            // Check error strategy
            const errorStrategy = step.onError?.strategy || 'fail_plan';
            console.log(`📋 [INTERPRETER] Error strategy: ${errorStrategy}`);
            
            if (errorStrategy === 'replan') {
              // Guard: Only trigger replan once per interpreter instance
              if (this.replanTriggered) {
                console.warn('⚠️  [INTERPRETER] Replan already triggered, skipping duplicate');
                throw error;
              }
              
              this.replanTriggered = true;
              // Trigger replanning AFTER exhausting all retries
              console.log(`🔄 [INTERPRETER] Triggering replanning after exhausting ${maxAttempts} attempts`);
              
              // Capture screenshot for replan context
              try {
                const screenshot = await capabilities.captureScreenshot();
                console.log(`📸 [INTERPRETER] Screenshot captured for replan context`);
                
                callbacks.onStepFailed?.(step, i, error.message);
                callbacks.onReplanNeeded?.({
                  failedStep: step,
                  stepIndex: i,
                  error: error.message,
                  screenshot: screenshot,
                  previousPlan: this.plan
                });
              } catch (screenshotError) {
                console.warn(`⚠️  [INTERPRETER] Failed to capture screenshot for replan:`, screenshotError);
                callbacks.onStepFailed?.(step, i, error.message);
                callbacks.onReplanNeeded?.({
                  failedStep: step,
                  stepIndex: i,
                  error: error.message,
                  screenshot: undefined,
                  previousPlan: this.plan
                });
              }
              throw error;
            } else if (errorStrategy === 'ask_user') {
              // Ask user for guidance
              console.log(`❓ [INTERPRETER] Asking user for guidance`);
              callbacks.onStepFailed?.(step, i, error.message);
              callbacks.onUserInputNeeded?.({
                questionId: step.onError?.questionId,
                message: step.onError?.message || error.message,
                step: step,
                stepIndex: i
              });
              throw error;
            } else {
              // fail_plan or skip_step
              callbacks.onStepFailed?.(step, i, error.message);
              throw error;
            }
          }
          // Continue to next retry attempt
        }
      }

      // If we still have an error after all retries, throw it
      if (lastError) {
        throw lastError;
      }
    }

    callbacks.onComplete?.();
  }

  /**
   * Resume execution from a specific step index
   * Used for continuing after replanning or fixing a failed step
   * @param startIndex - Step index to resume from (0-based)
   * @param callbacks - Execution callbacks
   */
  async resumeFrom(startIndex: number, callbacks: ExecutionCallbacks): Promise<void> {
    console.log(`▶️  [INTERPRETER] Resuming execution from step ${startIndex + 1}/${this.plan.steps.length}`);
    
    // Validate start index
    if (startIndex < 0 || startIndex >= this.plan.steps.length) {
      throw new Error(`Invalid start index: ${startIndex}. Plan has ${this.plan.steps.length} steps.`);
    }
    
    // Execute from startIndex to end
    for (let i = startIndex; i < this.plan.steps.length; i++) {
      // Check if cancelled
      if (this.isCancelled) {
        throw new Error('Automation cancelled by user');
      }

      // Wait if paused
      while (this.isPaused) {
        await capabilities.wait(100);
        if (this.isCancelled) {
          throw new Error('Automation cancelled by user');
        }
      }

      const step = this.plan.steps[i];

      console.log(`🤖 [INTERPRETER] Starting step ${i + 1}/${this.plan.steps.length}:`, step.description);
      callbacks.onStepStart?.(step, i);

      // Retry logic - only trigger replan AFTER exhausting all retries
      const maxAttempts = step.retry?.maxAttempts || 1;
      let lastError: Error | null = null;
      let attemptNumber = 0;

      for (attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
        try {
          await this.executeStep(step);

          // Verify critical steps that need validation
          const needsVerification = this.shouldVerifyStep(step);
          if (needsVerification) {
            console.log(`🔍 [INTERPRETER] Verifying step ${i + 1}...`);
            
            const verification = await capabilities.verifyStepWithVision(
              this.getExpectedState(step),
              step.description
            );
            
            if (!verification.verified) {
              const errorMsg = `Step verification failed: ${verification.reasoning} (confidence: ${verification.confidence})`;
              const errorStrategy = step.onError?.strategy || 'fail_plan';
              
              // Check if any downstream steps depend on this one
              const hasDownstreamDependents = this.plan.steps.some((s, idx) => 
                idx > i && s.dependsOn?.includes(step.id)
              );
              
              // If skip_step but has dependents, we should replan instead of continuing blindly
              if (errorStrategy === 'skip_step' && hasDownstreamDependents) {
                console.warn(`⚠️  [INTERPRETER] ${errorMsg} - strategy is skip_step but downstream steps depend on this, triggering replan`);
                throw new Error(errorMsg);
              } else if (errorStrategy === 'skip_step') {
                console.warn(`⚠️  [INTERPRETER] ${errorMsg} - strategy is skip_step and no dependents, continuing...`);
              } else {
                // For replan or fail_plan strategies, throw error to trigger replan
                console.error(`❌ [INTERPRETER] ${errorMsg}`);
                throw new Error(errorMsg);
              }
            } else {
              console.log(`✅ [INTERPRETER] Step verified (confidence: ${verification.confidence})`);
            }
          }

          console.log(`✅ [INTERPRETER] Completed step ${i + 1}:`, step.description);
          callbacks.onStepComplete?.(step, i);

          // Wait after step if specified
          if (step.waitAfter) {
            await capabilities.wait(step.waitAfter);
          }

          // Success - break out of retry loop
          lastError = null;
          break;
        } catch (error: any) {
          lastError = error;
          console.error(`❌ [INTERPRETER] Step ${i + 1} attempt ${attemptNumber}/${maxAttempts} failed:`, error.message);
          
          // Wait before retry (except on last attempt)
          if (attemptNumber < maxAttempts) {
            const retryDelay = step.retry?.delayMs || 1000;
            console.log(`⏳ [INTERPRETER] Waiting ${retryDelay}ms before retry ${attemptNumber + 1}/${maxAttempts}`);
            await capabilities.wait(retryDelay);
          }
          
          // If this was the last attempt, handle error strategy
          if (attemptNumber >= maxAttempts) {
            console.error(`� [INTERPRETER] All ${maxAttempts} attempts exhausted for step ${i + 1}`);
            
            // Check error strategy
            const errorStrategy = step.onError?.strategy || 'fail_plan';
            console.log(`� [INTERPRETER] Error strategy: ${errorStrategy}`);
            
            if (errorStrategy === 'replan') {
              // Guard: Only trigger replan once per interpreter instance
              if (this.replanTriggered) {
                console.warn('⚠️  [INTERPRETER] Replan already triggered, skipping duplicate');
                throw error;
              }
              
              this.replanTriggered = true;
              // Trigger replanning AFTER exhausting all retries
              console.log(`� [INTERPRETER] Triggering replanning after exhausting ${maxAttempts} attempts`);
              
              // Capture screenshot for replan context
              try {
                const screenshot = await capabilities.captureScreenshot();
                console.log(`� [INTERPRETER] Screenshot captured for replan context`);
                
                callbacks.onStepFailed?.(step, i, error.message);
                callbacks.onReplanNeeded?.({
                  failedStep: step,
                  stepIndex: i,
                  error: error.message,
                  screenshot: screenshot,
                  previousPlan: this.plan
                });
              } catch (screenshotError) {
                console.warn(`⚠️  [INTERPRETER] Failed to capture screenshot for replan:`, screenshotError);
                callbacks.onStepFailed?.(step, i, error.message);
                callbacks.onReplanNeeded?.({
                  failedStep: step,
                  stepIndex: i,
                  error: error.message,
                  screenshot: undefined,
                  previousPlan: this.plan
                });
              }
              throw error;
            } else if (errorStrategy === 'ask_user') {
              // Ask user for guidance
              console.log(`❓ [INTERPRETER] Asking user for guidance`);
              callbacks.onStepFailed?.(step, i, error.message);
              callbacks.onUserInputNeeded?.({
                questionId: step.onError?.questionId,
                message: step.onError?.message || error.message,
                step: step,
                stepIndex: i
              });
              throw error;
            } else {
              // fail_plan or skip_step
              callbacks.onStepFailed?.(step, i, error.message);
              throw error;
            }
          }
          // Continue to next retry attempt
        }
      }

      // If we still have an error after all retries, throw it
      if (lastError) {
        throw lastError;
      }
    }

    callbacks.onComplete?.();
  }

  /**
   * Execute a single automation step
   */
  async executeStep(step: AutomationStep): Promise<void> {
    const { kind } = step;

    console.log(`🔧 [INTERPRETER] Executing step type: ${kind.type}`, kind);

    // Validate step type before execution to catch AI hallucinations
    const validTypes = [
      'focusApp', 'openUrl', 'typeText', 'hotkey', 'click', 'scroll', 
      'pause', 'apiAction', 'waitForElement', 'screenshot', 'findAndClick', 
      'webScrape', 'log', 'pressKey', 'end'
    ];
    
    if (!validTypes.includes(kind.type)) {
      const errorMsg = `Unknown step type: ${kind.type}. Valid types are: ${validTypes.join(', ')}. ` +
        `This is likely an AI hallucination - the plan generator created an invalid step type.`;
      console.error(`❌ [INTERPRETER] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    switch (kind.type) {
      case 'focusApp':
        console.log(`🎯 [INTERPRETER] Focusing app: ${kind.appName}`);
        await capabilities.focusApp(kind.appName);
        
        // Check if already in fullscreen before toggling
        await capabilities.wait(500);
        const isFullscreen = await capabilities.checkFullscreen(kind.appName);
        console.log(`🔍 [INTERPRETER] ${kind.appName} fullscreen status: ${isFullscreen}`);
        
        if (!isFullscreen) {
          console.log(`📺 [INTERPRETER] Entering fullscreen for ${kind.appName}`);
          await capabilities.fullscreen();
          
          // Re-focus the app after fullscreen to ensure it stays focused
          await capabilities.wait(300);
          await capabilities.focusApp(kind.appName);
          await capabilities.wait(300);
        } else {
          console.log(`✅ [INTERPRETER] ${kind.appName} already in fullscreen, skipping toggle`);
        }
        break;

      case 'openUrl':
        console.log(`🌐 [INTERPRETER] Opening URL: ${kind.url}`);
        await capabilities.openUrl(kind.url);
        break;

      case 'hotkey':
        await capabilities.pressHotkey(kind.keys);
        break;

      case 'click':
        if (kind.x !== undefined && kind.y !== undefined) {
          // Send ghost mouse move event for visual feedback
          capabilities.sendGhostMouseMove(kind.x, kind.y);
          await capabilities.wait(500); // Wait for ghost animation
          
          // Send ghost click event
          capabilities.sendGhostMouseClick(kind.x, kind.y);
          
          // Perform actual click
          await capabilities.clickAt(kind.x, kind.y);
        } else if (this.lastCoordinates) {
          // Send ghost mouse move event for visual feedback
          capabilities.sendGhostMouseMove(this.lastCoordinates.x, this.lastCoordinates.y);
          await capabilities.wait(500); // Wait for ghost animation
          
          // Send ghost click event
          capabilities.sendGhostMouseClick(this.lastCoordinates.x, this.lastCoordinates.y);
          
          // Perform actual click
          await capabilities.clickAt(this.lastCoordinates.x, this.lastCoordinates.y);
        } else {
          throw new Error('No coordinates available for click');
        }
        break;

      case 'scroll':
        // Scroll the page/window - validate amount is a number
        const scrollAmount = kind.amount || 3;
        const scrollDirection = kind.direction || 'down';
        
        // Validate scroll amount is a positive number (catch AI hallucinations like "medium", "large", etc)
        if (typeof scrollAmount !== 'number' || scrollAmount <= 0 || !Number.isFinite(scrollAmount)) {
          const errorMsg = `Invalid scroll amount: ${scrollAmount} (must be a positive number)`;
          console.error(`❌ [INTERPRETER] ${errorMsg}`);
          throw new Error(errorMsg);
        }
        
        console.log(`🖱️  [INTERPRETER] Scrolling ${scrollDirection} by ${scrollAmount} steps`);
        await capabilities.scroll(scrollAmount, scrollDirection);
        break;

      case 'pause':
        await capabilities.wait(kind.ms);
        break;

      case 'apiAction':
        await capabilities.invokeSkill(kind.skill, kind.params);
        break;

      case 'waitForElement':
        // For Phase 1, we'll just wait a bit
        // In Phase 2, this will use the Vision API
        await capabilities.wait(1000);
        break;

      case 'screenshot':
        // Take a screenshot for verification
        // For Phase 1, we'll just capture it without analysis
        console.log(`📸 [INTERPRETER] Taking screenshot: ${kind.tag || 'unnamed'}`);
        await capabilities.captureScreenshot();
        break;

      case 'findAndClick':
        // Find element using vision and click it
        console.log(`🔍 [INTERPRETER] Finding and clicking: ${kind.locator.description}`);
        
        try {
          // Use Vision API to find the element
          const coords = await capabilities.findElementWithVision(
            kind.locator.description,
            kind.locator.strategy
          );
          
          console.log(`✅ [INTERPRETER] Found element at (${coords.x}, ${coords.y})`);
          
          // Store coordinates for potential retry
          this.lastCoordinates = coords;
          
          // Send ghost mouse move event for visual feedback
          console.log(`👻 [INTERPRETER] Sending ghost mouse move to (${coords.x}, ${coords.y})`);
          capabilities.sendGhostMouseMove(coords.x, coords.y);
          await capabilities.wait(800); // Wait for ghost animation to reach target
          
          // Send ghost click event
          console.log(`👻 [INTERPRETER] Sending ghost mouse click at (${coords.x}, ${coords.y})`);
          capabilities.sendGhostMouseClick(coords.x, coords.y);
          await capabilities.wait(200);
          
          // Perform actual click
          await capabilities.clickAt(coords.x, coords.y);
          
          console.log(`🖱️  [INTERPRETER] Clicked at (${coords.x}, ${coords.y})`);
        } catch (error: any) {
          console.error(`❌ [INTERPRETER] Failed to find/click element:`, error.message);
          throw new Error(`Could not find element: ${kind.locator.description}`);
        }
        break;

      case 'typeText':
        // Type text using keyboard
        console.log(`⌨️  [INTERPRETER] Typing text: ${kind.text.substring(0, 50)}...`);
        await capabilities.typeText(kind.text);
        if (kind.submit) {
          await capabilities.wait(200);
          await capabilities.pressHotkey(['Enter']);
        }
        break;

      case 'log':
        // Log message
        console.log(`📝 [INTERPRETER] ${kind.level.toUpperCase()}: ${kind.message}`);
        break;

      case 'pressKey':
        // Press a single key or key combination with modifiers
        if ((kind as any).modifiers && (kind as any).modifiers.length > 0) {
          // Has modifiers like Cmd+A, Cmd+C
          const keys = [...(kind as any).modifiers, kind.key];
          console.log(`⌨️  [INTERPRETER] Pressing hotkey: ${keys.join('+')}`);
          await capabilities.pressHotkey(keys);
        } else {
          // Single key press
          console.log(`⌨️  [INTERPRETER] Pressing key: ${kind.key}`);
          await capabilities.pressHotkey([kind.key]);
        }
        break;

      case 'end':
        // End of automation plan
        console.log(`🏁 [INTERPRETER] Plan completed: ${kind.reason || 'success'}`);
        break;

      default:
        // Unknown step type - log and halt
        console.error(`❌ [INTERPRETER] UNKNOWN STEP TYPE: ${(kind as any).type}`);
        console.error(`❌ [INTERPRETER] Step details:`, JSON.stringify(step, null, 2));
        
        this.isCancelled = true;
        throw new Error(`Unknown step type: ${(kind as any).type}`);
    }
  }

  /**
   * Determine if a step needs verification
   */
  private shouldVerifyStep(step: AutomationStep): boolean {
    // TEMPORARILY DISABLED: Verification is causing database pool exhaustion
    // due to hundreds of concurrent Vision API calls when steps fail/retry.
    // TODO: Re-enable with proper throttling/queueing mechanism
    return false;
    
    // const { kind } = step;
    // 
    // // Verify steps that interact with UI or change state
    // const verifiableTypes = [
    //   'findAndClick',  // Did we actually click the right element?
    //   'click',         // Did the click at coordinates have an effect?
    //   'openUrl',       // Did the URL load?
    //   'focusApp',      // Is the app actually focused?
    //   'typeText',      // Was the text typed correctly?
    //   'waitForElement' // Did the element appear?
    // ];
    // 
    // return verifiableTypes.includes(kind.type);
  }

  /**
   * Get expected state description for verification
   */
  private getExpectedState(step: AutomationStep): string {
    const { kind, description } = step;
    
    switch (kind.type) {
      case 'findAndClick':
        return `Element "${kind.locator.description}" should be clicked and any resulting action should be visible`;
      
      case 'click':
        return `Click at coordinates (${kind.x}, ${kind.y}) should have triggered a visible action or state change`;
      
      case 'openUrl':
        return `Browser should show the page at ${kind.url}`;
      
      case 'focusApp':
        return `${kind.appName} application should be in focus and visible`;
      
      case 'typeText':
        // For long text, provide a summary instead of truncating mid-sentence
        if (kind.text.length > 100) {
          return `Text input field should contain the typed content (${kind.text.length} characters starting with "${kind.text.substring(0, 40)}...")`;
        }
        return `Text "${kind.text}" should be visible in the focused input field`;
      
      case 'waitForElement':
        return `Element "${kind.locator.description}" should be visible on screen`;
      
      default:
        return description || 'Step should be completed successfully';
    }
  }

  /**
   * Pause execution
   */
  pause(): void {
    this.isPaused = true;
  }

  /**
   * Resume execution
   */
  resume(): void {
    this.isPaused = false;
  }

  /**
   * Cancel execution
   */
  cancel(): void {
    this.isCancelled = true;
  }

  /**
   * Check if execution is paused
   */
  isPausedState(): boolean {
    return this.isPaused;
  }

  /**
   * Check if execution is cancelled
   */
  isCancelledState(): boolean {
    return this.isCancelled;
  }
}
