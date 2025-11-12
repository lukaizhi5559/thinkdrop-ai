import React from 'react';
import { motion } from 'framer-motion';

interface ResponsiveTableProps {
  children: React.ReactNode;
  className?: string;
}

const ResponsiveTable: React.FC<ResponsiveTableProps> = ({
  children,
  className = ''
}) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`overflow-x-auto ${className}`}
    >
      <table className="w-full border-collapse border border-gray-600 bg-gray-800/50 rounded-lg overflow-hidden">
        {children}
      </table>
    </motion.div>
  );
};

export default ResponsiveTable;
