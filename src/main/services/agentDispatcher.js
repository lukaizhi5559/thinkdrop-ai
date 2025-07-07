/**
 * Agent Dispatcher - Routes context data to appropriate n8n webhook agents
 */
import axios from 'axios';

class AgentDispatcher {
  constructor() {
    this.webhookUrls = {
      summarizer: process.env.N8N_WEBHOOK_SUMMARIZER,
      clipboard: process.env.N8N_WEBHOOK_CLIPBOARD,
      docGeneration: process.env.N8N_WEBHOOK_DOC_GENERATION,
      action: process.env.N8N_WEBHOOK_ACTION,
      tts: process.env.N8N_WEBHOOK_TTS,
      screenshot: process.env.N8N_WEBHOOK_SCREENSHOT
    };
  }

  /**
   * Analyze context and determine which agent(s) to trigger
   */
  analyzeContext(data) {
    const { type, content, intent } = data;
    const agents = [];

    // Text-based intent detection
    const contentLower = content.toLowerCase();

    // Summarizer Agent
    if (contentLower.includes('summarize') || contentLower.includes('summary') || type === 'transcript') {
      agents.push('summarizer');
    }

    // Doc Generation Agent
    if (contentLower.includes('generate') && (contentLower.includes('document') || contentLower.includes('notes'))) {
      agents.push('docGeneration');
    }

    // Action Agent (Slack, Email, Jira)
    if (contentLower.includes('send to slack') || contentLower.includes('email') || contentLower.includes('create ticket')) {
      agents.push('action');
    }

    // TTS Agent
    if (contentLower.includes('read aloud') || contentLower.includes('speak this')) {
      agents.push('tts');
    }

    // Screenshot Agent
    if (contentLower.includes('screenshot') || contentLower.includes('capture screen') || 
        contentLower.includes('analyze screen') || type === 'screenshot') {
      agents.push('screenshot');
    }

    // Clipboard Agent (always trigger for clipboard events)
    if (type === 'clipboard') {
      agents.push('clipboard');
    }

    // Default to summarizer if no specific intent detected
    if (agents.length === 0) {
      agents.push('summarizer');
    }

    return agents;
  }

  /**
   * Send data to specific n8n webhook
   */
  async triggerAgent(agentType, sessionData) {
    const webhookUrl = this.webhookUrls[agentType];
    
    if (!webhookUrl) {
      console.warn(`⚠️ No webhook URL configured for agent: ${agentType}`);
      return null;
    }

    try {
      console.log(`🤖 Triggering ${agentType} agent...`);
      
      const payload = {
        timestamp: new Date().toISOString(),
        agentType,
        sessionContext: sessionData,
        metadata: {
          userAgent: 'ThinkdropAI/1.0',
          platform: process.platform
        }
      };

      const response = await axios.post(webhookUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ThinkdropAI-Dispatcher/1.0'
        },
        timeout: 10000 // 10 second timeout
      });

      console.log(`✅ ${agentType} agent response:`, response.status);
      return response.data;
    } catch (error) {
      console.error(`❌ Error triggering ${agentType} agent:`, error.message);
      
      // Fallback to simulated response if configured
      if (process.env.SHOULD_RUN_SIMULATED_RESPONSES === 'true') {
        return this.generateSimulatedResponse(agentType, sessionData);
      }
      
      throw error;
    }
  }

  /**
   * Process input and route to appropriate agents
   */
  async processInput(inputData) {
    const { type, content, context } = inputData;
    
    // Build session context
    const sessionData = {
      input: {
        type,
        content,
        timestamp: new Date().toISOString()
      },
      context: context || {},
      requestId: this.generateRequestId()
    };

    // Determine which agents to trigger
    const targetAgents = this.analyzeContext({ type, content });
    
    console.log(`🎯 Routing to agents: ${targetAgents.join(', ')}`);

    // Trigger agents in parallel
    const agentPromises = targetAgents.map(agent => 
      this.triggerAgent(agent, sessionData)
        .catch(error => ({ error: error.message, agent }))
    );

    const results = await Promise.all(agentPromises);
    
    return {
      requestId: sessionData.requestId,
      agents: targetAgents,
      results: results.filter(result => result !== null)
    };
  }

  /**
   * Generate simulated responses for testing
   */
  generateSimulatedResponse(agentType, sessionData) {
    const simulatedResponses = {
      summarizer: {
        summary: `This is a simulated summary of: "${sessionData.input.content.substring(0, 100)}..."`,
        keyPoints: ['Key point 1', 'Key point 2', 'Key point 3'],
        confidence: 0.85
      },
      clipboard: {
        analysis: 'Clipboard content analyzed',
        suggestedActions: ['Copy to notes', 'Share with team', 'Create reminder'],
        categories: ['text', 'productivity']
      },
      docGeneration: {
        documentUrl: 'https://example.com/generated-doc.md',
        format: 'markdown',
        wordCount: 350
      },
      action: {
        actionTaken: 'Simulated action execution',
        platform: 'slack',
        status: 'completed'
      },
      tts: {
        audioUrl: 'https://example.com/synthesized-audio.mp3',
        duration: '30s',
        voice: 'neural'
      },
      screenshot: {
        analysis: 'Screen content analyzed successfully',
        elements: ['button', 'text field', 'image'],
        suggestions: ['Click here', 'Fill this form', 'Read this text'],
        confidence: 0.92,
        ocrText: `Simulated OCR text from screenshot: "${sessionData.input.content.substring(0, 50)}..."`
      }
    };

    console.log(`🎭 Generating simulated response for ${agentType}`);
    return {
      ...simulatedResponses[agentType],
      simulated: true,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate unique request ID
   */
  generateRequestId() {
    return `td_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Health check for webhook endpoints
   */
  async healthCheck() {
    const results = {};
    
    for (const [agentType, url] of Object.entries(this.webhookUrls)) {
      if (!url) {
        results[agentType] = { status: 'not_configured' };
        continue;
      }
      
      try {
        const response = await axios.get(url, { timeout: 5000 });
        results[agentType] = { 
          status: 'healthy', 
          statusCode: response.status 
        };
      } catch (error) {
        results[agentType] = { 
          status: 'unhealthy', 
          error: error.message 
        };
      }
    }
    
    return results;
  }
}

export default AgentDispatcher;
