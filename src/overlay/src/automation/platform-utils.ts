/**
 * Platform detection utilities for cross-platform keyboard shortcuts
 */

/**
 * Get the appropriate modifier key name for the current platform
 * @returns 'LeftSuper' (Cmd) on Mac, 'LeftControl' (Ctrl) on Windows/Linux
 */
export function getPlatformModifier(): 'LeftSuper' | 'LeftControl' {
  const platform = process.platform;
  
  if (platform === 'darwin') {
    return 'LeftSuper';  // Cmd key on Mac
  } else {
    return 'LeftControl';  // Ctrl key on Windows/Linux
  }
}

/**
 * Check if running on macOS
 */
export function isMac(): boolean {
  return process.platform === 'darwin';
}

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * Check if running on Linux
 */
export function isLinux(): boolean {
  return process.platform === 'linux';
}

/**
 * Get platform-specific keyboard shortcut description
 * @param action - Action name (e.g., 'zoom in', 'copy', 'paste')
 * @returns Human-readable shortcut (e.g., 'Cmd+Plus' or 'Ctrl+Plus')
 */
export function getShortcutDescription(action: string): string {
  const modifier = isMac() ? 'Cmd' : 'Ctrl';
  
  const shortcuts: Record<string, string> = {
    'zoom in': `${modifier}+Plus`,
    'zoom out': `${modifier}+Minus`,
    'copy': `${modifier}+C`,
    'paste': `${modifier}+V`,
    'select all': `${modifier}+A`,
  };
  
  return shortcuts[action.toLowerCase()] || action;
}
