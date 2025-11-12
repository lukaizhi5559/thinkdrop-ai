import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Download, Filter, Search, SortAsc, SortDesc, Maximize2 } from 'lucide-react';

interface SpreadsheetData {
  [key: string]: string | number | boolean | null | undefined;
}

interface SpreadsheetViewerProps {
  data: SpreadsheetData[];
  columns?: string[];
  title?: string;
  sortable?: boolean;
  filterable?: boolean;
  searchable?: boolean;
  exportable?: boolean;
  editable?: boolean;
  maxHeight?: string | number;
  className?: string;
}

const SpreadsheetViewer: React.FC<SpreadsheetViewerProps> = ({
  data,
  columns,
  title,
  sortable = true,
  filterable = true,
  searchable = true,
  exportable = true,
  editable = false,
  maxHeight = 400,
  className = ''
}) => {
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterColumn, setFilterColumn] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Extract columns from data if not provided
  const tableColumns = useMemo(() => {
    if (columns) return columns;
    if (data.length === 0) return [];
    return Object.keys(data[0]);
  }, [data, columns]);

  // Filter and sort data
  const processedData = useMemo(() => {
    let filtered = data;

    // Apply search filter
    if (searchTerm) {
      filtered = filtered.filter(row =>
        Object.values(row).some(value =>
          String(value).toLowerCase().includes(searchTerm.toLowerCase())
        )
      );
    }

    // Apply column filter
    if (filterColumn) {
      filtered = filtered.filter(row => row[filterColumn]);
    }

    // Apply sorting
    if (sortConfig) {
      filtered = [...filtered].sort((a, b) => {
        const aVal = a[sortConfig.key];
        const bVal = b[sortConfig.key];
        
        // Handle null/undefined values - sort them to the end
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;
        
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return filtered;
  }, [data, searchTerm, filterColumn, sortConfig]);

  const handleSort = (column: string) => {
    if (!sortable) return;
    
    setSortConfig(current => {
      if (current?.key === column) {
        return current.direction === 'asc' 
          ? { key: column, direction: 'desc' }
          : null;
      }
      return { key: column, direction: 'asc' };
    });
  };

  const handleExport = () => {
    const headers = tableColumns.join(',');
    const rows = processedData.map(row => 
      tableColumns.map(col => `"${String(row[col] || '')}"`).join(',')
    );
    const csvContent = [headers, ...rows].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spreadsheet-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const MotionDiv = motion.div as any;
  const MotionButton = motion.button as any;
  const MotionTr = motion.tr as any;

  return (
    <MotionDiv
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className={`spreadsheet-container bg-gray-900/50 rounded-lg border border-gray-700 ${className}`}
      style={{ height: isFullscreen ? '100vh' : 'auto' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div>
          {title && <h3 className="text-lg font-semibold text-white">{title}</h3>}
          <p className="text-sm text-gray-400">
            {processedData.length} rows • {tableColumns.length} columns
          </p>
        </div>
        
        <div className="flex items-center space-x-2">
          {exportable && (
            <MotionButton
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleExport}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              title="Export CSV"
            >
              <Download className="w-4 h-4" />
            </MotionButton>
          )}
          
          <MotionButton
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
            title="Toggle fullscreen"
          >
            <Maximize2 className="w-4 h-4" />
          </MotionButton>
        </div>
      </div>

      {/* Controls */}
      <div className="p-4 border-b border-gray-700 space-y-3">
        <div className="flex items-center space-x-3">
          {searchable && (
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search all columns..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
              />
            </div>
          )}
          
          {filterable && (
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <select
                value={filterColumn}
                onChange={(e) => setFilterColumn(e.target.value)}
                className="pl-10 pr-8 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
              >
                <option value="">All columns</option>
                {tableColumns.map(col => (
                  <option key={col} value={col}>{col}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div 
        className="overflow-auto"
        style={{ maxHeight: isFullscreen ? 'calc(100vh - 200px)' : maxHeight }}
      >
        <table className="w-full">
          <thead className="bg-gray-800 sticky top-0">
            <tr>
              {tableColumns.map(column => (
                <th
                  key={column}
                  onClick={() => handleSort(column)}
                  className={`px-4 py-3 text-left text-sm font-medium text-gray-300 border-b border-gray-600 ${
                    sortable ? 'cursor-pointer hover:bg-gray-700' : ''
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <span>{column}</span>
                    {sortable && sortConfig?.key === column && (
                      <MotionDiv
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ duration: 0.2 }}
                      >
                        {sortConfig.direction === 'asc' ? (
                          <SortAsc className="w-4 h-4" />
                        ) : (
                          <SortDesc className="w-4 h-4" />
                        )}
                      </MotionDiv>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {processedData.map((row, rowIndex) => (
              <MotionTr
                key={rowIndex}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: rowIndex * 0.05 }}
                className="hover:bg-gray-800/50 transition-colors"
              >
                {tableColumns.map(column => (
                  <td
                    key={column}
                    className="px-4 py-3 text-sm text-gray-300 border-b border-gray-700/50"
                  >
                    {editable ? (
                      <input
                        type="text"
                        value={String(row[column] || '')}
                        onChange={(e) => {
                          // Handle cell editing
                          const newData = [...data];
                          newData[rowIndex] = { ...newData[rowIndex], [column]: e.target.value };
                        }}
                        className="w-full bg-transparent border-none outline-none focus:bg-gray-800 rounded px-2 py-1"
                      />
                    ) : (
                      <span>{String(row[column] || '')}</span>
                    )}
                  </td>
                ))}
              </MotionTr>
            ))}
          </tbody>
        </table>
        
        {processedData.length === 0 && (
          <div className="text-center py-8 text-gray-400">
            No data matches your current filters
          </div>
        )}
      </div>
    </MotionDiv>
  );
};

export default SpreadsheetViewer;
