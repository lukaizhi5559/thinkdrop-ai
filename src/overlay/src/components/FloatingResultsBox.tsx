/**
 * Floating Results Box Component
 * 
 * Displays loading/results in a floating container that follows the cursor
 * Uses same positioning logic as PromptCaptureBox but supports interactive content
 */

import { useEffect, useState } from 'react';
import { OverlayPayload } from '../../../types/overlay-intents';
import OverlayRenderer from './OverlayRenderer';
import AnalyzingIndicator from './AnalyzingIndicator';

interface FloatingResultsBoxProps {
  payload: OverlayPayload | null;
  cursorPosition: { x: number; y: number };
  onEvent: (event: any) => void;
}

export default function FloatingResultsBox({ payload, cursorPosition, onEvent }: FloatingResultsBoxProps) {
  const [position, setPosition] = useState(cursorPosition);

  useEffect(() => {
    setPosition(cursorPosition);
  }, [cursorPosition]);

  useEffect(() => {
    if (payload) {
      console.log('🎨 [FLOATING_RESULTS] Rendering with payload:', {
        intent: payload.intent,
        uiVariant: payload.uiVariant,
        cursorPosition
      });
    }
  }, [payload, cursorPosition]);

  if (!payload) {
    console.log('⏭️  [FLOATING_RESULTS] No payload, not rendering');
    return null;
  }

  const { uiVariant } = payload;

  // Dimensions for results box
  const maxWidth = 720;
  const minWidth = 480;
  const estimatedWidth = 600; // Fixed width for consistency
  const maxHeight = 600;
  const minHeight = 200;

  // Dynamic positioning based on mouse quadrant (same logic as PromptCaptureBox)
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  const isLeftHalf = position.x < screenWidth / 2;
  const isTopHalf = position.y < screenHeight / 2;

  const offset = 40; // Slightly larger offset than prompt box
  let posX = position.x;
  let posY = position.y;

  // Position box opposite to mouse quadrant
  if (isLeftHalf && isTopHalf) {
    // Mouse upper-left → box lower-right
    posX = position.x + offset;
    posY = position.y + offset;
  } else if (isLeftHalf && !isTopHalf) {
    // Mouse lower-left → box upper-right
    posX = position.x + offset;
    posY = position.y - maxHeight - offset;
  } else if (!isLeftHalf && isTopHalf) {
    // Mouse upper-right → box lower-left
    posX = position.x - estimatedWidth - offset;
    posY = position.y + offset;
  } else {
    // Mouse lower-right → box upper-left
    posX = position.x - estimatedWidth - offset;
    posY = position.y - maxHeight - offset;
  }

  // Ensure box stays within screen bounds
  posX = Math.max(20, Math.min(posX, screenWidth - estimatedWidth - 20));
  posY = Math.max(20, Math.min(posY, screenHeight - minHeight - 20));

  return (
    <div
      className="fixed z-[10000] pointer-events-auto"
      style={{
        left: posX,
        top: posY,
        width: estimatedWidth,
        maxWidth: maxWidth,
        minWidth: minWidth,
      }}
    >
      <div
        className="rounded-xl shadow-2xl backdrop-blur-md overflow-hidden pointer-events-auto"
        style={{
          backgroundColor: 'rgba(23, 23, 23, 0.95)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          maxHeight: maxHeight,
          minHeight: minHeight,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Content area - scrollable */}
        <div
          className="flex-1 overflow-y-auto overflow-x-hidden"
          style={{
            maxHeight: maxHeight - 40, // Reserve space for potential footer
          }}
        >
          {uiVariant === 'loading' ? (
            <div className="p-6">
              <AnalyzingIndicator isVisible={true} message="Analyzing" />
            </div>
          ) : (
            <OverlayRenderer payload={payload} onEvent={onEvent} />
          )}
        </div>
      </div>
    </div>
  );
}
