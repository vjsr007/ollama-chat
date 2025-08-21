import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export interface ExternalModel {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic' | 'github-copilot' | 'google' | 'cohere';
  model: string;
  apiKey?: string;
  endpoint?: string;
  enabled: boolean;
  description?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface ExternalModelConfig {
  models: ExternalModel[];
  lastUpdated: string;
}

export class ExternalModelManager {
  private configPath: string;
  private config: ExternalModelConfig;

  constructor() {
    // Store configuration in userData directory
    const userDataPath = app.getPath('userData');
    this.configPath = path.join(userDataPath, 'external-models.json');
    this.config = this.loadConfig();
  }

  private loadConfig(): ExternalModelConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.error('Error loading external models config:', error);
    }
    
    // Return default config
    return {
      models: [],
      lastUpdated: new Date().toISOString()
    };
  }

  private saveConfig(): void {
    try {
      const userDataPath = path.dirname(this.configPath);
      if (!fs.existsSync(userDataPath)) {
        fs.mkdirSync(userDataPath, { recursive: true });
      }
      
      this.config.lastUpdated = new Date().toISOString();
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('Error saving external models config:', error);
    }
  }

  public getModels(): ExternalModel[] {
    return this.config.models;
  }

  public getEnabledModels(): ExternalModel[] {
    return this.config.models.filter(m => m.enabled);
  }

  public addModel(model: Omit<ExternalModel, 'id'>): ExternalModel {
    const newModel: ExternalModel = {
      ...model,
      id: Date.now().toString()
    };
    
    this.config.models.push(newModel);
    this.saveConfig();
    return newModel;
  }

  public updateModel(id: string, updates: Partial<ExternalModel>): boolean {
    const index = this.config.models.findIndex(m => m.id === id);
    if (index === -1) return false;
    
    this.config.models[index] = { ...this.config.models[index], ...updates };
    this.saveConfig();
    return true;
  }

  public removeModel(id: string): boolean {
    const index = this.config.models.findIndex(m => m.id === id);
    if (index === -1) return false;
    
    this.config.models.splice(index, 1);
    this.saveConfig();
    return true;
  }

  public enableModel(id: string, enabled: boolean): boolean {
    return this.updateModel(id, { enabled });
  }

  public getModel(id: string): ExternalModel | undefined {
    return this.config.models.find(m => m.id === id);
  }

  public getModelByProvider(provider: string): ExternalModel[] {
    return this.config.models.filter(m => m.provider === provider && m.enabled);
  }

  // Validate API key for a provider
  public async validateApiKey(provider: string, apiKey: string, endpoint?: string): Promise<boolean> {
    try {
      switch (provider) {
        case 'openai':
          return await this.validateOpenAIKey(apiKey, endpoint);
        case 'anthropic':
          return await this.validateAnthropicKey(apiKey);
        case 'github-copilot':
          return await this.validateGitHubCopilotKey(apiKey);
        case 'google':
          return await this.validateGoogleKey(apiKey);
        case 'cohere':
          return await this.validateCohereKey(apiKey);
        default:
          return false;
      }
    } catch (error) {
      console.error(`Error validating ${provider} API key:`, error);
      return false;
    }
  }

  private async validateOpenAIKey(apiKey: string, endpoint?: string): Promise<boolean> {
    const baseURL = endpoint || 'https://api.openai.com/v1';
    try {
      const response = await fetch(`${baseURL}/models`, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async validateAnthropicKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'test' }]
        })
      });
      
      // Even if it fails due to quota or other issues, 
      // a 401 means invalid key, anything else means valid key
      return response.status !== 401;
    } catch {
      return false;
    }
  }

  private async validateGitHubCopilotKey(apiKey: string): Promise<boolean> {
    try {
      // GitHub Copilot uses GitHub's API infrastructure
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${apiKey}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private async validateGoogleKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`);
      return response.ok;
    } catch {
      return false;
    }
  }

  private async validateCohereKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch('https://api.cohere.ai/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  // Generate chat completion for external models
  public async generateChatCompletion(
    modelId: string, 
    messages: any[], 
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<string> {
    const model = this.getModel(modelId);
    if (!model || !model.enabled) {
      throw new Error(`Model ${modelId} not found or disabled`);
    }

    if (!model.apiKey) {
      throw new Error(`No API key configured for model ${modelId}`);
    }

    switch (model.provider) {
      case 'openai':
        return await this.callOpenAI(model, messages, options);
      case 'anthropic':
        return await this.callAnthropic(model, messages, options);
      case 'github-copilot':
        return await this.callGitHubCopilot(model, messages, options);
      case 'google':
        return await this.callGoogle(model, messages, options);
      case 'cohere':
        return await this.callCohere(model, messages, options);
      default:
        throw new Error(`Unsupported provider: ${model.provider}`);
    }
  }

  private async callOpenAI(model: ExternalModel, messages: any[], options?: any): Promise<string> {
    const baseURL = model.endpoint || 'https://api.openai.com/v1';
    
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${model.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model.model,
        messages,
        temperature: options?.temperature ?? model.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? model.maxTokens ?? 4096
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  }

  private async callAnthropic(model: ExternalModel, messages: any[], options?: any): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': model.apiKey!,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: model.model,
        messages,
        max_tokens: options?.maxTokens ?? model.maxTokens ?? 4096,
        temperature: options?.temperature ?? model.temperature ?? 0.7
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.content[0]?.text || '';
  }

  private async callGitHubCopilot(model: ExternalModel, messages: any[], options?: any): Promise<string> {
    // GitHub Copilot uses their chat API
    const response = await fetch('https://api.githubcopilot.com/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${model.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model.model,
        messages,
        temperature: options?.temperature ?? model.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? model.maxTokens ?? 4096
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub Copilot API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || '';
  }

  private async callGoogle(model: ExternalModel, messages: any[], options?: any): Promise<string> {
    // Convert messages to Google's format
    const contents = messages.map(msg => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    }));

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model.model}:generateContent?key=${model.apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: options?.temperature ?? model.temperature ?? 0.7,
            maxOutputTokens: options?.maxTokens ?? model.maxTokens ?? 4096
          }
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Google API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.candidates[0]?.content?.parts[0]?.text || '';
  }

  private async callCohere(model: ExternalModel, messages: any[], options?: any): Promise<string> {
    // Convert messages to Cohere's format
    const chatHistory = messages.slice(0, -1).map(msg => ({
      role: msg.role === 'assistant' ? 'CHATBOT' : 'USER',
      message: msg.content
    }));
    
    const lastMessage = messages[messages.length - 1];

    const response = await fetch('https://api.cohere.ai/v1/chat', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${model.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model.model,
        message: lastMessage.content,
        chat_history: chatHistory,
        temperature: options?.temperature ?? model.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? model.maxTokens ?? 4096
      })
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Cohere API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    return data.text || '';
  }
}
