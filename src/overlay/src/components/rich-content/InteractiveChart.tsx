import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Download, Maximize2, RotateCcw } from 'lucide-react';

interface ChartData {
  [key: string]: string | number;
}

interface InteractiveChartProps {
  data: ChartData[];
  type?: 'bar' | 'line' | 'pie' | 'area';
  title?: string;
  xKey?: string;
  yKey?: string;
  width?: string | number;
  height?: string | number;
  animated?: boolean;
  interactive?: boolean;
  exportable?: boolean;
  className?: string;
}

const COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#00ff00', '#ff00ff', '#00ffff'];

const InteractiveChart: React.FC<InteractiveChartProps> = ({
  data,
  type = 'bar',
  title,
  xKey = 'name',
  yKey = 'value',
  width = '100%',
  height = 300,
  animated = true,
  interactive = true,
  exportable = true,
  className = ''
}) => {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [selectedData, setSelectedData] = useState<ChartData | null>(null);

  const handleExport = () => {
    // Export chart as image or data
    const csvContent = data.map(row => Object.values(row).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chart-data-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const MotionDiv = motion.div as any;
  const MotionButton = motion.button as any;

  const renderChart = () => {
    const commonProps = {
      data
    };

    switch (type) {
      case 'line':
        return (
          <LineChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey={xKey} stroke="#9CA3AF" />
            <YAxis stroke="#9CA3AF" />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: '#1F2937', 
                border: '1px solid #374151',
                borderRadius: '8px',
                color: '#F9FAFB'
              }} 
            />
            <Legend />
            <Line 
              type="monotone" 
              dataKey={yKey} 
              stroke="#8884d8" 
              strokeWidth={2}
              dot={{ fill: '#8884d8', strokeWidth: 2, r: 4 }}
              activeDot={{ r: 6, stroke: '#8884d8', strokeWidth: 2 }}
              animationDuration={animated ? 1000 : 0}
            />
          </LineChart>
        );
      
      case 'pie':
        return (
          <PieChart {...commonProps}>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              outerRadius={80}
              fill="#8884d8"
              dataKey={yKey}
              animationDuration={animated ? 1000 : 0}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip 
              contentStyle={{ 
                backgroundColor: '#1F2937', 
                border: '1px solid #374151',
                borderRadius: '8px',
                color: '#F9FAFB'
              }} 
            />
          </PieChart>
        );
      
      default: // bar
        return (
          <BarChart {...commonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey={xKey} stroke="#9CA3AF" />
            <YAxis stroke="#9CA3AF" />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: '#1F2937', 
                border: '1px solid #374151',
                borderRadius: '8px',
                color: '#F9FAFB'
              }} 
            />
            <Legend />
            <Bar 
              dataKey={yKey} 
              fill="#8884d8"
              animationDuration={animated ? 1000 : 0}
              onClick={interactive ? setSelectedData : undefined}
              style={{ cursor: interactive ? 'pointer' : 'default' }}
            />
          </BarChart>
        );
    }
  };

  return (
    <MotionDiv
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className={`chart-container bg-gray-900/50 rounded-lg border border-gray-700 ${className}`}
      style={{ width, height: isFullscreen ? '100vh' : height }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div>
          {title && <h3 className="text-lg font-semibold text-white">{title}</h3>}
          <p className="text-sm text-gray-400 capitalize">{type} Chart • {data.length} data points</p>
        </div>
        
        <div className="flex items-center space-x-2">
          {exportable && (
            <MotionButton
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleExport}
              className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
              title="Export data"
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
          
          <MotionButton
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setSelectedData(null)}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
            title="Reset selection"
          >
            <RotateCcw className="w-4 h-4" />
          </MotionButton>
        </div>
      </div>
      
      {/* Chart */}
      <div className="p-4" style={{ height: `calc(100% - 80px)` }}>
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </div>
      
      {/* Selected Data Info */}
      {selectedData && (
        <MotionDiv
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 bg-blue-500/10 border-t border-blue-500/30"
        >
          <p className="text-sm text-blue-300">
            Selected: {selectedData[xKey]} = {selectedData[yKey]}
          </p>
        </MotionDiv>
      )}
    </MotionDiv>
  );
};

export default InteractiveChart;
