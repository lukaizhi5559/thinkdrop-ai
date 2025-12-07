import React from 'react';
import { motion } from 'framer-motion';

interface AnimatedCodeBlockProps {
  children: React.ReactNode;
  className?: string;
}

const AnimatedCodeBlock: React.FC<AnimatedCodeBlockProps> = ({
  children,
  className = ''
}) => {
  const MotionCode = motion.code as any;
  
  return (
    <MotionCode
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className={`bg-gray-800 px-2 py-1 rounded text-sm font-mono text-blue-300 ${className}`}
    >
      {children}
    </MotionCode>
  );
};

export default AnimatedCodeBlock;
