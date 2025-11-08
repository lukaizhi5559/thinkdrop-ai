# 🧠 Thinkdrop AI

An intelligent screen/audio overlay assistant powered by **n8n agent orchestration** with support for multi-LLM routing, document generation, contextual awareness, and external service integration.

## 🎯 Features

- **Real-time Audio Capture & STT** - Continuous speech-to-text processing
- **Clipboard Monitoring** - Automatic text analysis and action suggestions  
- **Vision Capabilities** - Screen capture, OCR, and VLM scene understanding
- **Multi-LLM Support** - OpenAI, Anthropic, Google AI, Mistral with intelligent routing
- **MCP Microservices** - Modular services for memory, conversation, vision, and more
- **n8n Agent Orchestration** - Dynamic webhook-driven workflows
- **Vector Memory** - Semantic storage with embeddings
- **Transparent Overlay UI** - Non-intrusive floating interface
- **Document Generation** - AI-powered note and document creation
- **External Integrations** - Slack, email, Jira automation

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Electron UI   │    │   Core Engine   │    │ Agent Dispatcher│
│   (React)       │◄───│   (Node.js)     │◄───│    (n8n)        │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │              ┌─────────────────┐              │
         │              │   LLM Router    │              │
         └──────────────│ OpenAI/Claude/  │──────────────┘
                        │ Gemini/Mistral  │
                        └─────────────────┘
                                 │
                    ┌─────────────────────────────┐
                    │     Vector Memory           │
                    │  Pinecone + Redis Cache     │
                    └─────────────────────────────┘
```

## 🔌 MCP Services

ThinkDrop AI uses a microservices architecture with the following services:

| Service | Port | Description |
|---------|------|-------------|
| **User Memory** | 3001 | Vector storage and semantic search |
| **Web Search** | 3002 | Web search and content extraction |
| **Phi4** | 3003 | Intent parsing and embeddings |
| **Conversation** | 3004 | Session and message management |
| **Coreference** | 3005 | Reference resolution (Python) |
| **Vision** | 3006 | Screen capture, OCR, VLM (Python) |
| **Command** | 3007 | Command execution and interpretation |

### Start All Services
```bash
./scripts/start-all-services.sh
```

### Stop All Services
```bash
./scripts/stop-all-services.sh
```

### Individual Service Setup
```bash
# Vision service (requires Python setup)
cd mcp-services/vision-service
./setup.sh
./start.sh
```

See individual service READMEs for detailed documentation.

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ 
- npm or yarn
- At least one LLM API key (OpenAI, Anthropic, Google AI, or Mistral)
- Optional: Redis, Pinecone, n8n instance

### Installation

```bash
# Clone and setup
git clone <your-repo>
cd thinkdrop-ai
npm install

# Setup environment variables
cp .env.example .env
# Edit .env with your API keys and configuration

# Start development
npm run dev
```

### Environment Setup

Copy `.env.example` to `.env` and configure:

```env
# Required: At least one LLM provider
OPENAI_API_KEY=sk-your-openai-key-here
ANTHROPIC_API_KEY=your-anthropic-key-here

# Optional: Enhanced features
PINECONE_API_KEY=your-pinecone-key
REDIS_URL=redis://localhost:6379
N8N_WEBHOOK_SUMMARIZER=https://your-n8n.com/webhook/summarizer

# Development mode (enables simulated responses)
SHOULD_RUN_SIMULATED_RESPONSES=true
```

# thinkdrop-ai
