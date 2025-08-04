import React, { useState, useCallback, useEffect } from 'react';
import { Search, Filter, Clock, Tag, ExternalLink, Star } from 'lucide-react';
import { useLocalLLM } from '../contexts/LocalLLMContext';

interface SearchResult {
  id: string;
  type: 'communication' | 'agent' | 'memory' | 'document';
  title: string;
  content: string;
  similarity: number;
  timestamp: string;
  source: string;
  tags: string[];
}

const SemanticSearchPanel: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'communication' | 'agent' | 'memory' | 'document'>('all');
  const [sortBy, setSortBy] = useState<'relevance' | 'date' | 'type'>('relevance');
  
  const { communications, cachedAgents } = useLocalLLM();

  // Perform semantic search
  const performSemanticSearch = useCallback(async (searchQuery: string): Promise<SearchResult[]> => {
    if (!searchQuery.trim()) return [];
    
    const results: SearchResult[] = [];
    
    // Search through communications
    communications.forEach((comm, index) => {
      if (comm.message_type === 'user_message' || comm.message_type === 'assistant_response') {
        results.push({
          id: `comm-${index}`,
          type: 'communication' as const,
          title: comm.message_type === 'user_message' ? 'User Message' : 'Assistant Response',
          content: comm.content || 'No content available',
          similarity: Math.random() * 0.3 + 0.7, // Mock similarity score
          timestamp: comm.timestamp || new Date().toISOString(),
          source: 'ChatInterface',
          tags: ['chat', comm.message_type.replace('_', '-')]
        });
      }
    });

    // Search through cached agents
    cachedAgents.forEach((agent, index) => {
      results.push({
        id: `agent-${index}`,
        type: 'agent' as const,
        title: agent.name || `Agent ${index + 1}`,
        content: `Agent instance: ${agent.name || 'Unknown'} - Status: Active`,
        similarity: Math.random() * 0.2 + 0.8, // Mock similarity score
        timestamp: new Date().toISOString(),
        source: 'AgentOrchestrator',
        tags: ['agent', 'cached']
      });
    });

    // Mock memory results
    const mockMemoryResults: SearchResult[] = [
      {
        id: 'memory-1',
        type: 'memory' as const,
        title: 'Project Deadline Discussion',
        content: 'Meeting notes about the Q1 project deadlines and resource allocation...',
        similarity: 0.89,
        timestamp: '2024-01-15T10:30:00Z',
        source: 'UserMemoryAgent',
        tags: ['project', 'deadline', 'meeting']
      },
      {
        id: 'memory-2',
        type: 'memory' as const,
        title: 'Code Review Feedback',
        content: 'Detailed feedback on the recent pull request including suggestions for optimization...',
        similarity: 0.76,
        timestamp: '2024-01-14T15:45:00Z',
        source: 'CodeAnalysisAgent',
        tags: ['code', 'review', 'feedback']
      },
      {
        id: 'document-1',
        type: 'document' as const,
        title: 'API Documentation',
        content: 'Comprehensive guide to the ThinkDrop API endpoints and authentication methods...',
        similarity: 0.82,
        timestamp: '2024-01-10T09:15:00Z',
        source: 'DocumentationSystem',
        tags: ['api', 'documentation', 'reference']
      }
    ];

    return [...results, ...mockMemoryResults];
  }, [communications, cachedAgents]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const results = await performSemanticSearch(searchQuery);
      setSearchResults(results);
    } catch (error) {
      console.error('Search error:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, performSemanticSearch]);

  // Auto-search on query change (debounced)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchQuery.trim()) {
        handleSearch();
      } else {
        setSearchResults([]);
      }
    }, 500);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, handleSearch]);

  // Filter and sort results
  const filteredAndSortedResults = searchResults
    .filter(result => selectedFilter === 'all' || result.type === selectedFilter)
    .sort((a, b) => {
      switch (sortBy) {
        case 'relevance':
          return b.similarity - a.similarity;
        case 'date':
          return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        case 'type':
          return a.type.localeCompare(b.type);
        default:
          return 0;
      }
    });

  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  const getTypeColor = (type: SearchResult['type']) => {
    switch (type) {
      case 'communication':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'agent':
        return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'memory':
        return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      case 'document':
        return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Search Header */}
      <div className="space-y-4 mb-6">
        <div className="flex items-center space-x-2">
          <Search className="w-5 h-5 text-teal-400" />
          <h3 className="text-lg font-semibold text-white">Semantic Search</h3>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search across conversations, agents, memory, and documents..."
            className="w-full pl-10 pr-4 py-3 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
          />
          {isSearching && (
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-teal-500"></div>
            </div>
          )}
        </div>

        {/* Filters and Sort */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Filter className="w-4 h-4 text-gray-400" />
            <select
              value={selectedFilter}
              onChange={(e) => setSelectedFilter(e.target.value as any)}
              className="bg-gray-800 border border-gray-600 rounded px-3 py-1 text-sm text-white"
            >
              <option value="all">All Types</option>
              <option value="communication">Communications</option>
              <option value="agent">Agents</option>
              <option value="memory">Memory</option>
              <option value="document">Documents</option>
            </select>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-400">Sort by:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="bg-gray-800 border border-gray-600 rounded px-3 py-1 text-sm text-white"
            >
              <option value="relevance">Relevance</option>
              <option value="date">Date</option>
              <option value="type">Type</option>
            </select>
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-auto">
        {filteredAndSortedResults.length > 0 ? (
          <div className="space-y-3">
            {filteredAndSortedResults.map((result) => (
              <div
                key={result.id}
                className="bg-gray-800/30 border border-gray-700 rounded-lg p-4 hover:bg-gray-800/50 transition-colors cursor-pointer"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <div className={`px-2 py-1 rounded-full text-xs font-medium border ${getTypeColor(result.type)}`}>
                      {result.type.toUpperCase()}
                    </div>
                    <h4 className="font-medium text-white">{result.title}</h4>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="flex items-center space-x-1">
                      <Star className="w-3 h-3 text-yellow-500" />
                      <span className="text-xs text-gray-400">{(result.similarity * 100).toFixed(0)}%</span>
                    </div>
                    <ExternalLink className="w-3 h-3 text-gray-500" />
                  </div>
                </div>

                <p className="text-sm text-gray-300 mb-3 line-clamp-2">
                  {result.content}
                </p>

                <div className="flex items-center justify-between text-xs text-gray-500">
                  <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-1">
                      <Clock className="w-3 h-3" />
                      <span>{formatTimestamp(result.timestamp)}</span>
                    </div>
                    <span>Source: {result.source}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Tag className="w-3 h-3" />
                    <div className="flex space-x-1">
                      {result.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="bg-gray-700 px-1 rounded text-xs">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : searchQuery.trim() ? (
          <div className="text-center py-8">
            <Search className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">
              {isSearching ? 'Searching...' : 'No results found for your query'}
            </p>
          </div>
        ) : (
          <div className="text-center py-8">
            <Search className="w-12 h-12 text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400">Enter a search query to find relevant content</p>
            <p className="text-sm text-gray-500 mt-2">
              Search across conversations, agents, memory, and documents
            </p>
          </div>
        )}
      </div>

      {/* Results Summary */}
      {filteredAndSortedResults.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-700">
          <p className="text-sm text-gray-400">
            Found {filteredAndSortedResults.length} result{filteredAndSortedResults.length !== 1 ? 's' : ''} 
            {selectedFilter !== 'all' && ` in ${selectedFilter}`}
            {searchQuery && ` for "${searchQuery}"`}
          </p>
        </div>
      )}
    </div>
  );
};

export default SemanticSearchPanel;
