/**
 * Dynamic Intent Card
 * 
 * Example component showing how intent window can dynamically resize
 * and respond to ghost window hover events
 */

import { useEffect, useState } from 'react';
import { onGhostHover, animateToHighlightedItem, resizeIntentWindow, INTENT_SIZES } from '../utils/overlayPosition';
import type { HoverData } from '../utils/overlayPosition';

interface DynamicIntentCardProps {
  initialSize?: 'small' | 'medium' | 'large';
  children?: React.ReactNode;
}

export default function DynamicIntentCard({ initialSize = 'medium', children }: DynamicIntentCardProps) {
  const [hoverData, setHoverData] = useState<HoverData | null>(null);
  const [cardSize, setCardSize] = useState(initialSize);

  // Listen for hover events from ghost window
  useEffect(() => {
    console.log('🎯 [INTENT CARD] Setting up ghost hover listener');
    
    const cleanup = onGhostHover((data) => {
      console.log('👻 [INTENT CARD] Received hover data:', data);
      setHoverData(data);
      
      // Animate to the highlighted item
      const size = INTENT_SIZES.MEDIUM_CARD;
      animateToHighlightedItem(
        data.x,
        data.y,
        data.width,
        data.height,
        size.width,
        size.height
      );
    });

    return cleanup;
  }, []);

  // Handle card size changes
  const handleResize = (size: 'small' | 'medium' | 'large') => {
    setCardSize(size);
    const dimensions = size === 'small' 
      ? INTENT_SIZES.SMALL_CARD 
      : size === 'medium' 
      ? INTENT_SIZES.MEDIUM_CARD 
      : INTENT_SIZES.LARGE_CARD;
    
    resizeIntentWindow(dimensions.width, dimensions.height, true);
  };

  return (
    <div className="w-full h-full bg-gray-900/98 backdrop-blur-xl rounded-2xl border border-gray-600 shadow-2xl overflow-hidden">
      {/* Header with size controls */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <h3 className="text-white font-semibold">Dynamic Intent Card</h3>
        <div className="flex gap-2">
          <button
            onClick={() => handleResize('small')}
            className={`px-2 py-1 rounded text-xs ${
              cardSize === 'small' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'
            }`}
          >
            S
          </button>
          <button
            onClick={() => handleResize('medium')}
            className={`px-2 py-1 rounded text-xs ${
              cardSize === 'medium' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'
            }`}
          >
            M
          </button>
          <button
            onClick={() => handleResize('large')}
            className={`px-2 py-1 rounded text-xs ${
              cardSize === 'large' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300'
            }`}
          >
            L
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="p-4 overflow-auto" style={{ maxHeight: 'calc(100% - 60px)' }}>
        {hoverData && (
          <div className="mb-4 p-3 bg-blue-900/30 rounded-lg border border-blue-700">
            <p className="text-blue-300 text-sm font-medium mb-2">Hovering over:</p>
            <p className="text-white text-xs">Type: {hoverData.type}</p>
            <p className="text-white text-xs">Position: ({hoverData.x}, {hoverData.y})</p>
            <p className="text-white text-xs">Size: {hoverData.width}×{hoverData.height}</p>
            {hoverData.content && (
              <p className="text-gray-300 text-xs mt-2 truncate">Content: {hoverData.content}</p>
            )}
          </div>
        )}

        {children || (
          <div className="text-gray-400 text-sm">
            <p className="mb-2">This card demonstrates dynamic intent window behavior:</p>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li>Resizes dynamically (S/M/L buttons)</li>
              <li>Animates to highlighted items from ghost window</li>
              <li>Responds to hover events</li>
              <li>Can contain any UI: buttons, dropdowns, forms, etc.</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
