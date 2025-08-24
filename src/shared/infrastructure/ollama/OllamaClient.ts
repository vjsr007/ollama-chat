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
  simulationDetected?: boolean;
  simulationIndicators?: string[];
}

export class OllamaClient {
  private baseUrl: string;
  private toolSupportCache: Map<string, boolean> = new Map();
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

      // ----------- Embedded / Hallucinated Tool Call Recovery Layer -----------
      // Some models (e.g. Qwen via Ollama) will return textual descriptions of tool calls
      // or even paste JSON arrays in plain text without using the tool_calls field.
      // 1) Try to extract any JSON tool call blocks.
      // 2) If none, detect linguistic claims of completed actions (Spanish & English)
      //    and force a retry with a strict system message OR synthesize minimal tool calls.

      const extractEmbeddedToolCalls = (raw: string): any[] | null => {
        try {
          // Look for fenced ```json blocks first
          const fenceMatch = raw.match(/```json[\r\n]+([\s\S]*?)```/i);
          const candidates: string[] = [];
          if (fenceMatch) candidates.push(fenceMatch[1]);
          // Generic array pattern [ { "name": "tool" ... } ]
            // Use non-greedy up to last closing bracket
          const arrayMatch = raw.match(/(\[\s*\{[\s\S]+?\}\s*\])/);
          if (arrayMatch) candidates.push(arrayMatch[1]);
          for (const c of candidates) {
            try {
              const cleaned = c
                .replace(/^[^\[]*\[/s, '[') // trim before first [
                .replace(/\][^\]]*$/s, ']'); // trim after last ]
              const parsed = JSON.parse(cleaned);
              if (Array.isArray(parsed) && parsed.every(p => typeof p === 'object')) {
                const mapped = parsed
                  .filter(p => p && (p.name || p.function?.name))
                  .map((p, i) => {
                    const name = p.name || p.function?.name;
                    const args = p.arguments || p.function?.arguments || p.function?.args || {};
                    return {
                      id: 'embedded_' + i + '_' + name,
                      type: 'function',
                      function: { name, arguments: args }
                    };
                  });
                if (mapped.length) return mapped;
              }
            } catch (e) {
              continue;
            }
          }
        } catch (e) {
          /* ignore */
        }
        return null;
      };

      const hallucinationPatterns: RegExp[] = [
        /se (ha )?cread[oa]/i,
        /carpeta[s]? (ha[n]? )?sido creada/i,
        /archivo[s]? (ha[n]? )?sido (cread|guardad|generad)/i,
        /he creado/i,
        /he guardado/i,
        /se (ha )?realizado una b[úu]squeda/i,
        /todos los pasos han sido completados/i,
        /directory (created|exported)/i,
        /file (created|written|saved)/i
      ];

      const looksLikeHallucinatedActions = () => hallucinationPatterns.some(r => r.test(content));
      let simulationIndicators: string[] = [];
      if (!data.message?.tool_calls) {
        simulationIndicators = hallucinationPatterns.filter(r=>r.test(content)).map(r=>r.toString());
      }
      if (!data.message?.tool_calls && supportsTools && selectedTools.length > 0) {
        const embedded = extractEmbeddedToolCalls(content);
        if (embedded && embedded.length) {
          // Filter only embedded tools that exist in selectedTools set (avoid executing unknown / unsafe)
          const allowedNames = new Set(selectedTools.map(t => t.name));
          const filtered = embedded.filter(e => allowedNames.has(e.function.name));
          if (filtered.length) {
            console.log('🛠️ Recovered embedded tool calls from text response:', filtered.map(f => f.function.name).join(', '));
            return { needsToolExecution: true, toolCalls: filtered, content: '' };
          } else {
            console.log('🛠️ Embedded tool JSON detected but no names matched allowed tools. Ignoring.');
          }
        }

        if (looksLikeHallucinatedActions()) {
            // Fall through to mark simulation
          // Avoid infinite loops
          if (!(req as any).__hallucinationRetryPerformed) {
            console.log('⚠️ Detected textual claims of completed actions without tool_calls. Forcing retry.');
            const strictMsg = 'HALLUCINATION_DETECTED: La respuesta anterior describi3 acciones (crear carpeta / escribir archivo / b9fsqueda) sin devolver tool_calls reales. Debes devolver exclusivamente JSON tool_calls reales sin narrativa si aplica. Usa solo uno o m21s de: ' + selectedTools.map(t => t.name).join(', ') + '. No afirmes completar acciones antes de ejecutarlas.';
            const retryReq: ChatRequest = {
              ...req,
              messages: [
                ...req.messages,
                { role: 'system', content: strictMsg }
              ]
            } as any;
            (retryReq as any).__hallucinationRetryPerformed = true;
            return await this.generate(retryReq, tools);
          } else if (!(req as any).__hallucinationSyntheticUsed) {
            console.log('⚠️ Hallucination retry already performed. Attempting synthetic tool inference.');
            // Simple inference: pick most plausible tool by keywords
            const lc = content.toLowerCase();
            const pick = (names: RegExp[]) => selectedTools.find(t => names.some(r => r.test(t.name)));
            let chosen = pick([/export.*directory/i, /system_export_directory_listing/i]);
            if (!chosen && /carpeta|directorio|folder|directory/.test(lc)) {
              chosen = pick([/create.*directory/i, /system_create_directory/i]);
            }
            if (!chosen && /archivo|file|txt/.test(lc)) {
              chosen = pick([/write.*file/i, /system_write_file/i]);
            }
            if (!chosen && selectedTools.length) chosen = selectedTools[0];
            if (chosen) {
              console.log('🧪 Synthesizing tool call due to persistent hallucination:', chosen.name);
              (req as any).__hallucinationSyntheticUsed = true;
              return {
                needsToolExecution: true,
                toolCalls: [
                  {
                    id: 'hallucination_synth_' + chosen.name,
                    type: 'function',
                    function: { name: chosen.name, arguments: {} }
                  }
                ],
                content: ''
              };
            }
          }
        }
      }
      // ----------- End Recovery Layer -----------

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

      // Optional synthetic fallback: if model still refuses tool calls but heuristics say it should; gated by env var
      if (
        process.env.OLLAMA_FORCE_TOOL_FALLBACK?.toLowerCase() === 'true' &&
        !data.message?.tool_calls && supportsTools && userWantsExternalAction && selectedTools.length > 0 &&
        !(req as any).__syntheticToolFallbackUsed
      ) {
        console.log('🧪 Applying synthetic tool fallback (OLLAMA_FORCE_TOOL_FALLBACK enabled).');
        const lower = lastUserText;
        // Simple intent heuristics
        const wantsListDir = /(listar|list)\s+.*(carpetas|carpeta|folders?|directory|directorio|dir)/.test(lower);
        const wantsReadFile = /(leer|read)\s+.*(archivo|file)/.test(lower);
        let chosen: McpTool | undefined;
        if (wantsListDir) {
          chosen = selectedTools.find(t => /list.*dir|directory_list|system_list_directory/i.test(t.name)) || selectedTools.find(t => /list/i.test(t.name));
        }
        if (!chosen && wantsReadFile) {
          chosen = selectedTools.find(t => /read.*file|system_read_file/i.test(t.name)) || selectedTools.find(t => /read/i.test(t.name));
        }
        if (!chosen) {
          // Fall back to highest scored tool if we have scores
          if (scoredList && scoredList.length) {
            const sorted = [...scoredList].sort((a, b) => b.score - a.score);
            chosen = sorted[0]?.tool;
          } else {
            chosen = selectedTools[0];
          }
        }
        if (chosen) {
          console.log(`🧪 Synthetic tool call created for: ${chosen.name}`);
          (req as any).__syntheticToolFallbackUsed = true;
          // Build minimal arguments object based on schema defaults
            // We attempt to populate with harmless placeholders
          const argSchema: any = chosen.schema || {};
          const args: Record<string, any> = {};
          Object.keys(argSchema).forEach(k => {
            if (argSchema[k]?.type === 'string') args[k] = argSchema[k].default || '';
            else if (argSchema[k]?.type === 'number') args[k] = argSchema[k].default || 0;
            else if (argSchema[k]?.type === 'boolean') args[k] = argSchema[k].default ?? false;
          });
          // Specific overrides for common tools
          if (/list.*dir|directory_list|system_list_directory/i.test(chosen.name) && args['path'] !== undefined) {
            args['path'] = args['path'] || '.';
          }
          return {
            needsToolExecution: true,
            toolCalls: [
              {
                id: 'synthetic_fallback_' + chosen.name,
                type: 'function',
                function: {
                  name: chosen.name,
                  arguments: args
                }
              }
            ],
            content: ''
          };
        } else {
          console.log('🧪 Synthetic fallback enabled but no suitable tool found.');
        }
      }
  const baseReturn: OllamaResponse = { needsToolExecution: false, content };
      if (simulationIndicators.length && !baseReturn.needsToolExecution) {
        baseReturn.simulationDetected = true;
        baseReturn.simulationIndicators = simulationIndicators;
        console.log('⚠️ Simulation detected (narrative action claims) without tool_calls. Indicators:', simulationIndicators.join(', '));
      }
      return baseReturn;
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
    // 1. Environment override to force disable
    if (process.env.OLLAMA_FORCE_DISABLE_TOOLS?.toLowerCase() === 'true') {
      console.log(`🔍 Tool support forced OFF via OLLAMA_FORCE_DISABLE_TOOLS for ${modelName}`);
      return false;
    }

    // 2. Cached result
    if (this.toolSupportCache.has(modelName)) {
      return this.toolSupportCache.get(modelName)!;
    }

    const lower = modelName.toLowerCase();

    // 3. Strict list mode (legacy behavior) if env var set
    if (process.env.OLLAMA_STRICT_MODEL_LIST?.toLowerCase() === 'true') {
      const strictList = ['llama3.1', 'qwen2.5', 'mistral-nemo', 'mistral-large'];
      const matches = strictList.some(s => lower.includes(s));
      this.toolSupportCache.set(modelName, matches);
      console.log(`🔍 Strict list tool support for ${modelName}: ${matches}`);
      return matches;
    }

    // 4. Dynamic detection via /api/show (best-effort). If it fails, we are optimistic.
    try {
      console.log(`🔍 Fetching /api/show for dynamic tool capability detection: ${modelName}`);
      const { data } = await axios.post(`${this.baseUrl}/api/show`, { name: modelName }, { timeout: 10000 });
      // Heuristics: look for substrings in modelfile / parameters that hint tool or function calling
      const haystack = JSON.stringify(data || {}).toLowerCase();
      const indicative = ['tool_call', 'tool-call', 'function_call', 'function-call', 'tool_usage', 'mcp', 'tools'].some(k => haystack.includes(k));
      // Some models may not expose explicit markers; we stay optimistic unless we find evidence it's a pure embedding model
      const obviousNo = /embedding/.test(haystack) && !indicative;
      const supports = indicative ? true : !obviousNo; // optimistic
      this.toolSupportCache.set(modelName, supports);
      console.log(`🔍 Dynamic detection result for ${modelName}: indicative=${indicative} obviousNo=${obviousNo} => supports=${supports}`);
      return supports;
    } catch (err) {
      console.warn(`⚠️ /api/show failed for ${modelName}; assuming tools supported (optimistic). Error:`, (err as any)?.message || err);
      this.toolSupportCache.set(modelName, true);
      return true;
    }
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
