/**
 * Ghost Overlay Component
 * 
 * Renders in the ghost window (full-screen, click-through)
 * Displays:
 * - Ghost mouse cursor
 * - Border highlights around items
 * - Visual cues
 * - Loading animations
 */

import { useState, useEffect } from 'react';
import { sendGhostHoverData } from '../utils/overlayPosition';

interface HighlightedItem {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  type: 'text' | 'image' | 'button' | 'element';
  content?: string;
}

export default function GhostOverlay() {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [highlightedItems, setHighlightedItems] = useState<HighlightedItem[]>([]);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);

  // Track mouse position
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
      
      // Check if hovering over any highlighted item
      const item = highlightedItems.find(
        (item) =>
          e.clientX >= item.x &&
          e.clientX <= item.x + item.width &&
          e.clientY >= item.y &&
          e.clientY <= item.y + item.height
      );

      if (item && hoveredItem !== item.id) {
        setHoveredItem(item.id);
        // Send hover data to intent window
        sendGhostHoverData({
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
          type: item.type,
          content: item.content,
        });
      } else if (!item && hoveredItem) {
        setHoveredItem(null);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [highlightedItems, hoveredItem]);

  // Demo: Add some sample highlighted items
  useEffect(() => {
    // In real implementation, these would come from OCR/screen analysis
    // Uncomment below to enable demo highlights:
    
    // const demoItems: HighlightedItem[] = [
    //   {
    //     id: 'demo-1',
    //     x: 100,
    //     y: 100,
    //     width: 200,
    //     height: 50,
    //     type: 'text',
    //     content: 'Sample Text',
    //   },
    //   {
    //     id: 'demo-2',
    //     x: 400,
    //     y: 300,
    //     width: 150,
    //     height: 150,
    //     type: 'image',
    //     content: 'Sample Image',
    //   },
    // ];
    // setHighlightedItems(demoItems);
  }, []);

  return (
    <div className="w-full h-full pointer-events-none">
      {/* Ghost mouse cursor */}
      <div
        className="fixed w-6 h-6 bg-blue-500/50 rounded-full border-2 border-blue-400 pointer-events-none transition-transform duration-75"
        style={{
          left: mousePos.x - 12,
          top: mousePos.y - 12,
          transform: 'scale(1)',
        }}
      >
        <div className="absolute inset-0 bg-blue-400/30 rounded-full animate-ping" />
      </div>

      {/* Highlighted items borders */}
      {highlightedItems.map((item) => (
        <div
          key={item.id}
          className={`fixed border-2 rounded-lg transition-all duration-200 pointer-events-none ${
            hoveredItem === item.id
              ? 'border-blue-500 bg-blue-500/10 shadow-lg shadow-blue-500/50'
              : 'border-blue-400/50 bg-blue-400/5'
          }`}
          style={{
            left: item.x,
            top: item.y,
            width: item.width,
            height: item.height,
          }}
        >
          {/* Label */}
          {hoveredItem === item.id && item.content && (
            <div className="absolute -top-6 left-0 px-2 py-1 bg-blue-600 text-white text-xs rounded shadow-lg whitespace-nowrap">
              {item.content}
            </div>
          )}
        </div>
      ))}

      {/* Loading pulse animation (example) */}
      {/* <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className="w-16 h-16 bg-blue-500/30 rounded-full animate-pulse" />
      </div> */}
    </div>
  );
}
