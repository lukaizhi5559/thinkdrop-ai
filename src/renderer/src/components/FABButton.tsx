/**
 * FAB Button - Floating Action Button with ripple effect
 * Features:
 * - Ripple animation on click
 * - Drop sound effect
 * - Pulsing animation during execution
 * - Toggles chat overlay visibility
 */

import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle } from 'lucide-react';

interface FABButtonProps {
  onClick: () => void;
  isExecuting?: boolean;
  isActive?: boolean;
}

export const FABButton: React.FC<FABButtonProps> = ({
  onClick,
  isExecuting = false,
  isActive = false
}) => {
  const [ripples, setRipples] = useState<Array<{ x: number; y: number; id: number }>>([]);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Initialize audio
  useEffect(() => {
    // Create drop sound (simple beep using Web Audio API)
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    const createDropSound = () => {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800; // Hz
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.2);
    };

    // Store the function for later use
    (window as any).__fabDropSound = createDropSound;

    return () => {
      audioContext.close();
    };
  }, []);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Play drop sound
    if ((window as any).__fabDropSound) {
      try {
        (window as any).__fabDropSound();
      } catch (err) {
        console.warn('Failed to play drop sound:', err);
      }
    }

    // Create ripple effect
    const button = buttonRef.current;
    if (button) {
      const rect = button.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      const newRipple = { x, y, id: Date.now() };
      setRipples(prev => [...prev, newRipple]);

      // Remove ripple after animation
      setTimeout(() => {
        setRipples(prev => prev.filter(r => r.id !== newRipple.id));
      }, 600);
    }

    onClick();
  };

  return (
    <>
      {/* SVG Filter for ripple effect */}
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <filter id="ripple-filter">
            <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"
              result="goo"
            />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>

      <button
        ref={buttonRef}
        onClick={handleClick}
        className={`
          fixed bottom-8 right-8 z-50
          w-16 h-16 rounded-full
          bg-gradient-to-br from-teal-500 to-blue-500
          hover:from-teal-600 hover:to-blue-600
          shadow-2xl
          flex items-center justify-center
          transition-all duration-300
          overflow-hidden
          ${isExecuting ? 'animate-pulse' : ''}
          ${isActive ? 'ring-4 ring-teal-400/50' : ''}
        `}
        style={{ filter: 'url(#ripple-filter)' }}
      >
        {/* Thinkdrop Logo / Icon */}
        <MessageCircle 
          size={28} 
          className="text-white relative z-10"
          strokeWidth={2}
        />

        {/* Ripple animations */}
        {ripples.map(ripple => (
          <span
            key={ripple.id}
            className="absolute rounded-full bg-white/30 pointer-events-none animate-ripple"
            style={{
              left: ripple.x,
              top: ripple.y,
              width: '10px',
              height: '10px',
              transform: 'translate(-50%, -50%)'
            }}
          />
        ))}

        {/* Pulsing ring during execution */}
        {isExecuting && (
          <span className="absolute inset-0 rounded-full border-4 border-teal-400 animate-ping opacity-75" />
        )}
      </button>

      <style>{`
        @keyframes ripple {
          0% {
            transform: translate(-50%, -50%) scale(0);
            opacity: 1;
          }
          100% {
            transform: translate(-50%, -50%) scale(20);
            opacity: 0;
          }
        }

        .animate-ripple {
          animation: ripple 0.6s ease-out;
        }
      `}</style>
    </>
  );
};
