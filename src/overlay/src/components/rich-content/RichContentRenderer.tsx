import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { motion } from 'framer-motion';

const MotionDiv = motion.div as any;

// Code block wrapper with copy button
const CodeBlockWithCopy: React.FC<{ code: string; language: string }> = ({ code, language }) => {
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy code:', error);
    }
  };

  return (
    <div className="relative group">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
        style={{
          backgroundColor: isCopied ? 'rgba(34, 197, 94, 0.2)' : 'rgba(255, 255, 255, 0.1)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          color: isCopied ? '#22c55e' : '#9ca3af',
          cursor: 'pointer',
        }}
        title={isCopied ? 'Copied!' : 'Copy code'}
      >
        {isCopied ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
        )}
      </button>
      <SyntaxHighlighter
        style={vscDarkPlus}
        language={language}
        PreTag="div"
        className="rounded-lg my-4"
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
};

interface RichContentRendererProps {
  content: string;
  animated?: boolean;
  className?: string;
}

const RichContentRenderer: React.FC<RichContentRendererProps> = ({
  content,
  animated = true,
  className = ''
}) => {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        duration: 0.3
      }
    }
  };

  return (
    <MotionDiv
      variants={animated ? containerVariants : undefined}
      initial={animated ? "hidden" : undefined}
      animate={animated ? "visible" : undefined}
      className={`rich-content-container prose prose-invert prose-sm max-w-none ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          // Code blocks with syntax highlighting
          code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            const codeString = String(children).replace(/\n$/, '');
            
            return !inline && match ? (
              <CodeBlockWithCopy code={codeString} language={match[1]} />
            ) : (
              <code className="bg-gray-800 px-2 py-1 rounded text-sm font-mono text-blue-300" {...props}>
                {children}
              </code>
            );
          },
          // Links that open externally
          a({ node, children, href, ...props }: any) {
            return (
              <a
                href={href}
                onClick={(e) => {
                  e.preventDefault();
                  if (href && window.electronAPI?.openExternal) {
                    window.electronAPI.openExternal(href);
                  }
                }}
                className="text-blue-400 hover:text-blue-300 underline cursor-pointer transition-colors"
                {...props}
              >
                {children}
              </a>
            );
          },
          // Styled headings
          h1({ node, children, ...props }: any) {
            return <h1 className="text-2xl font-bold mb-4 mt-6 text-white" {...props}>{children}</h1>;
          },
          h2({ node, children, ...props }: any) {
            return <h2 className="text-xl font-semibold mb-3 mt-5 text-white/90" {...props}>{children}</h2>;
          },
          h3({ node, children, ...props }: any) {
            return <h3 className="text-lg font-medium mb-2 mt-4 text-white/80" {...props}>{children}</h3>;
          },
          // Styled paragraphs
          p({ node, children, ...props }: any) {
            return <p className="mb-3 leading-relaxed text-white/70" {...props}>{children}</p>;
          },
          // Styled lists
          ul({ node, children, ...props }: any) {
            return <ul className="list-disc list-inside mb-3 space-y-1 text-white/70 ml-4" {...props}>{children}</ul>;
          },
          ol({ node, children, ...props }: any) {
            return <ol className="list-decimal list-inside mb-3 space-y-1 text-white/70 ml-4" {...props}>{children}</ol>;
          },
          li({ node, children, ...props }: any) {
            return <li className="text-white/70" {...props}>{children}</li>;
          },
          // Styled blockquotes
          blockquote({ node, children, ...props }: any) {
            return (
              <blockquote className="border-l-4 border-blue-400 pl-4 italic mb-3 text-white/60 bg-blue-500/10 py-2 rounded-r-lg" {...props}>
                {children}
              </blockquote>
            );
          },
          // Styled tables
          table({ node, children, ...props }: any) {
            return <table className="min-w-full border border-gray-700 mb-4" {...props}>{children}</table>;
          },
          thead({ node, children, ...props }: any) {
            return <thead className="bg-gray-800" {...props}>{children}</thead>;
          },
          th({ node, children, ...props }: any) {
            return <th className="border border-gray-700 px-4 py-2 text-left text-white/90" {...props}>{children}</th>;
          },
          td({ node, children, ...props }: any) {
            return <td className="border border-gray-700 px-4 py-2 text-white/70" {...props}>{children}</td>;
          },
          // Horizontal rule
          hr({ node, ...props }: any) {
            return <hr className="border-gray-700 my-4" {...props} />;
          },
          // Strong/bold text
          strong({ node, children, ...props }: any) {
            return <strong className="font-bold text-white" {...props}>{children}</strong>;
          },
          // Emphasis/italic text
          em({ node, children, ...props }: any) {
            return <em className="italic text-white/80" {...props}>{children}</em>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </MotionDiv>
  );
};

export default RichContentRenderer;
