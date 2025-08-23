import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import keytar from 'keytar';

export interface ExternalModel {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic' | 'github-copilot' | 'google' | 'cohere' | 'mistral' | 'custom';
  model: string;
  // apiKey is no longer persisted to disk. At runtime we may return a sentinel value "__SECURE__" to indicate a stored key.
  apiKey?: string; 
  endpoint?: string;
  enabled: boolean;
  description?: string;
  maxTokens?: number;
  temperature?: number;
  lastValidationStatus?: 'valid' | 'invalid' | 'error';
  lastValidationMessage?: string;
}

export interface ExternalModelConfig {
  models: ExternalModel[];
  lastUpdated: string;
}

export class ExternalModelManager {
  private configPath: string;
  private config: ExternalModelConfig;
  private serviceName: string;

  constructor() {
    // Store configuration in userData directory
    const userDataPath = app.getPath('userData');
    this.configPath = path.join(userDataPath, 'external-models.json');
    // Service name for keytar (stable, unique)
    this.serviceName = 'ollama-chat-external-model';
    this.config = this.loadConfig();
  }

  private loadConfig(): ExternalModelConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        const parsed: ExternalModelConfig = JSON.parse(data);
        // One-time migration: move any inline apiKey fields into secure storage
        let migrated = false;
        for (const m of parsed.models) {
          if (m.apiKey) {
            try {
              keytar.setPassword(this.serviceName, m.id, m.apiKey);
              delete m.apiKey; // remove plaintext
              migrated = true;
            } catch (e) {
              console.error('Error migrating apiKey to keytar for model', m.name, e);
            }
          }
        }
        if (migrated) {
          try { this.saveConfigInternal(parsed); } catch {}
        }
        return parsed;
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
      // Ensure no apiKey fields leak into persisted file
      const cloned: ExternalModelConfig = JSON.parse(JSON.stringify(this.config));
      cloned.models.forEach(m => { if (m.apiKey) delete m.apiKey; });
      fs.writeFileSync(this.configPath, JSON.stringify(cloned, null, 2));
    } catch (error) {
      console.error('Error saving external models config:', error);
    }
  }

  // Internal save for migration (assumes config already sanitized)
  private saveConfigInternal(cfg: ExternalModelConfig) {
    try {
      const userDataPath = path.dirname(this.configPath);
      if (!fs.existsSync(userDataPath)) {
        fs.mkdirSync(userDataPath, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(cfg, null, 2));
    } catch (e) {
      console.error('Error during internal save:', e);
    }
  }

  public getModels(): ExternalModel[] {
    return this.config.models;
  }

  // Returns sanitized models with apiKey replaced by sentinel if stored securely
  public async getModelsSanitized(): Promise<ExternalModel[]> {
    const out: ExternalModel[] = [];
    for (const m of this.config.models) {
      const hasKey = await this.hasStoredKey(m.id);
      out.push({ ...m, apiKey: hasKey ? '__SECURE__' : undefined });
    }
    return out;
  }

  private async hasStoredKey(id: string): Promise<boolean> {
    try {
      const pw = await keytar.getPassword(this.serviceName, id);
      return !!pw;
    } catch {
      return false;
    }
  }

  private async getStoredKey(id: string): Promise<string | undefined> {
    try {
      const direct = await keytar.getPassword(this.serviceName, id) || undefined;
      if (direct) return direct;
      // Fallback to environment variable per provider
      const model = this.getModel(id);
      if (model) {
        const envVar = this.resolveEnvVarForProvider(model.provider);
        if (envVar && process.env[envVar]) return process.env[envVar];
        if (model.provider === 'custom' && process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private async setStoredKey(id: string, key?: string) {
    try {
      if (!key) {
        await keytar.deletePassword(this.serviceName, id);
      } else {
        await keytar.setPassword(this.serviceName, id, key);
      }
    } catch (e) {
      console.error('Error setting stored key for model', id, e);
    }
  }

  public getEnabledModels(): ExternalModel[] {
    return this.config.models.filter(m => m.enabled);
  }

  public addModel(model: Omit<ExternalModel, 'id'>): ExternalModel {
    // Deduplicate by provider+model (and name if provided)
    const existing = this.config.models.find(m => 
      m.provider === model.provider && 
      m.model === model.model && 
      (model.name ? m.name === model.name : true)
    );
    if (existing) {
      // Merge simple updatable fields (description, temperature, maxTokens, endpoint, apiKey, enabled)
      existing.description = model.description ?? existing.description;
      existing.temperature = model.temperature ?? existing.temperature;
      existing.maxTokens = model.maxTokens ?? existing.maxTokens;
      existing.endpoint = model.endpoint ?? existing.endpoint;
      existing.enabled = model.enabled ?? existing.enabled;
      // Store key securely if provided
      if (model.apiKey) {
        this.setStoredKey(existing.id, model.apiKey);
      }
      this.saveConfig();
      return existing;
    }
    const newModel: ExternalModel = {
      ...model,
      id: Date.now().toString()
    };
    // Remove any inline key; store securely
    const providedKey = newModel.apiKey;
    if (providedKey) delete (newModel as any).apiKey;
    this.config.models.push(newModel);
    this.saveConfig();
    if (providedKey) this.setStoredKey(newModel.id, providedKey);
    return newModel;
  }

  public updateModel(id: string, updates: Partial<ExternalModel>): boolean {
    const index = this.config.models.findIndex(m => m.id === id);
    if (index === -1) return false;
    const current = this.config.models[index];
    const { apiKey, ...rest } = updates as any;
    this.config.models[index] = { ...current, ...rest };
    if (apiKey !== undefined) {
      // Empty string -> delete stored key
      this.setStoredKey(id, apiKey || undefined);
    }
    // Ensure no apiKey persisted
    delete (this.config.models[index] as any).apiKey;
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

  // Helper: find by provider+model
  public findBySignature(provider: string, model: string): ExternalModel | undefined {
    return this.config.models.find(m => m.provider === provider && m.model === model);
  }

  public async validateModel(id: string): Promise<{status: string; message: string}> {
    const model = this.getModel(id);
    if (!model) return { status: 'error', message: 'Model not found' };
    const apiKey = await this.getStoredKey(id);
    if (!apiKey) {
      const envVar = this.resolveEnvVarForProvider(model.provider);
      model.lastValidationStatus = 'invalid';
      model.lastValidationMessage = `Missing API key (secure store or env var ${envVar || 'N/A'})`;
      this.saveConfig();
      return { status: 'invalid', message: model.lastValidationMessage };
    }
    try {
      // Perform lightweight provider-specific validation
      let ok = false; let msg = 'OK';
      if (model.provider === 'github-copilot') {
        // Simple user fetch + attempt tiny response call
        const userResp = await fetch('https://api.github.com/user', { headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/vnd.github+json' }});
        if (!userResp.ok) {
          ok = false; msg = `GitHub auth failed: ${userResp.status}`;
          console.warn('[GitHub Models][validate] user endpoint failed', { status: userResp.status });
        } else {
          // Try a 1-token completion (best-effort)
          try {
            const resp = await fetch(`https://api.github.com/models/${model.model}/responses`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/vnd.github+json',
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': '2022-11-28'
              },
              body: JSON.stringify({ model: model.model, input: [{ role: 'user', content: [{ type: 'text', text: 'ping'}]}], max_tokens: 1 })
            });
            ok = resp.ok;
            if (!ok) {
              const bodyTxt = await resp.text();
              const snippet = bodyTxt.slice(0, 300).replace(/\s+/g, ' ').trim();
              msg = `Response error ${resp.status}${resp.status === 404 ? ' (model not found – verify model name & access)' : ''}${snippet ? ': ' + snippet : ''}`;
              console.warn('[GitHub Models][validate] response not ok', { status: resp.status, model: model.model, snippet });
            } else {
              console.debug('[GitHub Models][validate] minimal call ok', { model: model.model });
            }
          } catch (e: any) {
            ok = false; msg = 'Error calling model: ' + e.message;
            console.error('[GitHub Models][validate] exception', e);
          }
        }
      } else if (model.provider === 'openai') {
        ok = await this.validateOpenAIKey(apiKey, model.endpoint);
        if (!ok) msg = 'OpenAI key invalid';
      } else if (model.provider === 'anthropic') {
        ok = await this.validateAnthropicKey(apiKey);
        if (!ok) msg = 'Anthropic key invalid';
      } else if (model.provider === 'google') {
        ok = await this.validateGoogleKey(apiKey);
        if (!ok) msg = 'Google key invalid';
      } else if (model.provider === 'cohere') {
        ok = await this.validateCohereKey(apiKey);
        if (!ok) msg = 'Cohere key invalid';
      } else if (model.provider === 'mistral') {
        ok = await this.validateMistralKey(apiKey);
        if (!ok) msg = 'Mistral key invalid';
      } else if (model.provider === 'custom') {
        // Treat as OpenAI compatible
        ok = await this.validateOpenAIKey(apiKey, model.endpoint || '');
        if (!ok) msg = 'Custom (OpenAI-compatible) key invalid or endpoint unreachable';
      }
      model.lastValidationStatus = ok ? 'valid' : 'invalid';
      model.lastValidationMessage = msg;
      this.saveConfig();
      return { status: model.lastValidationStatus, message: msg };
    } catch (error: any) {
      model.lastValidationStatus = 'error';
      model.lastValidationMessage = error?.message || 'Unknown error';
      this.saveConfig();
  return { status: 'error', message: model.lastValidationMessage || 'Unknown error' };
    }
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
        case 'mistral':
          return await this.validateMistralKey(apiKey);
        case 'custom':
          return await this.validateOpenAIKey(apiKey, endpoint);
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

  private async validateMistralKey(apiKey: string): Promise<boolean> {
    try {
      const response = await fetch('https://api.mistral.ai/v1/models', {
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
    const apiKey = await this.getStoredKey(modelId);
    if (!apiKey) throw new Error(`No API key configured for model ${modelId} (fallback env var ${this.resolveEnvVarForProvider(model.provider) || 'N/A'})`);

    switch (model.provider) {
      case 'openai':
        return await this.callOpenAI({ ...model, apiKey }, messages, options);
      case 'anthropic':
        return await this.callAnthropic({ ...model, apiKey }, messages, options);
      case 'github-copilot':
        return await this.callGitHubCopilot({ ...model, apiKey }, messages, options);
      case 'google':
        return await this.callGoogle({ ...model, apiKey }, messages, options);
      case 'cohere':
        return await this.callCohere({ ...model, apiKey }, messages, options);
      case 'mistral':
        return await this.callMistral({ ...model, apiKey }, messages, options);
      case 'custom':
        return await this.callOpenAI({ ...model, apiKey }, messages, options);
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
    // Real call using GitHub Models Responses API (public preview).
    // Docs reference: POST https://api.github.com/models/{model}/responses
    // Token: A GitHub Personal Access Token (classic) or fine‑grained token with models scope (preview) / Copilot subscription.
    if (!model.apiKey) {
      return 'GitHub Copilot/GitHub Models: API key (GitHub PAT) not configured. Create one in GitHub Settings > Developer settings > Personal access tokens. Minimum scopes: read:user (plus models scope if available / Copilot enabled). Then edit this model and add the token.';
    }

    const url = `https://api.github.com/models/${model.model}/responses`;

    // Transform messages to GitHub Responses API input shape
    const input = messages.map(m => ({
      role: m.role,
      content: [ { type: 'text', text: m.content } ]
    }));

    const body = {
      model: model.model,
      input,
      temperature: options?.temperature ?? model.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? model.maxTokens ?? 1024 // GitHub may enforce internal caps
    };

  const response = await fetch(url, {
      method: 'POST',
      headers: {
    'Authorization': `Bearer ${model.apiKey}`,
    'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify(body)
    });

    if (response.status === 401 || response.status === 403) {
      return `GitHub Models authorization failed (${response.status}). Ensure your PAT has Copilot/models access and that your account has an active Copilot subscription. Model: ${model.model}`;
    }

    if (!response.ok) {
      const errTxt = await response.text();
      const snippet = errTxt.slice(0, 400).replace(/\s+/g, ' ').trim();
      console.error('[GitHub Models] call failed', { status: response.status, statusText: response.statusText, model: model.model, snippet });
      if (response.status === 404) {
        throw new Error(`GitHub Models 404 Not Found for '${model.model}'. The model name may be incorrect, not enabled for your account, or requires a different identifier. Body: ${snippet}`);
      }
      throw new Error(`GitHub Models error ${response.status}: ${snippet}`);
    }

    const data: any = await response.json();
    // Attempt to extract text from multiple possible shapes (preview schemas can evolve)
    let text = '';
    if (data?.output?.length) {
      // Newer shape: output is array of message objects
      const first = data.output[0];
      if (first?.content?.length) {
        text = first.content.map((c: any) => c.text).filter(Boolean).join('\n');
      }
    }
    if (!text && Array.isArray(data?.choices)) {
      text = data.choices[0]?.message?.content || data.choices[0]?.text || '';
    }
    if (!text && typeof data === 'object') {
      // Fallback search
      text = JSON.stringify(data);
    }
    return text || '';
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

  private async callMistral(model: ExternalModel, messages: any[], options?: any): Promise<string> {
    // Mistral chat completion (OpenAI-like but different endpoint path)
    const baseURL = 'https://api.mistral.ai/v1';
    const body = {
      model: model.model,
      messages,
      temperature: options?.temperature ?? model.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? model.maxTokens ?? 4096,
      stream: false
    };
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${model.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Mistral API error: ${response.status} - ${error}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }

  private resolveEnvVarForProvider(provider: ExternalModel['provider']): string | undefined {
    switch (provider) {
      case 'openai': return 'OPENAI_API_KEY';
      case 'anthropic': return 'ANTHROPIC_API_KEY';
      case 'github-copilot': return 'GITHUB_TOKEN';
      case 'google': return 'GOOGLE_API_KEY';
      case 'cohere': return 'COHERE_API_KEY';
      case 'mistral': return 'MISTRAL_API_KEY';
      case 'custom': return 'CUSTOM_API_KEY';
      default: return undefined;
    }
  }
}
