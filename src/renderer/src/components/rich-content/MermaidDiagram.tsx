import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

interface MermaidDiagramProps {
  chart: string;
  className?: string;
}

const MermaidDiagram: React.FC<MermaidDiagramProps> = ({
  chart,
  className = ''
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Simple placeholder - in real implementation, use mermaid library
    // Avoiding innerHTML for security reasons
  }, [chart]);

  const MotionDiv = motion.div as any;

  return (
    <MotionDiv
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className={`mermaid-container ${className}`}
      ref={containerRef}
    >
      <div className="bg-white p-4 rounded border text-black">
        <h3 className="text-lg font-semibold mb-2">Mermaid Diagram</h3>
        <pre className="text-sm bg-gray-100 p-2 rounded overflow-auto">{chart}</pre>
        <p className="text-xs text-gray-600 mt-2">Mermaid rendering would appear here</p>
      </div>
    </MotionDiv>
  );
};

export default MermaidDiagram;
