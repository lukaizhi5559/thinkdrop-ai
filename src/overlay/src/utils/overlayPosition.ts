/**
 * Overlay Position Utilities
 * 
 * Helper functions for dynamic intent window positioning and resizing
 * Used to animate the intent window to highlighted items from the ghost window
 */

const ipcRenderer = (window as any).electron?.ipcRenderer;

export interface PositionConfig {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  animate?: boolean;
}

export interface HoverData {
  x: number;
  y: number;
  width: number;
  height: number;
  type: 'text' | 'image' | 'button' | 'element';
  content?: string;
}

/**
 * Position the intent window at specific coordinates
 * Useful for animating to highlighted items
 */
export function positionIntentWindow(config: PositionConfig): void {
  if (!ipcRenderer) {
    console.warn('⚠️  IPC not available - cannot position intent window');
    return;
  }

  ipcRenderer.send('overlay:position-intent', config);
}

/**
 * Resize the intent window dynamically
 * Useful for UI cards, dropdowns, button groups, etc.
 */
export function resizeIntentWindow(width: number, height: number, animate = true): void {
  if (!ipcRenderer) {
    console.warn('⚠️  IPC not available - cannot resize intent window');
    return;
  }

  ipcRenderer.send('overlay:resize-intent', { width, height, animate });
}

/**
 * Send hover data from ghost window to intent window
 * Used when hovering over highlighted items
 */
export function sendGhostHoverData(hoverData: HoverData): void {
  if (!ipcRenderer) {
    console.warn('⚠️  IPC not available - cannot send hover data');
    return;
  }

  ipcRenderer.send('overlay:ghost-hover', hoverData);
}

/**
 * Listen for hover data from ghost window (for intent window)
 */
export function onGhostHover(callback: (hoverData: HoverData) => void): () => void {
  if (!ipcRenderer) {
    console.warn('⚠️  IPC not available - cannot listen for hover data');
    return () => {};
  }

  const handler = (_event: any, data: HoverData) => callback(data);
  ipcRenderer.on('overlay:ghost-hover-data', handler);

  // Return cleanup function
  return () => {
    ipcRenderer.removeListener('overlay:ghost-hover-data', handler);
  };
}

/**
 * Animate intent window to a highlighted item
 * Calculates optimal position near the item
 */
export function animateToHighlightedItem(
  itemX: number,
  itemY: number,
  itemWidth: number,
  itemHeight: number,
  intentWidth: number,
  intentHeight: number
): void {
  // Calculate position to place intent window near the highlighted item
  // Default: place to the right of the item, or below if not enough space
  
  const screenWidth = window.screen.availWidth;
  const screenHeight = window.screen.availHeight;
  
  let x = itemX + itemWidth + 10; // 10px gap
  let y = itemY;
  
  // If intent window would go off-screen to the right, place it to the left
  if (x + intentWidth > screenWidth) {
    x = itemX - intentWidth - 10;
  }
  
  // If still off-screen, place below the item
  if (x < 0) {
    x = itemX;
    y = itemY + itemHeight + 10;
  }
  
  // If would go off-screen at bottom, place above
  if (y + intentHeight > screenHeight) {
    y = itemY - intentHeight - 10;
  }
  
  // Ensure within screen bounds
  x = Math.max(0, Math.min(x, screenWidth - intentWidth));
  y = Math.max(0, Math.min(y, screenHeight - intentHeight));
  
  positionIntentWindow({ x, y, width: intentWidth, height: intentHeight, animate: true });
}

/**
 * Preset sizes for common UI patterns
 */
export const INTENT_SIZES = {
  SMALL_CARD: { width: 300, height: 200 },
  MEDIUM_CARD: { width: 500, height: 400 },
  LARGE_CARD: { width: 700, height: 600 },
  DROPDOWN: { width: 250, height: 300 },
  BUTTON_GROUP: { width: 200, height: 100 },
  SEARCH_RESULTS: { width: 800, height: 600 },
  COMMAND_GUIDE: { width: 600, height: 500 },
};
