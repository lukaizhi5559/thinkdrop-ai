import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Play, Copy, Download, Maximize2 } from 'lucide-react';
import { Highlight, themes } from 'prism-react-renderer';

interface CodeSandboxProps {
  code: string;
  language?: string;
  runnable?: boolean;
  editable?: boolean;
  title?: string;
  className?: string;
}

const CodeSandbox: React.FC<CodeSandboxProps> = ({
  code: initialCode,
  language = 'javascript',
  runnable = false,
  editable = false,
  title,
  className = ''
}) => {
  const [code, setCode] = useState(initialCode);
  const [output, setOutput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const runCode = async () => {
    if (!runnable) return;
    
    setIsRunning(true);
    try {
      // Simple JavaScript execution (in real app, use sandboxed environment)
      if (language === 'javascript') {
        // Note: eval is dangerous and should be replaced with a proper sandbox
        // For now, we'll show a warning instead of executing arbitrary code
        setOutput('Code execution is disabled for security reasons. In a production environment, use a proper sandboxed execution environment.');
      } else {
        setOutput('Code execution not supported for this language');
      }
    } catch (error) {
      setOutput(`Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsRunning(false);
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch (error) {
      console.error('Failed to copy code:', error);
    }
  };

  const downloadCode = () => {
    const blob = new Blob([code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `code.${language}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const MotionDiv = motion.div as any;
  const MotionButton = motion.button as any;
  
  return (
    <MotionDiv
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className={`code-sandbox bg-gray-900/50 rounded-lg border border-gray-700 overflow-hidden ${className}`}
      style={{ height: isFullscreen ? '100vh' : 'auto' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center space-x-3">
          <div className="flex space-x-1">
            <div className="w-3 h-3 bg-red-500 rounded-full"></div>
            <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
            <div className="w-3 h-3 bg-green-500 rounded-full"></div>
          </div>
          <span className="text-sm text-gray-300">
            {title || `${language} sandbox`}
          </span>
        </div>
        
        <div className="flex items-center space-x-2">
          {runnable && (
            <MotionButton
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={runCode}
              disabled={isRunning}
              className="px-3 py-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded text-sm flex items-center space-x-1"
            >
              <Play className="w-3 h-3" />
              <span>{isRunning ? 'Running...' : 'Run'}</span>
            </MotionButton>
          )}
          
          <button
            onClick={copyCode}
            className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
            title="Copy code"
          >
            <Copy className="w-4 h-4" />
          </button>
          
          <button
            onClick={downloadCode}
            className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
            title="Download code"
          >
            <Download className="w-4 h-4" />
          </button>
          
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
            title="Toggle fullscreen"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Code Editor */}
      <div className="relative">
        {editable ? (
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full h-64 p-4 bg-gray-900 text-white font-mono text-sm resize-none focus:outline-none"
            spellCheck={false}
          />
        ) : (
          <Highlight theme={themes.oneDark} code={code} language={language as any}>
            {({ className: highlightClassName, style, tokens, getLineProps, getTokenProps }) => (
              <pre className={`${highlightClassName} p-4 overflow-auto max-h-64`} style={style}>
                {tokens.map((line, i) => (
                  <div key={i} {...getLineProps({ line, key: i })}>
                    <span className="text-gray-500 mr-4 select-none">{i + 1}</span>
                    {line.map((token, key) => (
                      <span key={key} {...getTokenProps({ token, key })} />
                    ))}
                  </div>
                ))}
              </pre>
            )}
          </Highlight>
        )}
      </div>

      {/* Output */}
      {runnable && (
        <div className="border-t border-gray-700">
          <div className="p-3 bg-gray-800/50">
            <h4 className="text-sm font-medium text-gray-300 mb-2">Output:</h4>
            <div className="bg-black/30 rounded p-3 font-mono text-sm text-green-400 min-h-[60px]">
              {output || 'No output yet. Click "Run" to execute the code.'}
            </div>
          </div>
        </div>
      )}
    </MotionDiv>
  );
};

export default CodeSandbox;
