# Thinkdrop AI Overlay

Transparent full-screen overlay UI for intent-driven interactions.

## Structure

```
src/overlay/
├── index.html              # Entry point
├── src/
│   ├── main.tsx           # React entry
│   ├── App.tsx            # Main overlay container
│   ├── index.css          # Global styles (Tailwind + glassmorphism)
│   └── components/
│       ├── PromptBar.tsx          # Bottom prompt bar (always visible)
│       ├── OverlayRenderer.tsx    # Intent router
│       └── intents/
│           ├── WebSearchChoice.tsx    # web_search/choice variant
│           ├── WebSearchLoading.tsx   # web_search/loading variant
│           ├── WebSearchResults.tsx   # web_search/results variant
│           └── WebSearchError.tsx     # web_search/error variant
├── tsconfig.json          # TypeScript config
└── tsconfig.node.json     # Node TypeScript config
```

## How It Works

### 1. Overlay Payload Flow

```
User Input → State Graph → overlayPayload
  ↓
IPC (overlay:update)
  ↓
OverlayRenderer → Intent Component
  ↓
Render shadcn/ui
```

### 2. User Interaction Flow

```
User clicks button → OverlayEvent
  ↓
IPC (overlay:event)
  ↓
State Graph (bypass parseIntent)
  ↓
New overlayPayload
  ↓
Update UI
```

## Components

### PromptBar
- Always visible at bottom-center
- Glassmorphism style
- Voice input toggle
- Expands on focus

### OverlayRenderer
- Routes to intent-specific components
- Based on `intent` + `uiVariant`
- Handles all web_search variants

### Web Search Components

#### WebSearchChoice
- Shows when multiple channels available
- User selects LinkedIn, Twitter, etc.
- Sends continuation event with selected channel

#### WebSearchLoading
- Animated spinner
- Loading message
- Shown during search

#### WebSearchResults
- Person/info card with results
- Clickable links
- Dismissible
- TODO: OCR entity anchoring

#### WebSearchError
- Error message
- Retry button
- Cancel button

## Styling

### Theme
- Matches ChatMessages.tsx (teal/blue gradient)
- Glassmorphism (blur + transparency)
- Dark mode optimized

### Utilities
- `.glass` - Light glassmorphism
- `.glass-dark` - Dark glassmorphism
- `.gradient-teal-blue` - Teal to blue gradient
- `.fade-in` - Fade in animation
- `.slide-up` - Slide up animation
- `.click-through` - Disable pointer events
- `.click-active` - Enable pointer events

## Development

### Running Overlay
```bash
npm run dev
# Overlay available at http://localhost:5173/src/overlay/index.html
```

### Building
```bash
npm run build
# Output: dist-renderer/overlay.html
```

### Testing Overlay Payloads
```javascript
// In main process
const { sendOverlayUpdate } = require('./src/main/ipc/overlay.cjs');

sendOverlayUpdate({
  intent: 'web_search',
  uiVariant: 'choice',
  slots: {
    subject: 'John Smith',
    candidateChannels: [
      { id: 'linkedin', label: 'LinkedIn' },
      { id: 'twitter', label: 'Twitter' }
    ]
  },
  conversationId: 'test_123',
  correlationId: 'corr_456'
});
```

## Adding New Intents

1. Create component in `src/components/intents/[IntentName][Variant].tsx`
2. Add case to `OverlayRenderer.tsx`
3. Define intent descriptor in `/src/intents/[intent_name].intent.ts`
4. Test with mock payload

Example:
```tsx
// src/components/intents/ScreenIntelligenceHighlight.tsx
export default function ScreenIntelligenceHighlight({ payload, onEvent }) {
  // Render highlight overlay based on OCR coordinates
  return <div className="highlight-ring">...</div>;
}
```

## IPC Events

### Incoming (from main)
- `overlay:update` - New overlay payload to render

### Outgoing (to main)
- `overlay:ready` - Overlay initialized
- `overlay:event` - User interaction (button click, etc.)

## TODO

- [ ] Implement OCR entity anchoring for results card
- [ ] Add keyboard shortcuts (ESC to dismiss)
- [ ] Ghost pointer implementation
- [ ] Screen intelligence components
- [ ] Command guide components
- [ ] Voice input integration
- [ ] Animations for state transitions
- [ ] Accessibility (ARIA labels, keyboard navigation)
