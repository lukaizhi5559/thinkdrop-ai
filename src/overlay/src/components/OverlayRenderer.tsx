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

interface OverlayRendererProps {
  payload: OverlayPayload;
  onEvent: (event: any) => void;
}

export default function OverlayRenderer({ payload, onEvent }: OverlayRendererProps) {
  const { intent, uiVariant, slots } = payload;

  // Route to appropriate component based on intent + variant
  const renderComponent = () => {
    switch (intent) {
      case 'web_search':
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
            console.warn(`Unknown web_search variant: ${uiVariant}`);
            return null;
        }

      // TODO: Add other intents
      case 'screen_intelligence':
      case 'command_guide':
      case 'command_execute':
        console.warn(`Intent ${intent} not yet implemented`);
        return null;

      default:
        console.warn(`Unknown intent: ${intent}`);
        return null;
    }
  };

  return (
    <div className="overlay-content fade-in">
      {renderComponent()}
    </div>
  );
}
