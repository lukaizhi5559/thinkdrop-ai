import React from 'react';
import { Button } from './ui/button';
import { useLocalLLM } from '../contexts/LocalLLMContext';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from './ui/tooltip';
import { Zap, Clock } from 'lucide-react';

export const PipelineToggle: React.FC = () => {
  const { useNewPipeline, setUseNewPipeline } = useLocalLLM();

  return (
    <TooltipProvider>
      <div className="flex items-center justify-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setUseNewPipeline(!useNewPipeline)}
              className={`flex items-center space-x-2 px-3 py-1 rounded-lg transition-all duration-200 ${
                useNewPipeline 
                  ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30' 
                  : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
              }`}
            >
              {useNewPipeline ? (
                <Zap className="h-4 w-4" />
              ) : (
                <Clock className="h-4 w-4" />
              )}
              <span className="text-xs font-medium">
                {useNewPipeline ? 'NEW' : 'OLD'}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <div className="text-sm max-w-xs">
              {useNewPipeline ? (
                <div>
                  <div className="font-semibold text-yellow-400">⚡ New Ultra-Fast Pipeline</div>
                  <div className="mt-1 text-gray-300">Uses llm-query handler:</div>
                  <ul className="text-xs mt-1 space-y-1">
                    <li>• Progressive search pipeline</li>
                    <li>• Context vs Non-Context routing</li>
                    <li>• Sub-2-second response times</li>
                  </ul>
                  <div className="mt-2 text-xs text-gray-400">Click to switch to OLD pipeline</div>
                </div>
              ) : (
                <div>
                  <div className="font-semibold text-blue-400">🕐 Legacy Pipeline</div>
                  <div className="mt-1 text-gray-300">Uses llm-query-local handler:</div>
                  <ul className="text-xs mt-1 space-y-1">
                    <li>• Traditional orchestration</li>
                    <li>• Full agent pipeline</li>
                    <li>• Stable and reliable</li>
                  </ul>
                  <div className="mt-2 text-xs text-gray-400">Click to switch to NEW pipeline</div>
                </div>
              )}
            </div>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
};

export default PipelineToggle;
