import React, { useState, useEffect } from 'react';
import './ToolManager.css';

interface Tool {
  name: string;
  description: string;
  server: string;
  category: string;
  enabled: boolean;
}

interface ToolManagerProps {
  isOpen: boolean;
  onClose: () => void;
  currentModel: string;
}

// Extender el tipo Window para incluir electronAPI
declare global {
  interface Window {
    electronAPI: {
      getAvailableTools: () => Promise<{ success: boolean; tools: Tool[] }>;
      updateToolStatus: (toolName: string, enabled: boolean) => Promise<void>;
      getModelLimits: () => Promise<{ success: boolean; limits: { [key: string]: number } }>;
      setModelLimit: (modelName: string, limit: number) => Promise<{ success: boolean }>;
      getEnabledToolsForModel: (modelName: string) => Promise<{ success: boolean; tools: string[] }>;
    };
  }
}

const ToolManager: React.FC<ToolManagerProps> = ({ isOpen, onClose, currentModel }) => {
  const [tools, setTools] = useState<Tool[]>([]);
  const [filteredTools, setFilteredTools] = useState<Tool[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [modelLimits, setModelLimits] = useState<{ [key: string]: number }>({});
  const [currentLimit, setCurrentLimit] = useState(25);

  // Límites por defecto para diferentes modelos
  const defaultLimits: { [key: string]: number } = {
    'qwen2.5:latest': 25,
    'llama3.1:8b': 20,
    'mistral:7b': 15,
    'phi3:mini': 10,
    'gemma2:2b': 8,
    'default': 25
  };

  useEffect(() => {
    if (isOpen) {
      loadTools();
      loadModelLimits();
      // Recargar los límites cada vez que cambie el modelo
      if (currentModel) {
        loadCurrentModelLimit();
      }
    }
  }, [isOpen, currentModel]);

  useEffect(() => {
    filterTools();
  }, [tools, searchTerm, selectedCategory]);

  const loadTools = async () => {
    try {
      const response = await window.electronAPI.getAvailableTools();
      if (response.success) {
        setTools(response.tools);
      }
    } catch (error) {
      console.error('Error loading tools:', error);
    }
  };

  const loadModelLimits = async () => {
    try {
      const response = await window.electronAPI.getModelLimits();
      if (response.success) {
        const limits = response.limits;
        setModelLimits(limits);
        setCurrentLimit(limits[currentModel] || limits['default'] || 25);
      }
    } catch (error) {
      console.error('Error loading model limits:', error);
      // Fallback to local storage
      const savedLimits = localStorage.getItem('modelToolLimits');
      if (savedLimits) {
        const limits = JSON.parse(savedLimits);
        setModelLimits(limits);
        setCurrentLimit(limits[currentModel] || defaultLimits[currentModel] || defaultLimits.default);
      } else {
        setModelLimits(defaultLimits);
        setCurrentLimit(defaultLimits[currentModel] || defaultLimits.default);
      }
    }
  };

  const loadCurrentModelLimit = async () => {
    try {
      const response = await window.electronAPI.getModelLimits();
      if (response.success) {
        const limits = response.limits;
        setCurrentLimit(limits[currentModel] || limits['default'] || 25);
      }
    } catch (error) {
      console.error('Error loading current model limit:', error);
    }
  };

  const saveModelLimits = async (limits: { [key: string]: number }) => {
    // Guardar en backend
    try {
      await window.electronAPI.setModelLimit(currentModel, limits[currentModel]);
      setModelLimits(limits);
    } catch (error) {
      console.error('Error saving model limits to backend:', error);
      // Fallback to localStorage
      localStorage.setItem('modelToolLimits', JSON.stringify(limits));
      setModelLimits(limits);
    }
  };

  const filterTools = () => {
    let filtered = tools;

    if (searchTerm) {
      filtered = filtered.filter(tool => 
        tool.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tool.description.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    if (selectedCategory !== 'all') {
      filtered = filtered.filter(tool => tool.category === selectedCategory);
    }

    setFilteredTools(filtered);
  };

  const toggleTool = async (toolName: string) => {
    const updatedTools = tools.map(tool => 
      tool.name === toolName ? { ...tool, enabled: !tool.enabled } : tool
    );
    
    setTools(updatedTools);
    
    // Guardar en el backend
    try {
      await window.electronAPI.updateToolStatus(toolName, !tools.find(t => t.name === toolName)?.enabled);
    } catch (error) {
      console.error('Error updating tool status:', error);
    }
  };

  const handleLimitChange = (newLimit: number) => {
    const newLimits = { ...modelLimits, [currentModel]: newLimit };
    saveModelLimits(newLimits);
    setCurrentLimit(newLimit);
  };

  const enableAllTools = async () => {
    const updatedTools = tools.map(tool => ({ ...tool, enabled: true }));
    setTools(updatedTools);
    
    // Guardar cada cambio en el backend
    try {
      await Promise.all(
        updatedTools.map(tool => window.electronAPI.updateToolStatus(tool.name, true))
      );
    } catch (error) {
      console.error('Error enabling all tools:', error);
    }
  };

  const disableAllTools = async () => {
    const updatedTools = tools.map(tool => ({ ...tool, enabled: false }));
    setTools(updatedTools);
    
    // Guardar cada cambio en el backend
    try {
      await Promise.all(
        updatedTools.map(tool => window.electronAPI.updateToolStatus(tool.name, false))
      );
    } catch (error) {
      console.error('Error disabling all tools:', error);
    }
  };

  const enableByCategory = async (category: string) => {
    const updatedTools = tools.map(tool => 
      tool.category === category ? { ...tool, enabled: true } : tool
    );
    setTools(updatedTools);
    
    // Guardar cambios en el backend solo para herramientas de la categoría
    try {
      const categoryTools = updatedTools.filter(t => t.category === category);
      await Promise.all(
        categoryTools.map(tool => window.electronAPI.updateToolStatus(tool.name, true))
      );
    } catch (error) {
      console.error('Error enabling category tools:', error);
    }
  };

  const getCategories = () => {
    const categories = Array.from(new Set(tools.map(tool => tool.category)));
    return categories.sort();
  };

  const getEnabledToolsCount = () => tools.filter(tool => tool.enabled).length;

  const getCategoryStats = () => {
    const categories = getCategories();
    return categories.map(category => {
      const categoryTools = tools.filter(tool => tool.category === category);
      const enabledCount = categoryTools.filter(tool => tool.enabled).length;
      return {
        category,
        total: categoryTools.length,
        enabled: enabledCount
      };
    });
  };

  if (!isOpen) return null;

  return (
    <div className="tool-manager-overlay">
      <div className="tool-manager">
        <div className="tool-manager-header">
          <h2>🛠️ Tool Management</h2>
          <button className="close-button" onClick={onClose}>✕</button>
        </div>

        <div className="tool-manager-content">
          {/* Información del modelo y límites */}
          <div className="model-info">
            <div className="model-details">
              <h3>📊 Modelo: {currentModel}</h3>
              <div className="tool-count">
                <span className={`count ${getEnabledToolsCount() > currentLimit ? 'over-limit' : ''}`}>
                  {getEnabledToolsCount()} / {tools.length} tools enabled
                </span>
                {getEnabledToolsCount() > currentLimit && (
                  <span className="warning">⚠️ Exceeds limit of {currentLimit}</span>
                )}
              </div>
            </div>
            
            <div className="limit-control">
              <label htmlFor="limit-input">Limit for this model:</label>
              <input
                id="limit-input"
                type="number"
                min="1"
                max="100"
                value={currentLimit}
                onChange={(e) => handleLimitChange(Number(e.target.value))}
                className="limit-input"
                title="Maximum number of tools this model can use"
              />
            </div>
          </div>

          {/* Category statistics */}
          <div className="category-stats">
            <h4>📈 By Category:</h4>
            <div className="stats-grid">
              {getCategoryStats().map(stat => (
                <div key={stat.category} className="stat-item">
                  <span className="category-name">{stat.category}</span>
                  <span className="category-count">{stat.enabled}/{stat.total}</span>
                  <button 
                    className="enable-category-btn"
                    onClick={() => enableByCategory(stat.category)}
                    title={`Enable all tools in ${stat.category}`}
                  >
                    ✓
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Search and filter controls */}
          <div className="controls">
            <div className="search-control">
              <input
                type="text"
                placeholder="🔍 Search tools..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
                title="Search tools by name or description"
              />
            </div>

            <div className="filter-control">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="category-filter"
                title="Filter tools by category"
              >
                <option value="all">🏷️ All categories</option>
                {getCategories().map(category => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </div>

            <div className="bulk-actions">
              <button onClick={enableAllTools} className="enable-all-btn">
                ✅ Enable All
              </button>
              <button onClick={disableAllTools} className="disable-all-btn">
                ❌ Disable All
              </button>
            </div>
          </div>

          {/* Tools list */}
          <div className="tools-list">
            {filteredTools.map((tool, index) => (
              <div key={tool.name} className={`tool-item ${tool.enabled ? 'enabled' : 'disabled'}`}>
                <div className="tool-info">
                  <div className="tool-header">
                    <span className="tool-name">{tool.name}</span>
                    <span className="tool-server">({tool.server})</span>
                    <span className={`tool-category category-${tool.category}`}>
                      {tool.category}
                    </span>
                  </div>
                  <div className="tool-description">{tool.description}</div>
                </div>
                
                <div className="tool-controls">
                  <label className="tool-toggle" htmlFor={`tool-${tool.name}`}>
                    <input
                      id={`tool-${tool.name}`}
                      type="checkbox"
                      checked={tool.enabled}
                      onChange={() => toggleTool(tool.name)}
                      title={`${tool.enabled ? 'Disable' : 'Enable'} ${tool.name}`}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
              </div>
            ))}
          </div>

          {filteredTools.length === 0 && (
            <div className="no-tools">
              <p>🔍 No tools found with current filters</p>
            </div>
          )}
        </div>

        <div className="tool-manager-footer">
          <div className="footer-info">
            <span>💡 Tip: Disabled tools won't be available to the model</span>
          </div>
          <button onClick={onClose} className="close-footer-btn">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ToolManager;
