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
  onError?: {
    strategy: 'continue' | 'fail_plan' | 'retry';
    maxRetries?: number;
  };
}

type StepKind =
  | { type: 'focusApp'; appName: string }
  | { type: 'openUrl'; url: string }
  | { type: 'typeText'; text: string; submit?: boolean }
  | { type: 'hotkey'; keys: string[] }
  | { type: 'click'; x?: number; y?: number }
  | { type: 'pause'; ms: number }
  | { type: 'apiAction'; skill: string; params: Record<string, any> }
  | { type: 'waitForElement'; locator: { description: string; roleHint?: string; strategy?: string }; timeoutMs?: number }
  | { type: 'screenshot'; tag?: string; analyzeWithVision?: boolean; speedMode?: string }
  | { type: 'findAndClick'; locator: { description: string; strategy?: string }; timeoutMs?: number }
  | { type: 'log'; level: string; message: string };

interface ExecutionCallbacks {
  onStepStart?: (step: AutomationStep, index: number) => void;
  onStepComplete?: (step: AutomationStep, index: number) => void;
  onStepFailed?: (step: AutomationStep, index: number, error: string) => void;
  onComplete?: () => void;
  onPause?: () => void;
  onResume?: () => void;
}

export class PlanInterpreter {
  private plan: AutomationPlan;
  private isPaused: boolean = false;
  private isCancelled: boolean = false;
  private lastCoordinates: { x: number; y: number } | null = null;

  constructor(plan: AutomationPlan) {
    this.plan = plan;
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

      try {
        await this.executeStep(step);

        console.log(`✅ [INTERPRETER] Completed step ${i + 1}:`, step.description);
        callbacks.onStepComplete?.(step, i);

        // Wait after step if specified
        if (step.waitAfter) {
          await capabilities.wait(step.waitAfter);
        }
      } catch (error: any) {
        console.error(`❌ [INTERPRETER] Step ${i + 1} failed:`, error.message, error);
        callbacks.onStepFailed?.(step, i, error.message);

        // Handle error based on strategy
        const strategy = step.onError?.strategy || 'fail_plan';
        if (strategy === 'fail_plan') {
          throw error;
        }
        // For 'continue' strategy, just move to next step
      }
    }

    callbacks.onComplete?.();
  }

  /**
   * Execute a single automation step
   */
  private async executeStep(step: AutomationStep): Promise<void> {
    const { kind } = step;

    console.log(`🔧 [INTERPRETER] Executing step type: ${kind.type}`, kind);

    switch (kind.type) {
      case 'focusApp':
        console.log(`🎯 [INTERPRETER] Focusing app: ${kind.appName}`);
        await capabilities.focusApp(kind.appName);
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
          await capabilities.clickAt(kind.x, kind.y);
        } else if (this.lastCoordinates) {
          await capabilities.clickAt(this.lastCoordinates.x, this.lastCoordinates.y);
        } else {
          throw new Error('No coordinates available for click');
        }
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
        // For now, just wait - will implement vision-based clicking in Phase 2
        await capabilities.wait(500);
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

      default:
        throw new Error(`Unknown step type: ${(kind as any).type}`);
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
