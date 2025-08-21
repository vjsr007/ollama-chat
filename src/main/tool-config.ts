import * as fs from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';

interface ToolConfig {
  [toolName: string]: {
    enabled: boolean;
    lastModified: number;
  };
}

interface ModelToolLimits {
  [modelName: string]: number;
}

interface ToolSettings {
  tools: ToolConfig;
  modelLimits: ModelToolLimits;
  lastUpdated: number;
}

class ToolConfigManager {
  private configPath: string;
  private config: ToolSettings;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.configPath = path.join(userDataPath, 'tool-config.json');
    this.config = {
      tools: {},
      modelLimits: {
        'qwen2.5:latest': 25,
        'llama3.1:8b': 20,
        'mistral:7b': 15,
        'phi3:mini': 10,
        'gemma2:2b': 8,
        'default': 25
      },
      lastUpdated: Date.now()
    };
  }

  async loadConfig(): Promise<void> {
    try {
      const data = await fs.readFile(this.configPath, 'utf-8');
      this.config = { ...this.config, ...JSON.parse(data) };
      console.log('📁 Tool configuration loaded from:', this.configPath);
    } catch (error) {
      console.log('📝 Creating new tool configuration file');
      await this.saveConfig();
    }
  }

  async saveConfig(): Promise<void> {
    try {
      this.config.lastUpdated = Date.now();
      await fs.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
      console.log('💾 Tool configuration saved');
    } catch (error) {
      console.error('❌ Error saving tool configuration:', error);
    }
  }

  isToolEnabled(toolName: string): boolean {
    return this.config.tools[toolName]?.enabled ?? true; // Default to enabled
  }

  async setToolEnabled(toolName: string, enabled: boolean): Promise<void> {
    if (!this.config.tools[toolName]) {
      this.config.tools[toolName] = {
        enabled: enabled,
        lastModified: Date.now()
      };
    } else {
      this.config.tools[toolName].enabled = enabled;
      this.config.tools[toolName].lastModified = Date.now();
    }
    
    await this.saveConfig();
    console.log(`🔧 Tool ${toolName} ${enabled ? 'enabled' : 'disabled'}`);
  }

  getToolConfig(): ToolConfig {
    return { ...this.config.tools };
  }

  getModelLimit(modelName: string): number {
    return this.config.modelLimits[modelName] || this.config.modelLimits['default'] || 25;
  }

  async setModelLimit(modelName: string, limit: number): Promise<void> {
    this.config.modelLimits[modelName] = limit;
    await this.saveConfig();
    console.log(`📊 Model ${modelName} limit set to ${limit} tools`);
  }

  getModelLimits(): ModelToolLimits {
    return { ...this.config.modelLimits };
  }

  // Obtener herramientas habilitadas para un modelo específico
  getEnabledToolsForModel(modelName: string, availableTools: string[]): string[] {
    const limit = this.getModelLimit(modelName);
    const enabledTools = availableTools.filter(toolName => this.isToolEnabled(toolName));
    
    // Si excede el límite, tomar solo las primeras herramientas habilitadas
    if (enabledTools.length > limit) {
      console.log(`⚠️ Model ${modelName} has ${enabledTools.length} enabled tools, limiting to ${limit}`);
      return enabledTools.slice(0, limit);
    }
    
    return enabledTools;
  }

  // Métodos de utilidad para stats
  getToolStats(): { total: number; enabled: number; disabled: number } {
    const tools = Object.values(this.config.tools);
    const enabled = tools.filter(tool => tool.enabled).length;
    const disabled = tools.filter(tool => !tool.enabled).length;
    
    return {
      total: tools.length,
      enabled,
      disabled
    };
  }

  // Exportar/Importar configuración
  async exportConfig(): Promise<string> {
    return JSON.stringify(this.config, null, 2);
  }

  async importConfig(configJson: string): Promise<void> {
    try {
      const importedConfig = JSON.parse(configJson);
      this.config = { ...this.config, ...importedConfig };
      await this.saveConfig();
      console.log('📥 Configuration imported successfully');
    } catch (error) {
      console.error('❌ Error importing configuration:', error);
      throw new Error('Invalid configuration format');
    }
  }

  // Reset a configuración por defecto
  async resetToDefaults(): Promise<void> {
    this.config = {
      tools: {},
      modelLimits: {
        'qwen2.5:latest': 25,
        'llama3.1:8b': 20,
        'mistral:7b': 15,
        'phi3:mini': 10,
        'gemma2:2b': 8,
        'default': 25
      },
      lastUpdated: Date.now()
    };
    await this.saveConfig();
    console.log('🔄 Tool configuration reset to defaults');
  }
}

export default ToolConfigManager;
