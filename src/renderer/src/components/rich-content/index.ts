/**
 * Rich Content Components Library
 * Modern MDX-based content renderer with interactive components
 */

export { default as RichContentRenderer } from './RichContentRenderer';
export { default as VideoPlayer } from './VideoPlayer';
export { default as InteractiveChart } from './InteractiveChart';
export { default as SpreadsheetViewer } from './SpreadsheetViewer';
export { default as CanvasDrawing } from './CanvasDrawing';
export { default as CodeSandbox } from './CodeSandbox';
export { default as ImageGallery } from './ImageGallery';
export { default as MermaidDiagram } from './MermaidDiagram';
export { default as AnimatedCodeBlock } from './AnimatedCodeBlock';
export { default as LazyImage } from './LazyImage';
export { default as ResponsiveTable } from './ResponsiveTable';

// Rich component configurations
export const RICH_COMPONENTS = {
  VideoPlayer: 'VideoPlayer',
  InteractiveChart: 'InteractiveChart', 
  SpreadsheetViewer: 'SpreadsheetViewer',
  CanvasDrawing: 'CanvasDrawing',
  CodeSandbox: 'CodeSandbox',
  ImageGallery: 'ImageGallery',
  MermaidDiagram: 'MermaidDiagram'
} as const;

export type RichComponentType = keyof typeof RICH_COMPONENTS;
