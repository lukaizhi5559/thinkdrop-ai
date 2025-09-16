import React, { useState, useCallback, useEffect } from 'react';
import { Copy, Check, ChevronDown, ChevronUp, Sparkles } from 'lucide-react';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

// Animated emoji component
const AnimatedEmoji: React.FC<{ emoji: string; className?: string }> = ({ emoji, className = '' }) => {
  return (
    <span 
      className={`inline-block hover:scale-110 hover:animate-bounce transition-transform duration-200 cursor-pointer ${className}`}
      title="Interactive emoji"
    >
      {emoji}
    </span>
  );
};

// Copy button component with enhanced animations
const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy text:', error);
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`p-1.5 text-gray-400 hover:text-gray-300 hover:bg-gray-700/50 rounded transition-all duration-200 ${
        copied ? 'animate-pulse' : ''
      } ${isHovered ? 'scale-110' : ''}`}
      title="Copy code"
    >
      {copied ? (
        <div className="flex items-center gap-1">
          <Check size={14} className="text-green-400 animate-bounce" />
          <Sparkles size={12} className="text-yellow-400 animate-pulse" />
        </div>
      ) : (
        <Copy size={14} className={isHovered ? 'animate-pulse' : ''} />
      )}
    </button>
  );
};

// Simple syntax highlighter component
const SyntaxHighlighter: React.FC<{ code: string; language: string }> = ({ code, language }) => {
  const highlightCode = (code: string, lang: string): React.ReactNode => {
    const lines = code.split('\n');
    
    return lines.map((line, lineIndex) => {
      if (!line.trim()) {
        return <div key={lineIndex}><br /></div>;
      }
      
      const tokens = tokenizeLine(line, lang);
      return (
        <div key={lineIndex}>
          {tokens.map((token, tokenIndex) => (
            <span key={tokenIndex} className={getTokenClass(token.type)}>
              {token.value}
            </span>
          ))}
        </div>
      );
    });
  };

  const tokenizeLine = (line: string, lang: string) => {
    const tokens: Array<{ type: string; value: string }> = [];
    let remaining = line;

    while (remaining.length > 0) {
      let matched = false;

      // Comments
      if (remaining.match(/^(\/\/|#|<!--)/)) {
        const commentMatch = remaining.match(/^(\/\/.*|#.*|<!--.*?-->)/);
        if (commentMatch) {
          tokens.push({ type: 'comment', value: commentMatch[0] });
          remaining = remaining.substring(commentMatch[0].length);
          matched = true;
        }
      }

      // HTML Tags
      if (!matched && remaining.match(/^<\/?[a-zA-Z][^>]*>/)) {
        const tagMatch = remaining.match(/^<\/?[a-zA-Z][^>]*>/);
        if (tagMatch) {
          tokens.push({ type: 'htmlTag', value: tagMatch[0] });
          remaining = remaining.substring(tagMatch[0].length);
          matched = true;
        }
      }

      // Strings
      if (!matched && remaining.match(/^["'`]/)) {
        const quote = remaining[0];
        let stringMatch = '';
        let i = 1;
        while (i < remaining.length) {
          if (remaining[i] === quote && remaining[i - 1] !== '\\') {
            stringMatch = remaining.substring(0, i + 1);
            break;
          }
          i++;
        }
        if (stringMatch) {
          tokens.push({ type: 'string', value: stringMatch });
          remaining = remaining.substring(stringMatch.length);
          matched = true;
        }
      }

      // Keywords
      if (!matched) {
        const keywordPatterns = {
          javascript: /^(function|const|let|var|if|else|for|while|return|class|import|export|from|async|await|try|catch|finally|throw|new|this|super|extends|static|public|private|protected|interface|type|enum|namespace|module|declare|abstract|readonly|keyof|typeof|instanceof|in|of|as|is|satisfies)\b/,
          typescript: /^(function|const|let|var|if|else|for|while|return|class|import|export|from|async|await|try|catch|finally|throw|new|this|super|extends|static|public|private|protected|interface|type|enum|namespace|module|declare|abstract|readonly|keyof|typeof|instanceof|in|of|as|is|satisfies)\b/,
          python: /^(def|class|if|elif|else|for|while|return|import|from|as|try|except|finally|raise|with|lambda|global|nonlocal|assert|break|continue|pass|yield|async|await|and|or|not|in|is|None|True|False)\b/,
          java: /^(public|private|protected|static|final|abstract|class|interface|extends|implements|import|package|if|else|for|while|do|switch|case|default|break|continue|return|try|catch|finally|throw|throws|new|this|super|void|int|double|float|long|short|byte|char|boolean|String)\b/,
          cpp: /^(int|double|float|char|bool|void|class|struct|public|private|protected|static|const|if|else|for|while|do|switch|case|default|break|continue|return|try|catch|throw|new|delete|this|virtual|override|template|typename|namespace|using|include|define|ifdef|ifndef|endif)\b/,
          c: /^(int|double|float|char|void|struct|union|enum|typedef|static|const|extern|register|auto|volatile|signed|unsigned|if|else|for|while|do|switch|case|default|break|continue|return|goto|sizeof|include|define|ifdef|ifndef|endif)\b/,
          html: /^(html|head|body|div|span|p|a|img|ul|ol|li|h1|h2|h3|h4|h5|h6|table|tr|td|th|form|input|button|script|style|link|meta|title|header|footer|nav|section|article|aside|main)\b/,
          css: /^(color|background|margin|padding|border|width|height|font|display|position|top|left|right|bottom|z-index|opacity|transform|transition|animation|flex|grid|justify|align|text|line|letter|word|white|overflow|visibility|cursor|pointer|hover|active|focus|before|after|first|last|nth|child|type|class|id|important|inherit|initial|unset|auto|none|block|inline|absolute|relative|fixed|sticky)\b/,
          json: /^(true|false|null)\b/,
          sql: /^(SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TABLE|INDEX|DATABASE|SCHEMA|PRIMARY|KEY|FOREIGN|REFERENCES|NOT|NULL|DEFAULT|AUTO_INCREMENT|UNIQUE|CHECK|CONSTRAINT|INNER|LEFT|RIGHT|FULL|OUTER|JOIN|ON|GROUP|BY|HAVING|ORDER|ASC|DESC|LIMIT|OFFSET|UNION|ALL|DISTINCT|AS|CASE|WHEN|THEN|ELSE|END|IF|EXISTS|IN|BETWEEN|LIKE|AND|OR)\b/i
        };

        const pattern = keywordPatterns[lang as keyof typeof keywordPatterns] || keywordPatterns.javascript;
        const keywordMatch = remaining.match(pattern);
        if (keywordMatch) {
          tokens.push({ type: 'keyword', value: keywordMatch[0] });
          remaining = remaining.substring(keywordMatch[0].length);
          matched = true;
        }
      }

      // Numbers
      if (!matched) {
        const numberMatch = remaining.match(/^(\d+\.?\d*|\.\d+)/);
        if (numberMatch) {
          tokens.push({ type: 'number', value: numberMatch[0] });
          remaining = remaining.substring(numberMatch[0].length);
          matched = true;
        }
      }

      // Operators and punctuation
      if (!matched) {
        const operatorMatch = remaining.match(/^([+\-*/%=<>!&|^~?:;,.()\[\]{}])/);
        if (operatorMatch) {
          tokens.push({ type: 'operator', value: operatorMatch[0] });
          remaining = remaining.substring(operatorMatch[0].length);
          matched = true;
        }
      }

      // Default: regular text
      if (!matched) {
        const textMatch = remaining.match(/^(\w+|\s+|.)/);
        if (textMatch) {
          tokens.push({ type: 'text', value: textMatch[0] });
          remaining = remaining.substring(textMatch[0].length);
        } else {
          // Fallback: take one character
          tokens.push({ type: 'text', value: remaining[0] });
          remaining = remaining.substring(1);
        }
      }
    }

    return tokens;
  };

  const getTokenClass = (type: string): string => {
    switch (type) {
      case 'keyword':
        return 'text-blue-400'; // Keywords in blue (VSCode style)
      case 'string':
        return 'text-orange-300'; // Strings in orange (VSCode style)
      case 'comment':
        return 'text-gray-500'; // Comments in gray
      case 'number':
        return 'text-green-300'; // Numbers in light green (VSCode style)
      case 'operator':
        return 'text-gray-300'; // Operators in light gray (VSCode style)
      case 'htmlTag':
        return 'text-sky-400'; // HTML tags in light blue (VSCode style)
      default:
        return 'text-gray-200'; // Default text in light gray
    }
  };

  return <>{highlightCode(code, language)}</>;
};

// Enhanced code block component with copy and expand/collapse functionality
const CodeBlock: React.FC<{
  language: string;
  code: string;
  shouldCollapse: boolean;
}> = ({ language, code, shouldCollapse }) => {
  const [isExpanded, setIsExpanded] = useState(!shouldCollapse);
  const [isAnimating, setIsAnimating] = useState(false);
  const lines = code.split('\n');

  const handleToggleExpand = () => {
    setIsAnimating(true);
    setIsExpanded(!isExpanded);
    setTimeout(() => setIsAnimating(false), 300);
  };

  return (
    <div className="my-4 rounded-lg overflow-hidden bg-gray-900 border border-gray-700">
      {/* Header with language and controls */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
            {language || 'text'}
          </span>
          {shouldCollapse && (
            <span className="text-xs text-gray-500">
              {lines.length} lines
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {shouldCollapse && (
            <button
              onClick={handleToggleExpand}
              className={`p-1.5 text-gray-400 hover:text-gray-300 hover:bg-gray-700/50 rounded transition-all duration-200 hover:scale-110 ${
                isAnimating ? 'animate-pulse' : ''
              }`}
              title={isExpanded ? "Collapse" : "Expand"}
            >
              {isExpanded ? (
                <ChevronUp size={14} className="animate-bounce" />
              ) : (
                <ChevronDown size={14} className="animate-bounce" />
              )}
            </button>
          )}
          <CopyButton text={code} />
        </div>
      </div>
      
      {/* Code content */}
      <div className="relative">
        <div 
          className="overflow-auto"
          style={{ 
            maxHeight: shouldCollapse && !isExpanded ? '240px' : 'none',
            overflowY: shouldCollapse && !isExpanded ? 'hidden' : 'auto',
            overflowX: 'auto'
          }}
        >
          <pre className="p-4 text-sm leading-relaxed whitespace-pre">
            <code className="font-mono block">
              <SyntaxHighlighter code={code} language={language} />
            </code>
          </pre>
        </div>
        
        {/* Expand button overlay for collapsed state */}
        {shouldCollapse && !isExpanded && (
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-gray-900 to-transparent h-16 flex items-end justify-center pb-2">
            <button
              onClick={handleToggleExpand}
              className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs rounded border border-gray-600 transition-all duration-200 hover:scale-105 hover:shadow-lg flex items-center gap-1"
            >
              <span>Show more</span>
              <AnimatedEmoji emoji="✨" className="text-xs" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// Enhanced text processing with contextual emojis
const enhanceTextWithEmojis = (text: string): React.ReactNode => {
  const emojiMap: Record<string, string> = {
    'success': '✅',
    'error': '❌', 
    'warning': '⚠️',
    'info': 'ℹ️',
    'tip': '💡',
    'note': '📝',
    'important': '⭐',
    'example': '📋',
    'code': '💻',
    'function': '⚙️',
    'api': '🔌',
    'database': '🗄️',
    'security': '🔒',
    'performance': '⚡',
    'bug': '🐛',
    'feature': '✨',
    'update': '🔄',
    'new': '🆕',
    'deprecated': '⚠️',
    'beta': '🧪',
    'react': '⚛️',
    'javascript': '🟨',
    'typescript': '🔷',
    'python': '🐍',
    'node': '🟢',
    'npm': '📦',
    'git': '🌿',
    'docker': '🐳',
    'aws': '☁️',
    'firebase': '🔥',
    'mongodb': '🍃',
    'mysql': '🐬',
    'redis': '🔴',
    'graphql': '💜',
    'rest': '🌐',
    'webhook': '🪝',
    'auth': '🔐',
    'jwt': '🎫',
    'oauth': '🔑',
    'ssl': '🔒',
    'https': '🔐',
    'deploy': '🚀',
    'build': '🔨',
    'test': '🧪',
    'debug': '🐞',
    'optimize': '⚡',
    'cache': '💾',
    'cdn': '🌍',
    'mobile': '📱',
    'responsive': '📐',
    'ui': '🎨',
    'ux': '👤',
    'design': '🎨',
    'component': '🧩',
    'hook': '🪝',
    'state': '📊',
    'props': '📤',
    'event': '⚡',
    'async': '⏳',
    'promise': '🤝',
    'callback': '↩️',
    'loop': '🔄',
    'array': '📋',
    'object': '📦',
    'string': '📝',
    'number': '🔢',
    'boolean': '✅',
    'null': '🚫',
    'undefined': '❓'
  };

  let enhancedText = text;
  
  // Add contextual emojis for certain keywords (limit to avoid emoji overload)
  let emojiCount = 0;
  const maxEmojis = 3; // Limit emojis per paragraph for better readability
  
  Object.entries(emojiMap).forEach(([keyword, emoji]) => {
    if (emojiCount >= maxEmojis) return;
    
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    if (regex.test(enhancedText)) {
      enhancedText = enhancedText.replace(regex, (match) => {
        emojiCount++;
        return `${match} ${emoji}`;
      });
    }
  });

  return enhancedText;
};

export default function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Animate content appearance
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, [content]);

  // Simple markdown parsing for common elements
  const parseMarkdown = (text: string): React.ReactNode => {
    // Split by lines to handle different elements
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    let currentIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Headers
      if (line.startsWith('### ')) {
        elements.push(
          <h3 key={currentIndex++} className="text-lg font-semibold mb-2 text-white">
            {line.substring(4)}
          </h3>
        );
      } else if (line.startsWith('## ')) {
        elements.push(
          <h2 key={currentIndex++} className="text-xl font-semibold mb-2 text-white">
            {line.substring(3)}
          </h2>
        );
      } else if (line.startsWith('# ')) {
        elements.push(
          <h1 key={currentIndex++} className="text-2xl font-bold mb-3 text-white">
            {line.substring(2)}
          </h1>
        );
      }
      // Code blocks
      else if (line.startsWith('```')) {
        const language = line.substring(3).trim();
        const codeLines: string[] = [];
        i++; // Skip the opening ```
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        const codeContent = codeLines.join('\n');
        const shouldCollapse = codeLines.length > 10 || codeContent.length > 500;
        
        elements.push(
          <CodeBlock 
            key={currentIndex++}
            language={language}
            code={codeContent}
            shouldCollapse={shouldCollapse}
          />
        );
      }
      // Lists
      else if (line.startsWith('- ') || line.startsWith('* ')) {
        const listItems: string[] = [line.substring(2)];
        i++;
        while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
          listItems.push(lines[i].substring(2));
          i++;
        }
        i--; // Back up one since the loop will increment
        elements.push(
          <ul key={currentIndex++} className="list-disc list-inside my-2 space-y-1">
            {listItems.map((item, idx) => (
              <li key={idx} className="text-white/90">
                {parseInlineMarkdown(item)}
              </li>
            ))}
          </ul>
        );
      }
      // Numbered lists
      else if (/^\d+\.\s/.test(line)) {
        const listItems: string[] = [line.replace(/^\d+\.\s/, '')];
        i++;
        while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
          listItems.push(lines[i].replace(/^\d+\.\s/, ''));
          i++;
        }
        i--; // Back up one since the loop will increment
        elements.push(
          <ol key={currentIndex++} className="list-decimal list-inside my-2 space-y-1">
            {listItems.map((item, idx) => (
              <li key={idx} className="text-white/90">
                {parseInlineMarkdown(item)}
              </li>
            ))}
          </ol>
        );
      }
      // Empty lines
      else if (line.trim() === '') {
        elements.push(<div key={currentIndex++} className="h-1" />);
      }
      // Regular paragraphs
      else {
        const enhancedLine = enhanceTextWithEmojis(line);
        elements.push(
          <p key={currentIndex++} className="text-white/90 mb-1 leading-relaxed">
            {parseInlineMarkdown(enhancedLine as string)}
          </p>
        );
      }
    }

    return elements;
  };

  // Parse inline markdown (bold, italic, code, links)
  const parseInlineMarkdown = (text: string): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    let currentIndex = 0;
    let remaining = text;

    while (remaining.length > 0) {
      // Bold text **text**
      const boldMatch = remaining.match(/\*\*(.*?)\*\*/);
      if (boldMatch && boldMatch.index !== undefined) {
        // Add text before bold
        if (boldMatch.index > 0) {
          parts.push(remaining.substring(0, boldMatch.index));
        }
        // Add bold text
        parts.push(
          <strong key={currentIndex++} className="font-semibold text-white">
            {boldMatch[1]}
          </strong>
        );
        remaining = remaining.substring(boldMatch.index + boldMatch[0].length);
        continue;
      }

      // Italic text *text*
      const italicMatch = remaining.match(/\*(.*?)\*/);
      if (italicMatch && italicMatch.index !== undefined) {
        // Add text before italic
        if (italicMatch.index > 0) {
          parts.push(remaining.substring(0, italicMatch.index));
        }
        // Add italic text
        parts.push(
          <em key={currentIndex++} className="italic text-white/90">
            {italicMatch[1]}
          </em>
        );
        remaining = remaining.substring(italicMatch.index + italicMatch[0].length);
        continue;
      }

      // Inline code `code`
      const codeMatch = remaining.match(/`(.*?)`/);
      if (codeMatch && codeMatch.index !== undefined) {
        // Add text before code
        if (codeMatch.index > 0) {
          parts.push(remaining.substring(0, codeMatch.index));
        }
        // Add code text
        parts.push(
          <code key={currentIndex++} className="bg-gray-700 text-cyan-300 px-1 py-0.5 rounded text-sm font-mono">
            {codeMatch[1]}
          </code>
        );
        remaining = remaining.substring(codeMatch.index + codeMatch[0].length);
        continue;
      }

      // Links [text](url)
      const linkMatch = remaining.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch && linkMatch.index !== undefined) {
        // Add text before link
        if (linkMatch.index > 0) {
          parts.push(remaining.substring(0, linkMatch.index));
        }
        // Add link
        parts.push(
          <a 
            key={currentIndex++} 
            href={linkMatch[2]} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 underline"
          >
            {linkMatch[1]}
          </a>
        );
        remaining = remaining.substring(linkMatch.index + linkMatch[0].length);
        continue;
      }

      // No more markdown found, add remaining text
      parts.push(remaining);
      break;
    }

    return parts;
  };

  return (
    <div className={`markdown-content ${className} transition-all duration-500 ${
      isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
    }`}>
      {parseMarkdown(content)}
    </div>
  );
}
