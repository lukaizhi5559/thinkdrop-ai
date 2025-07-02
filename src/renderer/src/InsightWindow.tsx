import React, { useState, useEffect } from 'react';
import { Droplet, X, ChevronDown, ChevronRight, AlertTriangle, HelpCircle, Sparkles, MessageSquare } from 'lucide-react';
import { Button } from './components/ui/button';

interface InsightData {
  summary: string[];
  introduction: string[];
  actions: Array<{
    text: string;
    priority: 'high' | 'normal' | 'low';
    icon: string;
  }>;
  contextFeed: string[];
  followUps: string[];
}

interface CollapsiblePanelProps {
  title: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  icon?: React.ReactNode;
}

function CollapsiblePanel({ title, children, defaultExpanded = true, icon }: CollapsiblePanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="border-b border-white/10 last:border-b-0">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-white/5 transition-colors"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="flex items-center space-x-3">
          {icon && <div className="text-white/70">{icon}</div>}
          <span className="text-white/90 font-medium text-sm">{title}</span>
        </div>
        {isExpanded ? (
          <ChevronDown className="w-4 h-4 text-white/50" />
        ) : (
          <ChevronRight className="w-4 h-4 text-white/50" />
        )}
      </button>
      {isExpanded && (
        <div className="px-4 pb-4">
          {children}
        </div>
      )}
    </div>
  );
}

export default function InsightWindow() {
  const [insightData, setInsightData] = useState<InsightData>({
    summary: [
      "System mentions 'Regulation' and 'now'",
    ],
    introduction: [
      "System mentions 'Regulation' and 'now'",
      "AI systems decide medical care, loans, and job interviews, often without oversight.",
      "The tech industry advocates for unmonitored AI decision-making.",
      "Powerful companies mounting unprecedented lobbying efforts.",
    ],
    actions: [
      {
        text: "Address objection: AI systems deciding critical human opportunities raises ethical concerns",
        priority: 'high',
        icon: '⚠️'
      },
      {
        text: "Address objection: AI systems deciding often illegally without oversight",
        priority: 'high', 
        icon: '⚠️'
      },
      {
        text: "Could state lawmakers be barred from regulating artificial intelligence?",
        priority: 'normal',
        icon: '❓'
      },
      {
        text: "What should I say next?",
        priority: 'low',
        icon: '✨'
      },
      {
        text: "Suggest follow-up questions",
        priority: 'low',
        icon: '💬'
      }
    ],
    contextFeed: [
      "Screen: Discussion about AI regulation and oversight",
      "Audio: Mentions of 'regulation', 'now', 'AI systems'",
      "Context: Debate about AI decision-making in critical areas",
    ],
    followUps: [
      "What are the specific ethical concerns with AI decision-making?",
      "How can we ensure proper oversight of AI systems?",
      "What role should state lawmakers play in AI regulation?",
      "Are there examples of AI systems making decisions without proper oversight?",
    ]
  });

  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Listen for insight updates from the main process
    if (window.electronAPI?.onInsightUpdate) {
      window.electronAPI.onInsightUpdate((_event: any, data: InsightData) => {
        setInsightData(data);
      });
    }
  }, []);

  const handleClose = () => {
    if (window.electronAPI?.hideInsight) {
      window.electronAPI.hideInsight();
    }
  };

  const handleSuggestNext = async () => {
    setIsLoading(true);
    // Simulate API call for suggestion
    setTimeout(() => {
      setIsLoading(false);
      // In real implementation, this would trigger the chat window with a suggestion
      if (window.electronAPI?.showChat) {
        window.electronAPI.showChat();
      }
    }, 1000);
  };

  const handleSuggestFollowup = async () => {
    setIsLoading(true);
    // Simulate API call for follow-up suggestions
    setTimeout(() => {
      setIsLoading(false);
      // In real implementation, this would trigger the chat window with follow-up questions
      if (window.electronAPI?.showChat) {
        window.electronAPI.showChat();
      }
    }, 1000);
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'high':
        return <AlertTriangle className="w-4 h-4 text-red-400" />;
      case 'normal':
        return <HelpCircle className="w-4 h-4 text-yellow-400" />;
      case 'low':
        return <Sparkles className="w-4 h-4 text-blue-400" />;
      default:
        return null;
    }
  };

  return (
    <div className="w-full h-screen flex flex-col bg-gray-900/95">
      {/* Draggable Header */}
      <div
        className="flex items-center space-x-2 p-4 pb-2 border-b border-white/10 cursor-move flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="w-6 h-6 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-lg flex items-center justify-center">
          <Droplet className="w-3 h-3 text-white" />
        </div>
        <span className="text-white/90 font-medium text-sm">Live Insights</span>
        <div className="flex-1" />
        <span className="text-white/50 text-xs">Drag to move</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClose}
          className="h-6 w-6 p-0 text-white/50 hover:text-white/90 hover:bg-white/10"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>

      {/* Content Container - Takes up remaining space and scrolls */}
      <div 
        className="flex-1 overflow-y-auto overflow-x-hidden"
        style={{ 
          WebkitAppRegion: 'no-drag',
          minHeight: 0,
          maxHeight: '100%'
        } as React.CSSProperties}
      >
        {/* Current Summary Panel */}
        <CollapsiblePanel 
          title="Current Summary" 
          defaultExpanded={true}
          icon={<Droplet className="w-4 h-4" />}
        >
          <div className="space-y-2">
            {insightData.summary.map((item, index) => (
              <div key={index} className="flex items-start space-x-2">
                <div className="w-1.5 h-1.5 bg-teal-400 rounded-full mt-2 flex-shrink-0"></div>
                <p className="text-white/70 text-sm leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
        </CollapsiblePanel>

        {/* Introduction Panel */}
        <CollapsiblePanel 
          title="Introduction" 
          defaultExpanded={true}
          icon={<MessageSquare className="w-4 h-4" />}
        >
          <div className="space-y-2">
            {insightData.introduction.map((item, index) => (
              <div key={index} className="flex items-start space-x-2">
                <div className="w-1.5 h-1.5 bg-blue-400 rounded-full mt-2 flex-shrink-0"></div>
                <p className="text-white/70 text-sm leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
        </CollapsiblePanel>

        {/* Actions Panel */}
        <CollapsiblePanel 
          title="Actions" 
          defaultExpanded={true}
          icon={<AlertTriangle className="w-4 h-4" />}
        >
          <div className="space-y-3">
            {insightData.actions.map((action, index) => (
              <div key={index} className="flex items-start space-x-3 p-3 bg-white/5 rounded-lg border border-white/10 hover:bg-white/10 transition-colors">
                <div className="flex items-center space-x-2 flex-shrink-0">
                  {getPriorityIcon(action.priority)}
                  <span className="text-sm">{action.icon}</span>
                </div>
                <p className="text-white/80 text-sm leading-relaxed flex-1">{action.text}</p>
              </div>
            ))}
          </div>
        </CollapsiblePanel>

        {/* Context Feed Panel */}
        <CollapsiblePanel 
          title="Context Feed" 
          defaultExpanded={false}
          icon={<HelpCircle className="w-4 h-4" />}
        >
          <div className="space-y-2">
            {insightData.contextFeed.map((item, index) => (
              <div key={index} className="p-2 bg-white/5 rounded border border-white/10">
                <p className="text-white/60 text-xs leading-relaxed">{item}</p>
              </div>
            ))}
          </div>
        </CollapsiblePanel>

        {/* Suggested Questions Panel */}
        <CollapsiblePanel 
          title="Suggested Questions" 
          defaultExpanded={false}
          icon={<Sparkles className="w-4 h-4" />}
        >
          <div className="space-y-2">
            {insightData.followUps.map((question, index) => (
              <div key={index} className="flex items-start space-x-2">
                <div className="w-1.5 h-1.5 bg-purple-400 rounded-full mt-2 flex-shrink-0"></div>
                <p className="text-white/70 text-sm leading-relaxed">{question}</p>
              </div>
            ))}
          </div>
        </CollapsiblePanel>
      </div>

      {/* Footer Actions */}
      <div 
        className="p-4 border-t border-white/10 flex-shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="flex space-x-3">
          <Button
            onClick={handleSuggestNext}
            disabled={isLoading}
            className="flex-1 bg-gradient-to-r from-teal-500 to-blue-500 hover:from-teal-600 hover:to-blue-600 text-white text-sm py-2 rounded-lg disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4 mr-2" />
            {isLoading ? 'Thinking...' : 'What should I say next?'}
          </Button>
          <Button
            onClick={handleSuggestFollowup}
            disabled={isLoading}
            className="flex-1 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white text-sm py-2 rounded-lg disabled:opacity-50"
          >
            <MessageSquare className="w-4 h-4 mr-2" />
            {isLoading ? 'Thinking...' : 'Suggest follow-up'}
          </Button>
        </div>
      </div>
    </div>
  );
}
