/**
 * Overlay Renderer Component
 * 
 * Dynamically renders UI components based on intent and variant
 * Routes to specific component implementations
 */

import { OverlayPayload } from '../../../types/overlay-intents';
import WebSearchChoice from './intents/WebSearchChoice';
import WebSearchResults from './intents/WebSearchResults';
import WebSearchLoading from './intents/WebSearchLoading';
import WebSearchError from './intents/WebSearchError';
import ScreenIntelligenceResults from './intents/ScreenIntelligenceResults';
import CommandExecuteResults from './intents/CommandExecuteResults';
import CommandAutomateProgress from './intents/CommandAutomateProgress';

interface OverlayRendererProps {
  payload: OverlayPayload;
  onEvent: (event: any) => void;
}

export default function OverlayRenderer({ payload, onEvent }: OverlayRendererProps) {
  const { intent, uiVariant } = payload;

  // Route to appropriate component based on intent + variant
  const renderComponent = () => {
    switch (intent) {
      case 'web_search':
      case 'question':
        // Both web_search and question intents use the same UI components
        switch (uiVariant) {
          case 'choice':
            return <WebSearchChoice payload={payload} onEvent={onEvent} />;
          case 'loading':
            return <WebSearchLoading payload={payload} />;
          case 'results':
            return <WebSearchResults payload={payload} onEvent={onEvent} />;
          case 'error':
            return <WebSearchError payload={payload} onEvent={onEvent} />;
          default:
            console.warn(`Unknown ${intent} variant: ${uiVariant}`);
            return null;
        }

      // Screen intelligence intent
      case 'screen_intelligence':
        switch (uiVariant) {
          case 'loading':
            return <WebSearchLoading payload={payload} />;
          case 'results':
            return <ScreenIntelligenceResults payload={payload} onEvent={onEvent} />;
          case 'error':
            return <ScreenIntelligenceResults payload={payload} onEvent={onEvent} />;
          default:
            console.warn(`Unknown screen_intelligence variant: ${uiVariant}`);
            return null;
        }

      // Command execution intent
      case 'command_execute':
        switch (uiVariant) {
          case 'loading':
            return <WebSearchLoading payload={payload} />;
          case 'results':
            return <CommandExecuteResults payload={payload} onEvent={onEvent} />;
          case 'error':
            return <CommandExecuteResults payload={payload} onEvent={onEvent} />;
          default:
            console.warn(`Unknown ${intent} variant: ${uiVariant}`);
            return null;
        }

      // Command automation intent (structured plan execution)
      case 'command_automate':
        switch (uiVariant) {
          case 'loading':
            return <WebSearchLoading payload={payload} />;
          case 'automation_progress':
            return <CommandAutomateProgress payload={payload} onEvent={onEvent} />;
          case 'error':
            return <CommandExecuteResults payload={payload} onEvent={onEvent} />;
          default:
            console.warn(`Unknown ${intent} variant: ${uiVariant}`);
            return null;
        }

      // Command guide intent (interactive guide mode)
      case 'command_guide':
        switch (uiVariant) {
          case 'loading':
            return <WebSearchLoading payload={payload} />;
          case 'guide_renderer':
            // TODO: Create CommandGuideRenderer component in Phase 4
            return <CommandExecuteResults payload={payload} onEvent={onEvent} />;
          case 'error':
            return <CommandExecuteResults payload={payload} onEvent={onEvent} />;
          default:
            console.warn(`Unknown ${intent} variant: ${uiVariant}`);
            return null;
        }

      default:
        console.warn(`Unknown intent: ${intent}`);
        return null;
    }
  };

  return (renderComponent());
}
