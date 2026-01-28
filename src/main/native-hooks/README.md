# Native Keyboard Hooks

Platform-specific keyboard capture for Prompt Anywhere feature.

## macOS Implementation

### Components

1. **macos-keyhook.swift** - Swift CGEventTap implementation
   - Captures keyboard events system-wide
   - Blocks key delivery when in capture mode
   - Communicates via JSON-lines over stdio
   - Handles Accessibility permissions

2. **macos-keyhook-bridge.cjs** - Node.js IPC bridge
   - Spawns Swift helper as child process
   - Manages stdio communication
   - Emits events to Electron main process

3. **promptCapture.cjs** - Service layer
   - State machine for capture mode
   - Clipboard integration for highlighted text
   - Forwards events to overlay UI

### Build

```bash
./compile-macos-keyhook.sh
```

Output: `bin/macos-keyhook` (executable)

### Permissions Required

- **Accessibility** - Required for CGEventTap to capture/block keystrokes
- User will be prompted on first activation

### Protocol

**Commands** (Electron → Swift):
```json
{"command": "startCapture"}
{"command": "stopCapture"}
{"command": "ping"}
{"command": "shutdown"}
```

**Events** (Swift → Electron):
```json
{"type": "status", "data": {"message": "...", "ready": true}}
{"type": "captureStarted"}
{"type": "captureStopped"}
{"type": "keyDown", "key": "a", "keyCode": 0, "modifiers": ["shift"], "timestamp": 1234567890}
{"type": "error", "error": "..."}
{"type": "pong"}
```

### Key Handling

- **Enter** - Submit prompt
- **Shift+Enter** - Newline
- **Escape** - Cancel
- **Backspace** - Delete character
- **All other keys** - Captured and swallowed

### Fail-Safe

If Electron disconnects, the helper automatically disables capture to prevent permanent keyboard hijacking.

## Windows (Future)

Will use Low-Level Keyboard Hook (WH_KEYBOARD_LL) with similar architecture.

## Linux (Future)

Will use XInput/evdev with similar architecture.
