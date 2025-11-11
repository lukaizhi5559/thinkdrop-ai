import React from 'react';
import { AlertCircle } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  icon?: React.ReactNode;
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmText = 'OK',
  cancelText = 'Cancel',
  icon
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />
      
      {/* Dialog */}
      <div className="relative bg-[#2a2a2a] rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden border border-white/10">
        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Icon */}
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center">
              {icon || <AlertCircle className="w-8 h-8 text-blue-400" />}
            </div>
          </div>
          
          {/* Title */}
          <h2 className="text-xl font-semibold text-white text-center">
            {title}
          </h2>
          
          {/* Message */}
          <p className="text-white/70 text-center leading-relaxed">
            {message}
          </p>
        </div>
        
        {/* Actions */}
        <div className="flex gap-3 p-4 bg-black/20">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-medium transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-3 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-medium transition-colors"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
