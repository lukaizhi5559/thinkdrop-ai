import React, { useState, useEffect } from 'react';
import { 
  Eye, 
  Search, 
  ChevronDown, 
  ChevronRight,
  Square,
  Circle,
  Type,
  Link as LinkIcon,
  Image as ImageIcon,
  CheckSquare,
  Menu,
  Layers
} from 'lucide-react';
import { Button } from './ui/button';

interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ScreenElement {
  role: string;
  label: string;
  value: string;
  description?: string;
  bounds: ElementBounds;
  confidence?: number;
  source?: string;
  actions?: string[];
  windowTitle?: string;
  appName?: string;
}

interface VisionPanelProps {
  // Reserved for future use
}

// Role to icon mapping
const getRoleIcon = (role: string) => {
  const iconMap: Record<string, React.ReactNode> = {
    button: <Square className="w-4 h-4" />,
    textfield: <Type className="w-4 h-4" />,
    textarea: <Type className="w-4 h-4" />,
    link: <LinkIcon className="w-4 h-4" />,
    image: <ImageIcon className="w-4 h-4" />,
    icon: <Circle className="w-4 h-4" />,
    checkbox: <CheckSquare className="w-4 h-4" />,
    select: <Menu className="w-4 h-4" />,
    heading: <Type className="w-4 h-4" />,
    text: <Type className="w-4 h-4" />,
  };
  return iconMap[role] || <Layers className="w-4 h-4" />;
};

// Role to color mapping
const getRoleColor = (role: string): string => {
  const colorMap: Record<string, string> = {
    button: 'text-orange-400',
    textfield: 'text-blue-400',
    textarea: 'text-blue-400',
    link: 'text-purple-400',
    image: 'text-green-400',
    icon: 'text-gray-400',
    checkbox: 'text-yellow-400',
    select: 'text-cyan-400',
    heading: 'text-pink-400',
    text: 'text-gray-300',
  };
  return colorMap[role] || 'text-gray-400';
};

const VisionPanel: React.FC<VisionPanelProps> = () => {
  const [elements, setElements] = useState<ScreenElement[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedElement, setSelectedElement] = useState<ScreenElement | null>(null);
  const [expandedWindows, setExpandedWindows] = useState<Set<string>>(new Set());

  // Fetch screen elements from screen-intelligence service
  const fetchScreenElements = async () => {
    setLoading(true);
    try {
      // Call the screen-intelligence service via IPC
      const result = await (window as any).electronAPI.mcpCall({
        serviceName: 'screen-intelligence',
        action: 'screen.describe',
        payload: {
          includeHidden: false,
          showOverlay: false
        }
      }); 

      console.log('Vision Panel: Full MCP result:', JSON.stringify(result, null, 2));
 
      // Check if MCP call was successful
      if (!result || !result.success) {
        console.error('Vision Panel: MCP call failed:', result?.error || 'Unknown error');
        setElements([]);
        setLoading(false);
        return;
      }

      // Extract elements from the result
      let allElements: ScreenElement[] = [];
      
      // The data is in result.data
      const data = result.data;
      console.log('Vision Panel: Data structure:', {
        hasData: !!data,
        hasWindows: !!data?.windows,
        windowsIsArray: Array.isArray(data?.windows),
        windowsLength: data?.windows?.length,
        hasElements: !!data?.elements,
        elementsIsArray: Array.isArray(data?.elements)
      });
      
      if (data?.windows && Array.isArray(data.windows)) {
        console.log('Vision Panel: Processing windows:', data.windows.length);
        // Flatten elements from all windows
        data.windows.forEach((window: any, idx: number) => {
          console.log(`Vision Panel: Window ${idx}:`, {
            title: window.title,
            appName: window.appName,
            hasElements: !!window.elements,
            elementCount: window.elements?.length
          });
          
          if (window.elements && Array.isArray(window.elements)) {
            const windowElements = window.elements.map((el: any) => ({
              ...el,
              windowTitle: window.title || window.appName,
              appName: window.appName
            }));
            allElements = allElements.concat(windowElements);
          }
        });
      } else if (data?.elements && Array.isArray(data.elements)) {
        // Fallback: elements at root level
        console.log('Vision Panel: Using root-level elements:', data.elements.length);
        allElements = data.elements;
      }

      console.log('Vision Panel: Total extracted elements:', allElements.length);
      setElements(allElements);
      
      // Auto-expand first window
      if (allElements.length > 0) {
        const firstWindow = allElements[0].windowTitle || allElements[0].appName || 'Unknown';
        setExpandedWindows(new Set([firstWindow]));
      }
    } catch (error) {
      console.error('Vision Panel: Exception during fetch:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchScreenElements();
  }, []);

  // Group elements by window
  const elementsByWindow = elements.reduce((acc, element) => {
    const windowKey = element.windowTitle || element.appName || 'Unknown Window';
    if (!acc[windowKey]) {
      acc[windowKey] = [];
    }
    acc[windowKey].push(element);
    return acc;
  }, {} as Record<string, ScreenElement[]>);

  // Filter elements by search query
  const filteredWindows = Object.entries(elementsByWindow).reduce((acc, [window, windowElements]) => {
    if (!searchQuery) {
      acc[window] = windowElements;
      return acc;
    }

    const query = searchQuery.toLowerCase();
    const filtered = windowElements.filter(el => 
      el.label?.toLowerCase().includes(query) ||
      el.value?.toLowerCase().includes(query) ||
      el.role?.toLowerCase().includes(query) ||
      el.description?.toLowerCase().includes(query)
    );

    if (filtered.length > 0 || window.toLowerCase().includes(query)) {
      acc[window] = filtered.length > 0 ? filtered : windowElements;
    }

    return acc;
  }, {} as Record<string, ScreenElement[]>);

  const toggleWindow = (windowKey: string) => {
    const newExpanded = new Set(expandedWindows);
    if (newExpanded.has(windowKey)) {
      newExpanded.delete(windowKey);
    } else {
      newExpanded.add(windowKey);
    }
    setExpandedWindows(newExpanded);
  };

  const highlightElement = (element: ScreenElement) => {
    // Send IPC to show highlight overlay
    console.log('Highlighting element:', element);
    (window as any).electronAPI.highlightElement({
      bounds: element.bounds,
      role: element.role,
      label: element.label,
      value: element.value,
      confidence: element.confidence
    });
  };

  return (
    <div className="flex flex-col h-full bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <Eye className="w-5 h-5 text-purple-400" />
          <h2 className="text-lg font-semibold">Vision Panel</h2>
          <span className="text-xs text-white/50">
            {elements.length} elements
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={fetchScreenElements}
          disabled={loading}
          className="text-white/70 hover:text-white"
        >
          {loading ? 'Analyzing...' : 'Refresh'}
        </Button>
      </div>

      {/* Search */}
      <div className="p-4 border-b border-white/10">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
          <input
            type="text"
            placeholder="Search elements..."
            value={searchQuery}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
            className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-white/40 rounded-md px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-purple-500/50"
          />
        </div>
      </div>

      {/* Element Tree */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-white/50">
            <div className="text-center">
              <Eye className="w-12 h-12 mx-auto mb-2 animate-pulse" />
              <p>Analyzing screen...</p>
            </div>
          </div>
        ) : Object.keys(filteredWindows).length === 0 ? (
          <div className="flex items-center justify-center h-full text-white/50">
            <div className="text-center">
              <Eye className="w-12 h-12 mx-auto mb-2" />
              <p>No elements found</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={fetchScreenElements}
                className="mt-4"
              >
                Analyze Screen
              </Button>
            </div>
          </div>
        ) : (
          <div className="p-2">
            {Object.entries(filteredWindows).map(([windowKey, windowElements]) => {
              const isExpanded = expandedWindows.has(windowKey);
              
              return (
                <div key={windowKey} className="mb-2">
                  {/* Window Header */}
                  <button
                    onClick={() => toggleWindow(windowKey)}
                    className="w-full flex items-center gap-2 p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-white/50" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-white/50" />
                    )}
                    <Eye className="w-4 h-4 text-blue-400" />
                    <span className="flex-1 text-left font-medium truncate">
                      {windowKey}
                    </span>
                    <span className="text-xs text-white/40 bg-white/5 px-2 py-1 rounded">
                      {windowElements.length}
                    </span>
                  </button>

                  {/* Window Elements */}
                  {isExpanded && (
                    <div className="ml-6 mt-1 space-y-1">
                      {windowElements.map((element, idx) => {
                        const isSelected = selectedElement === element;
                        
                        return (
                          <div key={idx}>
                            {/* Element Item */}
                            <button
                              onClick={() => {
                                setSelectedElement(isSelected ? null : element);
                                if (!isSelected) {
                                  highlightElement(element);
                                }
                              }}
                              className={`w-full flex items-center gap-2 p-2 rounded-lg transition-colors ${
                                isSelected
                                  ? 'bg-purple-500/20 border border-purple-500/30'
                                  : 'bg-white/5 hover:bg-white/10'
                              }`}
                            >
                              <span className={getRoleColor(element.role)}>
                                {getRoleIcon(element.role)}
                              </span>
                              <div className="flex-1 text-left min-w-0">
                                <div className="text-sm font-medium truncate">
                                  {element.label || element.value || element.description || 'Unnamed'}
                                </div>
                                <div className="text-xs text-white/40">
                                  {element.role}
                                  {element.confidence && (
                                    <span className="ml-2">
                                      {Math.round(element.confidence * 100)}%
                                    </span>
                                  )}
                                </div>
                              </div>
                            </button>

                            {/* Element Details (Expanded) */}
                            {isSelected && (
                              <div className="ml-6 mt-2 p-3 rounded-lg bg-black/20 border border-white/10 text-xs space-y-2">
                                {element.value && (
                                  <div>
                                    <span className="text-white/50">Value:</span>
                                    <div className="text-white/80 mt-1 font-mono">
                                      {element.value}
                                    </div>
                                  </div>
                                )}
                                {element.description && (
                                  <div>
                                    <span className="text-white/50">Description:</span>
                                    <div className="text-white/80 mt-1">
                                      {element.description}
                                    </div>
                                  </div>
                                )}
                                <div>
                                  <span className="text-white/50">Bounds:</span>
                                  <div className="text-white/80 mt-1 font-mono">
                                    x: {element.bounds.x}, y: {element.bounds.y}, 
                                    w: {element.bounds.width}, h: {element.bounds.height}
                                  </div>
                                </div>
                                {element.source && (
                                  <div>
                                    <span className="text-white/50">Source:</span>
                                    <div className="text-white/80 mt-1">
                                      {element.source}
                                    </div>
                                  </div>
                                )}
                                {element.actions && element.actions.length > 0 && (
                                  <div>
                                    <span className="text-white/50">Actions:</span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                      {element.actions.map((action, i) => (
                                        <span
                                          key={i}
                                          className="px-2 py-1 bg-white/10 rounded text-white/70"
                                        >
                                          {action}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Stats Footer */}
      <div className="p-4 border-t border-white/10 bg-black/20">
        <div className="grid grid-cols-3 gap-4 text-center text-xs">
          <div>
            <div className="text-white/50">Windows</div>
            <div className="text-lg font-semibold text-white">
              {Object.keys(elementsByWindow).length}
            </div>
          </div>
          <div>
            <div className="text-white/50">Elements</div>
            <div className="text-lg font-semibold text-white">
              {elements.length}
            </div>
          </div>
          <div>
            <div className="text-white/50">Selected</div>
            <div className="text-lg font-semibold text-purple-400">
              {selectedElement ? '1' : '0'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VisionPanel;
