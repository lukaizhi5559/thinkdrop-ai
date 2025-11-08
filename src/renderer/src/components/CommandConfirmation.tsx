import { AlertTriangle, Check, X } from 'lucide-react';
import { Button } from './ui/button';

interface CommandConfirmationProps {
  command: string;
  category: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  onApprove: () => void;
  onReject: () => void;
}

export function CommandConfirmation({
  command,
  category,
  riskLevel,
  onApprove,
  onReject
}: CommandConfirmationProps) {
  const riskColors = {
    low: 'text-green-400 border-green-500/30 bg-green-500/10',
    medium: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10',
    high: 'text-orange-400 border-orange-500/30 bg-orange-500/10',
    critical: 'text-red-400 border-red-500/30 bg-red-500/10'
  };

  const riskLabels = {
    low: 'Low Risk',
    medium: 'Medium Risk',
    high: 'High Risk',
    critical: 'Critical Risk'
  };

  return (
    <div className="w-full max-w-md bg-slate-800/90 border border-white/15 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-sm">
      {/* Header with gradient background */}
      <div className="bg-gradient-to-r from-orange-500/15 to-yellow-500/50 border-b border-white/10 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-yellow-500/20 rounded-lg">
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
          </div>
          <div>
            <h3 className="text-white font-semibold text-base">Command Confirmation Required</h3>
            <p className="text-white/50 text-xs mt-0.5">Review and approve the command before execution</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-5 py-4 space-y-3.5">
        {/* Command Details */}
        <div className="space-y-2">
          <div className="text-xs text-white/60 font-medium">Command to execute:</div>
          <div className="bg-black/30 rounded-lg p-3 font-mono text-sm text-white/90 border border-white/10 break-all">
            {command}
          </div>
        </div>

        {/* Risk Badge and Category */}
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className={`px-2.5 py-1 rounded-md text-xs font-semibold border ${riskColors[riskLevel]}`}>
            {riskLabels[riskLevel]}
          </div>
          <div className="text-xs text-white/50">
            <span className="text-white/40">Category:</span> <span className="text-white/60 font-medium">{category}</span>
          </div>
        </div>

        {/* Warning Message */}
        {(riskLevel === 'high' || riskLevel === 'critical') && (
          <div className="text-xs text-yellow-400/90 bg-yellow-500/10 border border-yellow-500/25 rounded-lg p-2.5 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>This command may modify system state. Please review carefully before approving.</span>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="px-5 pb-5 flex gap-2.5">
        <Button
          onClick={onApprove}
          className="flex-1 bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/40 hover:border-green-500/60 h-11 text-sm font-semibold transition-all"
        >
          <Check className="w-4 h-4 mr-2" />
          Approve
        </Button>
        <Button
          onClick={onReject}
          variant="ghost"
          className="flex-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/40 hover:border-red-500/60 h-11 text-sm font-semibold transition-all"
        >
          <X className="w-4 h-4 mr-2" />
          Reject
        </Button>
      </div>
    </div>
  );
}
