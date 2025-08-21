import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { ChatRequest, ChatMessage } from '../../domain/chat';
import type { McpTool } from '../../domain/mcp';

export interface OllamaResponse {
  needsToolExecution: boolean;
  content: string;
  toolCalls?: any[];
}

export class OllamaClient {
  private baseUrl: string;
  constructor(baseUrl: string = process.env.OLLAMA_BASE_URL || 'http://localhost:11434') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    console.log(`🌐 Ollama client initialized with base URL: ${this.baseUrl}`);
  }

  async listModels(): Promise<string[]> {
    console.log('📋 Fetching available models from Ollama...');
    try {
      const { data } = await axios.get(`${this.baseUrl}/api/tags`);
      const models = (data.models || []).map((m: any) => m.name);
      console.log(`✅ Found ${models.length} models:`, models.join(', '));
      return models;
    } catch (error) {
      console.error('❌ Error fetching models:', error instanceof Error ? error.message : error);
      throw error;
    }
  }

  async generate(req: ChatRequest, tools?: McpTool[]): Promise<OllamaResponse> {
    console.log(`🚀 Starting generation with model: ${req.model}`);
    console.log(`📝 Messages count: ${req.messages.length}`);
    console.log(`🔧 Available tools: ${tools?.length || 0}`);
    
    // Convert messages to format expected by Ollama /api/chat
    const messages = await Promise.all(req.messages.map(m => this.mapMessage(m)));
    console.log(`📨 Messages converted successfully`);
    
    const payload: any = {
      model: req.model,
      messages,
      stream: false
    };

    // Check if model supports tools and add them if available
    const supportsTools = await this.modelSupportsTools(req.model);
    console.log(`🎯 Model ${req.model} supports tools: ${supportsTools}`);
    
    if (tools && tools.length > 0 && supportsTools) {
      // Limit tools to prevent UI freezing with smaller models
      const maxTools = this.getMaxToolsForModel(req.model);
      
      // Tools are already prioritized by MCP Manager, so we just slice the first maxTools
      const limitedTools = tools.slice(0, maxTools);
      
      console.log(`🔧 Tools available: ${tools.length}, sending to Ollama: ${limitedTools.length} (max: ${maxTools})`);
      
      if (tools.length > maxTools) {
        console.log(`ℹ️ Limited tools for model ${req.model} to prevent performance issues (terminal tools prioritized)`);
      }
      
      payload.tools = limitedTools.map(tool => {
        try {
          const schema = tool.schema || {};
          const requiredFields = Object.keys(schema).filter(key => schema[key] && schema[key].required) || [];
          
          console.log(`🔩 Processing tool: ${tool.name} with ${Object.keys(schema).length} parameters`);
          
          return {
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description || 'Tool function',
              parameters: {
                type: 'object',
                properties: schema,
                required: requiredFields
              }
            }
          };
        } catch (error) {
          console.warn(`⚠️ Error processing tool ${tool.name}:`, error);
          return {
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description || 'Tool function',
              parameters: {
                type: 'object',
                properties: {},
                required: []
              }
            }
          };
        }
      });
      console.log('🚀 Tools formatted for Ollama:', payload.tools.length);
    } else if (tools && tools.length > 0 && !supportsTools) {
      console.warn(`⚠️ Model ${req.model} does not support tools. Use llama3.1, qwen2.5, or another compatible model.`);
    }

    console.log('📡 Sending request to Ollama API...');
    console.log(`📊 Payload size: ${JSON.stringify(payload).length} characters`);
    
    try {
      const startTime = Date.now();
      const { data } = await axios.post(`${this.baseUrl}/api/chat`, payload, {
        timeout: 300000, // 5 minute timeout
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      const responseTime = Date.now() - startTime;
      console.log(`✅ Received response from Ollama API in ${responseTime}ms`);
      console.log('📄 Response structure:', {
        hasMessage: !!data.message,
        hasContent: !!data.message?.content,
        hasToolCalls: !!data.message?.tool_calls,
        toolCallsCount: data.message?.tool_calls?.length || 0
      });
      
      if (data.message?.content) {
        console.log('💬 Message content length:', data.message.content.length);
      }
      
      // Check if the response contains tool calls
      if (data.message?.tool_calls && data.message.tool_calls.length > 0) {
        console.log('🔧 Model wants to use tools:', data.message.tool_calls.length);
        data.message.tool_calls.forEach((call: any, index: number) => {
          console.log(`🛠️ Tool call ${index + 1}: ${call.function?.name} with args:`, Object.keys(call.function?.arguments || {}).join(', '));
        });
        return { 
          needsToolExecution: true, 
          toolCalls: data.message.tool_calls,
          content: data.message?.content || ''
        };
      }
      
      const content = data.message?.content ?? '';
      console.log('� Returning text response, content length:', content.length);
      return { needsToolExecution: false, content };
    } catch (error) {
      console.error('❌ Error calling Ollama API:', error);
      if (axios.isAxiosError(error)) {
        console.error('🔍 Axios error details:', {
          code: error.code,
          status: error.response?.status,
          statusText: error.response?.statusText,
          url: error.config?.url
        });
        
        if (error.code === 'ECONNREFUSED') {
          throw new Error('Cannot connect to Ollama server. Please make sure Ollama is running on http://localhost:11434');
        } else if (error.code === 'ECONNABORTED') {
          throw new Error('Request timed out. The model might be taking too long to process the request.');
        }
      }
      throw error;
    }
  }

  private async modelSupportsTools(modelName: string): Promise<boolean> {
    // Known models that support tools - being more conservative
    const toolSupportedModels = [
      'llama3.1',
      'qwen2.5',
      'mistral-nemo',
      'mistral-large'
    ];
    
    const supportsTools = toolSupportedModels.some(supportedModel => 
      modelName.toLowerCase().includes(supportedModel.toLowerCase())
    );
    
    console.log(`🔍 Checking tool support for ${modelName}: ${supportsTools}`);
    
    // For now, let's be more conservative about tool support
    // llama3.2 might have issues with 60 tools at once
    return supportsTools;
  }

  private getMaxToolsForModel(modelName: string): number {
    const lowerName = modelName.toLowerCase();
    
    let maxTools: number;
    
    // Conservative limits based on model capabilities
    if (lowerName.includes('llama3.1:8b') || lowerName.includes('8b')) {
      maxTools = 15; // Very conservative for 8B models
    } else if (lowerName.includes('llama3.1') && lowerName.includes('70b')) {
      maxTools = 40; // More tools for larger models
    } else if (lowerName.includes('qwen2.5:latest') || lowerName.includes('qwen2.5:32b')) {
      maxTools = 25; // Good balance for Qwen2.5 latest
    } else if (lowerName.includes('qwen2.5') && lowerName.includes('14b')) {
      maxTools = 20; // Medium for 14B models
    } else if (lowerName.includes('qwen2.5') && lowerName.includes('7b')) {
      maxTools = 15; // Conservative for 7B
    } else if (lowerName.includes('mistral-large')) {
      maxTools = 50; // Mistral Large can handle more
    } else if (lowerName.includes('mistral-nemo')) {
      maxTools = 20; // Conservative for Nemo
    } else {
      // Default conservative limit for unknown models
      maxTools = 10;
    }
    
    console.log(`🎯 Max tools for model ${modelName}: ${maxTools}`);
    return maxTools;
  }

  private async mapMessage(m: ChatMessage): Promise<any> {
    console.log(`📧 Mapping message: ${m.role} (has image: ${!!m.imagePath})`);
    
    if (!m.imagePath) {
      console.log(`📝 Text-only message, content length: ${m.content.length}`);
      return { role: m.role, content: m.content };
    }
    
    try {
      console.log(`🖼️ Processing image: ${m.imagePath}`);
      const imgBuffer = await fs.readFile(m.imagePath);
      const b64 = imgBuffer.toString('base64');
      console.log(`✅ Image converted to base64, size: ${b64.length} characters`);
      return { role: m.role, content: m.content, images: [b64] };
    } catch (error) {
      console.error(`❌ Error processing image ${m.imagePath}:`, error);
      // Return message without image if there's an error
      return { role: m.role, content: m.content };
    }
  }
}
