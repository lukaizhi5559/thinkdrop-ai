import { signal } from '@preact/signals-react';
import type { OverlayPayload } from '../../../types/overlay-intents';

// Overlay state signal - using signal to avoid re-render issues
export const overlayPayloadSignal = signal<OverlayPayload | null>(null);
