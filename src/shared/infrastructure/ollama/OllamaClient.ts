import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { ChatRequest, ChatMessage } from '../../domain/chat';
import type { McpTool } from '../../domain/mcp';

export class OllamaClient {
  private baseUrl: string;
  constructor(baseUrl: string = process.env.OLLAMA_BASE_URL || 'http://localhost:11434') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async listModels(): Promise<string[]> {
    const { data } = await axios.get(`${this.baseUrl}/api/tags`);
    return (data.models || []).map((m: any) => m.name);
  }

  async generate(req: ChatRequest, tools?: McpTool[]): Promise<string> {
    // Convert messages to format expected by Ollama /api/chat
    const messages = await Promise.all(req.messages.map(m => this.mapMessage(m)));
    
    const payload: any = {
      model: req.model,
      messages,
      stream: false
    };

    // Check if model supports tools and add them if available
    const supportsTools = await this.modelSupportsTools(req.model);
    
    if (tools && tools.length > 0 && supportsTools) {
      // Limit tools to prevent UI freezing with smaller models
      const maxTools = this.getMaxToolsForModel(req.model);
      const limitedTools = tools.slice(0, maxTools);
      
      console.log(`🔧 Tools available: ${tools.length}, sending to Ollama: ${limitedTools.length} (max: ${maxTools})`);
      
      if (tools.length > maxTools) {
        console.log(`ℹ️ Limited tools for model ${req.model} to prevent performance issues`);
      }
      
      payload.tools = limitedTools.map(tool => {
        try {
          const schema = tool.schema || {};
          const requiredFields = Object.keys(schema).filter(key => schema[key] && schema[key].required) || [];
          
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

    const { data } = await axios.post(`${this.baseUrl}/api/chat`, payload);
    return data.message?.content ?? '';
  }

  private async modelSupportsTools(modelName: string): Promise<boolean> {
    // Known models that support tools - being more conservative
    const toolSupportedModels = [
      'llama3.1',
      'qwen2.5',
      'mistral-nemo',
      'mistral-large'
    ];
    
    // For now, let's be more conservative about tool support
    // llama3.2 might have issues with 60 tools at once
    return toolSupportedModels.some(supportedModel => 
      modelName.toLowerCase().includes(supportedModel.toLowerCase())
    );
  }

  private getMaxToolsForModel(modelName: string): number {
    const lowerName = modelName.toLowerCase();
    
    // Conservative limits based on model capabilities
    if (lowerName.includes('llama3.1:8b') || lowerName.includes('8b')) {
      return 15; // Very conservative for 8B models
    } else if (lowerName.includes('llama3.1') && lowerName.includes('70b')) {
      return 40; // More tools for larger models
    } else if (lowerName.includes('qwen2.5') && lowerName.includes('14b')) {
      return 25; // Medium for 14B models
    } else if (lowerName.includes('qwen2.5') && lowerName.includes('32b')) {
      return 35; // More for larger Qwen models
    } else if (lowerName.includes('mistral-large')) {
      return 50; // Mistral Large can handle more
    } else if (lowerName.includes('mistral-nemo')) {
      return 20; // Conservative for Nemo
    }
    
    // Default conservative limit for unknown models
    return 10;
  }

  private async mapMessage(m: ChatMessage): Promise<any> {
    if (!m.imagePath) return { role: m.role, content: m.content };
    const imgBuffer = await fs.readFile(m.imagePath);
    const b64 = imgBuffer.toString('base64');
    return { role: m.role, content: m.content, images: [b64] };
  }
}
