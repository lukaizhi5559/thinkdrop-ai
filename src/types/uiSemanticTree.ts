/**
 * UI Semantic Tree Types
 * Based on ScreenAI research and semantic search architecture
 */

export type UIElementType =
  | 'button'
  | 'input'
  | 'text'
  | 'image'
  | 'pictogram'
  | 'dialog'
  | 'modal'
  | 'panel'
  | 'list'
  | 'list_item'
  | 'checkbox'
  | 'radio'
  | 'dropdown'
  | 'menu'
  | 'menu_item'
  | 'link'
  | 'icon'
  | 'tab'
  | 'window'
  | 'section'
  | 'container'
  | 'unknown';

export type BoundingBox = [number, number, number, number]; // [x1, y1, x2, y2]

export interface UISemanticNode {
  /** Unique identifier for this UI element */
  id: string;

  /** Type of UI element */
  type: UIElementType;

  /** Raw text content (from OCR or element text) */
  text: string;

  /** Semantic description used for embedding (human-readable) */
  description: string;

  /** Bounding box coordinates [x1, y1, x2, y2] */
  bbox: BoundingBox;

  /** Normalized bounding box (0-999 range like ScreenAI) */
  normalizedBbox: BoundingBox;

  /** Parent node ID (if any) */
  parentId?: string;

  /** Child node IDs */
  childrenIds: string[];

  /** Hierarchy path from root to this node */
  hierarchyPath: string[];

  /** Additional metadata */
  metadata: {
    /** Application name */
    app: string;

    /** Browser URL (if applicable) */
    url?: string;

    /** Window title */
    windowTitle?: string;

    /** Is this element visible? */
    visible: boolean;

    /** Is this element clickable? */
    clickable: boolean;

    /** Is this element interactive? */
    interactive: boolean;

    /** Icon type (if pictogram) */
    iconType?: string;

    /** Image caption (if image) */
    imageCaption?: string;

    /** OCR confidence score */
    ocrConfidence?: number;

    /** Detection confidence from object detector */
    detectionConfidence?: number;

    /** Screen region (top-left, center, bottom-right, etc.) */
    screenRegion?: string;

    /** Z-index or layer depth */
    zIndex?: number;

    /** Additional custom properties */
    [key: string]: any;
  };

  /** Embedding vector (if computed) */
  embedding?: number[];

  /** Timestamp when this node was captured */
  timestamp: number;
}

export interface UISubtree {
  /** Unique identifier for this subtree/region */
  id: string;

  /** Type of region */
  type: 'dialog' | 'modal' | 'sidebar' | 'panel' | 'section' | 'toolbar' | 'menu' | 'window';

  /** Title or label of this region */
  title: string;

  /** Semantic description of the entire subtree */
  description: string;

  /** Root node ID of this subtree */
  rootNodeId: string;

  /** All node IDs in this subtree */
  nodeIds: string[];

  /** Bounding box encompassing the entire subtree */
  bbox: BoundingBox;

  /** Embedding vector for the subtree description */
  embedding?: number[];

  /** Timestamp */
  timestamp: number;
}

export interface UIScreenState {
  /** Unique identifier for this screen state */
  id: string;

  /** Overall description of the screen */
  description: string;

  /** Application name */
  app: string;

  /** Browser URL (if applicable) */
  url?: string;

  /** Window title */
  windowTitle?: string;

  /** All nodes in this screen */
  nodes: Map<string, UISemanticNode>;

  /** All subtrees/regions in this screen */
  subtrees: UISubtree[];

  /** Root node IDs (top-level elements) */
  rootNodeIds: string[];

  /** Screen dimensions */
  screenDimensions: {
    width: number;
    height: number;
  };

  /** Embedding vector for the entire screen state */
  embedding?: number[];

  /** Timestamp when this screen was captured */
  timestamp: number;

  /** Screenshot path (if saved) */
  screenshotPath?: string;
}

export interface SemanticSearchQuery {
  /** Natural language query */
  query: string;

  /** Query embedding */
  embedding?: number[];

  /** Filters to apply */
  filters?: {
    /** Filter by element types */
    types?: UIElementType[];

    /** Filter by app name */
    app?: string;

    /** Filter by screen ID */
    screenId?: string;

    /** Filter by clickable elements only */
    clickableOnly?: boolean;

    /** Filter by visible elements only */
    visibleOnly?: boolean;

    /** Filter by text content (case-insensitive substring) */
    textContains?: string;

    /** Filter by bounding box region */
    bboxRegion?: {
      minX?: number;
      maxX?: number;
      minY?: number;
      maxY?: number;
    };

    /** Filter by time range */
    timeRange?: {
      start: number;
      end: number;
    };
  };

  /** Number of results to return */
  k?: number;

  /** Minimum similarity score threshold (0-1) */
  minScore?: number;
}

export interface SemanticSearchResult {
  /** Matched node or subtree ID */
  id: string;

  /** Type of result */
  resultType: 'node' | 'subtree' | 'screen';

  /** Similarity score (0-1) */
  score: number;

  /** The matched node (if resultType is 'node') */
  node?: UISemanticNode;

  /** The matched subtree (if resultType is 'subtree') */
  subtree?: UISubtree;

  /** The matched screen state (if resultType is 'screen') */
  screenState?: UIScreenState;

  /** Explanation of why this matched */
  explanation?: string;
}

export interface UITreeBuilder {
  /** Build a UI tree from OCR and object detection results */
  buildTree(
    ocrResults: any,
    detectionResults: any,
    windowInfo: any
  ): Promise<UIScreenState>;

  /** Generate semantic descriptions for nodes */
  generateNodeDescriptions(nodes: UISemanticNode[]): Promise<UISemanticNode[]>;

  /** Generate semantic descriptions for subtrees */
  generateSubtreeDescriptions(subtrees: UISubtree[]): Promise<UISubtree[]>;

  /** Generate semantic description for entire screen */
  generateScreenDescription(screenState: UIScreenState): Promise<string>;
}

export interface UIEmbeddingService {
  /** Embed a single text description */
  embed(text: string): Promise<number[]>;

  /** Embed multiple text descriptions in batch */
  embedBatch(texts: string[]): Promise<number[][]>;

  /** Calculate cosine similarity between two embeddings */
  cosineSimilarity(a: number[], b: number[]): number;
}

export interface UISemanticIndex {
  /** Index a screen state (all nodes, subtrees, and screen-level) */
  indexScreenState(screenState: UIScreenState): Promise<void>;

  /** Search for UI elements matching a query */
  search(query: SemanticSearchQuery): Promise<SemanticSearchResult[]>;

  /** Get a specific node by ID */
  getNode(id: string): Promise<UISemanticNode | null>;

  /** Get a specific subtree by ID */
  getSubtree(id: string): Promise<UISubtree | null>;

  /** Get a specific screen state by ID */
  getScreenState(id: string): Promise<UIScreenState | null>;

  /** Get all screen states in a time range */
  getScreenHistory(startTime: number, endTime: number): Promise<UIScreenState[]>;

  /** Clear the index */
  clear(): Promise<void>;
}

export interface HybridSearchStrategy {
  /** Combine semantic and symbolic search */
  search(query: SemanticSearchQuery): Promise<SemanticSearchResult[]>;

  /** Apply symbolic filters first, then semantic ranking */
  symbolicPrefilter(
    nodes: UISemanticNode[],
    filters: SemanticSearchQuery['filters']
  ): UISemanticNode[];

  /** Rank filtered results by semantic similarity */
  semanticRank(
    nodes: UISemanticNode[],
    queryEmbedding: number[]
  ): SemanticSearchResult[];
}
