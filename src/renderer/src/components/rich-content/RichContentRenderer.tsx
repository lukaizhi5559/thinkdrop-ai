import React, { useMemo } from 'react';
import { MDXProvider } from '@mdx-js/react';
import { motion } from 'framer-motion';

// Type-cast motion components to avoid TypeScript errors
const MotionA = motion.a as any;
const MotionH1 = motion.h1 as any;
const MotionH2 = motion.h2 as any;
const MotionH3 = motion.h3 as any;
const MotionP = motion.p as any;
const MotionUl = motion.ul as any;
const MotionOl = motion.ol as any;
const MotionBlockquote = motion.blockquote as any;
const MotionDiv = motion.div as any;
import VideoPlayer from './VideoPlayer';
import InteractiveChart from './InteractiveChart';
import SpreadsheetViewer from './SpreadsheetViewer';
import CanvasDrawing from './CanvasDrawing';
import CodeSandbox from './CodeSandbox';
import ImageGallery from './ImageGallery';
import MermaidDiagram from './MermaidDiagram';
import AnimatedCodeBlock from './AnimatedCodeBlock';
import LazyImage from './LazyImage';
import ResponsiveTable from './ResponsiveTable';

interface RichContentRendererProps {
  content: string;
  animated?: boolean;
  className?: string;
}

// Rich component mapping for MDX
const richComponents = {
  // Rich media components
  VideoPlayer,
  InteractiveChart,
  SpreadsheetViewer,
  CanvasDrawing,
  CodeSandbox,
  ImageGallery,
  MermaidDiagram,
  
  // Enhanced basic components
  code: AnimatedCodeBlock,
  img: LazyImage,
  table: ResponsiveTable,
  
  // Enhanced links with animations and external link handling
  a: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: React.ReactNode }) => (
    <MotionA
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      href={href}
      onClick={(e: React.MouseEvent) => {
        e.preventDefault();
        if (href && window.electronAPI?.openExternal) {
          window.electronAPI.openExternal(href);
        }
      }}
      className="text-blue-400 hover:text-blue-300 underline cursor-pointer transition-colors"
      {...props}
    >
      {children}
    </MotionA>
  ),
  
  // Enhanced typography with animations
  h1: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement> & { children: React.ReactNode }) => (
    <MotionH1
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="text-2xl font-bold mb-4 text-white"
      {...props}
    >
      {children}
    </MotionH1>
  ),
  
  h2: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement> & { children: React.ReactNode }) => (
    <MotionH2
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1 }}
      className="text-xl font-semibold mb-3 text-white/90"
      {...props}
    >
      {children}
    </MotionH2>
  ),
  
  h3: ({ children, ...props }: React.HTMLAttributes<HTMLHeadingElement> & { children: React.ReactNode }) => (
    <MotionH3
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.2 }}
      className="text-lg font-medium mb-2 text-white/80"
      {...props}
    >
      {children}
    </MotionH3>
  ),
  
  p: ({ children, ...props }: React.HTMLAttributes<HTMLParagraphElement> & { children: React.ReactNode }) => (
    <MotionP
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      className="mb-3 leading-relaxed text-white/70"
      {...props}
    >
      {children}
    </MotionP>
  ),
  
  ul: ({ children, ...props }: React.HTMLAttributes<HTMLUListElement> & { children: React.ReactNode }) => (
    <MotionUl
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
      className="list-disc list-inside mb-3 space-y-1 text-white/70"
      {...props}
    >
      {children}
    </MotionUl>
  ),
  
  ol: ({ children, ...props }: React.HTMLAttributes<HTMLOListElement> & { children: React.ReactNode }) => (
    <MotionOl
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
      className="list-decimal list-inside mb-3 space-y-1 text-white/70"
      {...props}
    >
      {children}
    </MotionOl>
  ),
  
  blockquote: ({ children, ...props }: React.HTMLAttributes<HTMLQuoteElement> & { children: React.ReactNode }) => (
    <MotionBlockquote
      initial={{ opacity: 0, x: -30 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="border-l-4 border-blue-400 pl-4 italic mb-3 text-white/60 bg-blue-500/10 py-2 rounded-r-lg"
      {...props}
    >
      {children}
    </MotionBlockquote>
  ),
};

const RichContentRenderer: React.FC<RichContentRendererProps> = ({
  content,
  animated = true,
  className = ''
}) => {
  const processedContent = useMemo(() => {
    try {
      // Handle both MDX and regular markdown content
      if (content.includes('<') && (content.includes('VideoPlayer') || content.includes('InteractiveChart') || content.includes('SpreadsheetViewer'))) {
        // This looks like MDX content with components
        return { type: 'mdx', content };
      } else {
        // Regular markdown - convert to MDX-compatible format
        return { type: 'markdown', content };
      }
    } catch (error) {
      console.error('Error processing content:', error);
      return { type: 'markdown', content };
    }
  }, [content]);

  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.1
      }
    }
  };

  if (processedContent.type === 'mdx') {
    return (
      <MotionDiv
        variants={animated ? containerVariants : undefined}
        initial={animated ? "hidden" : undefined}
        animate={animated ? "visible" : undefined}
        className={`rich-content-container ${className}`}
      >
        <MDXProvider components={richComponents}>
          <div className="prose prose-invert prose-sm max-w-none">
            {/* MDX content will be rendered here */}
            <div className="text-white/70">
              {/* Note: dangerouslySetInnerHTML removed for security. */}
              {/* In a real implementation, use a proper MDX compiler */}
              <pre className="whitespace-pre-wrap">{processedContent.content}</pre>
            </div>
          </div>
        </MDXProvider>
      </MotionDiv>
    );
  }

  // Enhanced content processing with URL detection
  const processLine = (line: string, index: number) => {
    if (line.trim() === '') return <br key={index} />;
    
    // URL detection regex
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    
    // Check for markdown headers
    if (line.startsWith('# ')) {
      const H1 = richComponents.h1;
      return <H1 key={index}>{line.slice(2)}</H1>;
    }
    if (line.startsWith('## ')) {
      const H2 = richComponents.h2;
      return <H2 key={index}>{line.slice(3)}</H2>;
    }
    if (line.startsWith('### ')) {
      const H3 = richComponents.h3;
      return <H3 key={index}>{line.slice(4)}</H3>;
    }
    
    // Process line with URL detection
    const parts = line.split(urlRegex);
    const processedParts = parts.map((part, partIndex) => {
      if (urlRegex.test(part)) {
        const Link = richComponents.a;
        return <Link key={partIndex} href={part}>{part}</Link>;
      }
      return part;
    });
    
    const P = richComponents.p;
    return <P key={index}>{processedParts}</P>;
  };

  // Fallback to enhanced markdown rendering
  return (
    <MotionDiv
      variants={animated ? containerVariants : undefined}
      initial={animated ? "hidden" : undefined}
      animate={animated ? "visible" : undefined}
      className={`rich-content-container ${className}`}
    >
      <MDXProvider components={richComponents}>
        <div className="prose prose-invert prose-sm max-w-none">
          {processedContent.content.split('\n').map(processLine)}
        </div>
      </MDXProvider>
    </MotionDiv>
  );
};

export default RichContentRenderer;
