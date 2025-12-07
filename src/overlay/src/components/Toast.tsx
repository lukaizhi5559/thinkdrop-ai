/**
 * Toast Notification Component
 * 
 * Displays non-intrusive toast notifications above the PromptBar
 * - Slides up from bottom
 * - Auto-dismisses or can be manually closed
 * - Supports action buttons
 */

import { useEffect, useState } from 'react';
import { X, AlertCircle, Lock, Info, CheckCircle } from 'lucide-react';

export interface ToastAction {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
}

export interface ToastProps {
  id: string;
  type: 'error' | 'warning' | 'info' | 'success';
  title: string;
  message: string;
  actions?: ToastAction[];
  duration?: number; // Auto-dismiss after duration (ms), 0 = no auto-dismiss
  onClose: (id: string) => void;
}

export default function Toast({
  id,
  type,
  title,
  message,
  actions = [],
  duration = 5000,
  onClose
}: ToastProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Trigger entrance animation
    requestAnimationFrame(() => {
      setIsVisible(true);
    });

    // Auto-dismiss if duration is set
    if (duration > 0) {
      const timer = setTimeout(() => {
        handleClose();
      }, duration);

      return () => clearTimeout(timer);
    }
  }, [duration]);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      onClose(id);
    }, 300); // Match animation duration
  };

  const getIcon = () => {
    switch (type) {
      case 'error':
        return <AlertCircle className="w-5 h-5 text-red-400" />;
      case 'warning':
        return <Lock className="w-5 h-5 text-yellow-400" />;
      case 'info':
        return <Info className="w-5 h-5 text-blue-400" />;
      case 'success':
        return <CheckCircle className="w-5 h-5 text-green-400" />;
    }
  };

  const getColorClasses = () => {
    switch (type) {
      case 'error':
        return 'bg-red-500/10 border-red-500/30';
      case 'warning':
        return 'bg-yellow-500/10 border-yellow-500/30';
      case 'info':
        return 'bg-blue-500/10 border-blue-500/30';
      case 'success':
        return 'bg-green-500/10 border-green-500/30';
    }
  };

  return (
    <div
      className={`
        ${getColorClasses()}
        backdrop-blur-xl rounded-xl border shadow-2xl
        transition-all duration-300 ease-out
        ${isVisible && !isExiting ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'}
        mb-2
      `}
    >
      {/* Header */}
      <div className="flex items-start gap-3 p-4">
        {/* Icon */}
        <div className="flex-shrink-0 mt-0.5">
          {getIcon()}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <h4 className="text-white font-medium text-sm mb-1">
            {title}
          </h4>
          <p className="text-white/70 text-xs leading-relaxed">
            {message}
          </p>

          {/* Actions */}
          {actions.length > 0 && (
            <div className="flex items-center gap-2 mt-3">
              {actions.map((action, index) => (
                <button
                  key={index}
                  onClick={() => {
                    action.onClick();
                    handleClose();
                  }}
                  className={`
                    px-3 py-1.5 rounded-lg text-xs font-medium
                    transition-all duration-200
                    ${action.variant === 'primary'
                      ? 'bg-blue-500 hover:bg-blue-600 text-white'
                      : 'bg-white/10 hover:bg-white/20 text-white/90'
                    }
                  `}
                >
                  {action.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Close Button */}
        <button
          onClick={handleClose}
          className="
            flex-shrink-0 p-1 rounded-lg
            hover:bg-white/10
            transition-colors
            text-white/60 hover:text-white
          "
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
