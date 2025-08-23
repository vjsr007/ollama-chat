import axios from 'axios';
// @ts-ignore - fuse.js may not have bundled types in some versions; we use its default export
import Fuse from 'fuse.js'; // legacy local scoring kept for fallback; will be replaced progressively
import fs from 'fs/promises';
import path from 'path';
import { ChatRequest, ChatMessage } from '../../domain/chat';
import type { McpTool } from '../../domain/mcp';
import { ToolRelevanceEngine } from '../model/ToolRelevanceEngine';

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

    // Helper: detect if tool usage likely needed from last user message
    const lastUserMsg = [...req.messages].reverse().find(m => m.role === 'user');
    const lastUserText = lastUserMsg?.content?.toLowerCase() || '';
    const toolTriggerKeywords = [
      'list', 'listar', 'lista', 'carpeta', 'carpetas', 'read', 'leer', 'file', 'archivo', 'dir', 'directory', 'directorio',
      'process', 'proceso', 'kill', 'start', 'execute', 'exec', 'command', 'comando', 'service', 'servicio', 'network', 'netstat',
      'port', 'puerto', 'system', 'sistema', 'crear', 'crea', 'export', 'exportar', 'txt', 'buscar', 'search', 'google', 'navegar',
      'browser', 'web', 'screenshot', 'captura', 'capturar', 'imagen', 'playwright', 'puppeteer', 'automation', 'abrir url', 'open url', 'download', 'descargar'
    ];
    const userWantsExternalAction = toolTriggerKeywords.some(k => lastUserText.includes(k));

    // Pattern: "crea un txt en C:\rutaSalida con la lista de carpetas en D:\rutaOrigen"
    // We interpret this as an instruction to export a directory listing to a file.
    let directExportToolCall: any | null = null;
    try {
      const exportRegex = /crea\s+un\s+txt\s+en\s+([a-z]:\\[^\s]+)\s+con\s+la\s+lista\s+de\s+carpetas\s+en\s+([a-z]:\\[^\s]+)/i;
      const match = lastUserText.match(exportRegex);
      if (match) {
        let outputBase = match[1].replace(/"/g, '').trim();
        let dirPath = match[2].replace(/"/g, '').trim();
        // If outputBase appears to be a directory (no .txt extension), append default filename
        if (!/\.txt$/i.test(outputBase)) {
          if (!/[\\/]$/.test(outputBase)) outputBase += '\\';
          outputBase += 'folders_list.txt';
        }
        // Normalize slashes to backslashes for Windows environment
        outputBase = outputBase.replace(/\//g, '\\');
        dirPath = dirPath.replace(/\//g, '\\');
        directExportToolCall = {
          needsToolExecution: true,
          toolCalls: [
            {
              id: 'auto_system_export_directory_listing',
              type: 'function',
              function: {
                name: 'system_export_directory_listing',
                arguments: {
                  dir_path: dirPath,
                  output_path: outputBase,
                  quiet: true
                }
              }
            }
          ],
          content: ''
        } as any;
        console.log('⚡ Detected direct export instruction. Auto-generating tool call:', JSON.stringify(directExportToolCall.toolCalls[0].function.arguments));
      }
    } catch (e) {
      console.warn('⚠️ Error parsing export pattern:', e);
    }

    if (directExportToolCall) {
      return directExportToolCall; // Skip model call; we can satisfy user directly
    }

    // Generic tool relevance engine (abstracted)
    const relevanceEngine = new ToolRelevanceEngine({
      triggerKeywords: toolTriggerKeywords,
      synonyms: [
        ['google', 'buscar', 'search', 'web', 'navegar', 'browser'],
        ['captura', 'screenshot', 'snapshot', 'imagen'],
        ['playwright', 'puppeteer', 'automation', 'automatizacion', 'automate', 'web'],
        ['archivo', 'file', 'fichero'],
        ['carpeta', 'folder', 'directory', 'directorio', 'dir'],
        ['proceso', 'process'],
        ['servicio', 'service'],
        ['puerto', 'port'],
        ['export', 'exportar', 'guardar', 'save'],
        ['kill', 'terminate', 'stop'],
        ['run', 'execute', 'exec', 'command', 'comando']
      ],
      domainBoosts: [
        { pattern: /(playwright|puppeteer|browser|navigate)/, userPattern: /google|search|navegar|browser/, boost: 5 },
        { pattern: /screenshot|capture|captura/, userPattern: /screenshot|captura|imagen/, boost: 4 },
        { pattern: /system|process|service|port|network/, userPattern: /process|service|port|network/, boost: 3 },
        { pattern: /file|directory|read|write|export|save/, userPattern: /file|directory|export|guardar|save|txt/, boost: 3 }
      ]
    });

    // Dynamic system prompt insertion with tool guide
    let systemInjected = false;
    const existingSystem = req.messages.find(m => m.role === 'system');
    let dynamicSystemPrompt = '';

    // Prepare tool selection (filtered & summarized) only if model supports tools later
    let selectedTools: McpTool[] = tools || [];
    const maxToolsByModel = this.getMaxToolsForModel(req.model);
    let relevanceApplied = false;
    let scoredList: { tool: McpTool; score: number }[] = [];
    if (tools && tools.length) {
      // Rank by relevance first
      scoredList = relevanceEngine.score(lastUserText, tools).map(s => ({ tool: s.tool, score: s.score }));
      const withScores = scoredList.map(s => ({ t: s.tool, s: s.score }));
      withScores.sort((a, b) => b.s - a.s);
      const anyScorePositive = withScores.some(w => w.s > 0);
      if (anyScorePositive) {
        selectedTools = withScores.filter(w => w.s > 0).map(w => w.t);
        relevanceApplied = true;
      }
      // Truncate to model limit
      if (selectedTools.length > maxToolsByModel) {
        selectedTools = selectedTools.slice(0, maxToolsByModel);
      }
    }

    // Build tool summary lines (short descriptions)
    const summarize = (tool: McpTool) => {
      const d = (tool.description || '').replace(/\s+/g, ' ').trim();
      return `${tool.name}: ${d.slice(0, 110)}${d.length > 110 ? '…' : ''}`;
    };

    if (!existingSystem && selectedTools.length) {
      dynamicSystemPrompt = [
        'You are an AI assistant with executable tool functions (filesystem, process, web automation, networking). ',
        'If the user request involves: web search / google / browser navigation / screenshot / captura / saving files / listar archivos / listar carpetas / ejecutar comandos / processes / network ports, you MUST return a tool call instead of a plain answer. ',
        'For web browsing (google, buscar, search) you must select a web automation tool (Playwright or Puppeteer) to open the page, capture a screenshot (PNG) and optionally extract text, then summarize the results. ',
        'For instructions to save output (crear txt, exportar, guardar en C:\\...) call the filesystem export tool providing the exact destination path. ',
        'If multiple tools could help, choose ONLY the most relevant first. Ask for clarification ONLY if parameters are ambiguous. ',
        'NEVER fabricate data that would come from the web or filesystem—always call the tool. ',
        'Respond with natural language ONLY when no tool access is required. ',
        'Available tools (name: purpose):\n',
        selectedTools.map(summarize).join('\n'),
        '\nWhen user says things like "buscar en google", "navegar", "screenshot", "captura", respond with a tool call (Playwright or Puppeteer / web automation) not a textual guess.'
      ].join('');
      systemInjected = true;
    } else if (existingSystem && selectedTools.length) {
      // Add a secondary system message (lighter) guiding tool usage
      dynamicSystemPrompt = [
        '[TOOL-GUIDE] Tool usage policy: prefer tool calls for external/system actions. Available subset: ',
        selectedTools.map(t => t.name).join(', ')
      ].join('');
    }

    // Map messages (prepend dynamic system prompt if created)
    const baseMessages: ChatMessage[] = systemInjected
      ? ([{ role: 'system', content: dynamicSystemPrompt } as ChatMessage, ...req.messages])
      : existingSystem
        ? ([...req.messages, { role: 'system', content: dynamicSystemPrompt } as ChatMessage].filter(m => m.content) as ChatMessage[])
        : req.messages;

    const messages = await Promise.all(baseMessages.map(m => this.mapMessage(m)));
    console.log(`� Messages converted successfully (systemInjected=${systemInjected}, dynamicGuide=${!!dynamicSystemPrompt})`);

    console.log('🧠 Tool relevance applied:', relevanceApplied, '| Selected tools:', selectedTools.map(t => t.name).join(', ') || 'none');
    if (relevanceApplied) {
      (scoredList || []).forEach((s: any) => {
        if (selectedTools.find(t => t.name === s.tool.name)) {
          console.log(`🔎 Relevance reason ${s.tool.name}: score=${s.score}`);
        }
      });
    }
    if (userWantsExternalAction) console.log('🧭 Heuristic: user likely expects external/system action');

    const payload: any = {
      model: req.model,
      messages,
      stream: false
    };

    // Check if model supports tools and add them if available
    const supportsTools = await this.modelSupportsTools(req.model);
    console.log(`🎯 Model ${req.model} supports tools: ${supportsTools}`);

    if (selectedTools && selectedTools.length > 0 && supportsTools) {
      console.log(`🔧 Tools available: ${tools?.length || 0}, selected after relevance & limits: ${selectedTools.length} (model max: ${maxToolsByModel})`);
      payload.tools = selectedTools.map(tool => {
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

      let content = data.message?.content ?? '';
      console.log('� Returning text response, content length:', content.length);

      // If completely empty content and user likely wanted external action, attempt a forced retry
      if (!content.trim() && supportsTools && userWantsExternalAction && selectedTools.length > 0) {
        if ((req as any).__emptyRetryPerformed) {
          console.log('⚠️ Empty response after retry; returning synthetic guidance.');
          content = 'El modelo devolvió una respuesta vacía. Intenta de nuevo o especifica más detalle. Puedes volver a pedir: "exporta el listado del directorio usando system_export_directory_listing".';
        } else {
          console.log('♻️ Empty response detected. Performing forced retry with stronger system message.');
          const retryReq: ChatRequest = {
            ...req,
            messages: [
              ...req.messages,
              { role: 'system', content: 'FORCE_TOOL_DECISION_EMPTY: La respuesta anterior estuvo vacía. Debes llamar a uno de los tools disponibles (' + selectedTools.map(t => t.name).join(', ') + ') si aplica.' }
            ]
          } as any;
          (retryReq as any).__emptyRetryPerformed = true;
          return await this.generate(retryReq, tools);
        }
      }

      // Heuristic retry: user likely wanted external action but model ignored tools
      if (!data.message?.tool_calls && supportsTools && userWantsExternalAction && selectedTools.length > 0 && !content.toLowerCase().includes('tool')) {
        if ((req as any).__toolRetryPerformed) {
          console.log('♻️ Heuristic retry already performed, not attempting again.');
        } else {
          console.log('⚠️ No tool calls returned; performing one heuristic retry with stronger system instruction.');
          const strongerReq: ChatRequest = {
            ...req,
            messages: [
              ...req.messages,
              { role: 'system', content: 'FORCE_TOOL_DECISION: The previous response omitted tool usage. You MUST select and call the most relevant tool from: ' + selectedTools.map(t => t.name).join(', ') + '. Respond ONLY with a tool call if any tool is applicable.' }
            ]
          } as any;
          (strongerReq as any).__toolRetryPerformed = true;
          return await this.generate(strongerReq, tools); // recursive single retry
        }
      }
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
