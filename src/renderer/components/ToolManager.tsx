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
    }
  }, [isOpen]);

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

  const loadModelLimits = () => {
    const savedLimits = localStorage.getItem('modelToolLimits');
    if (savedLimits) {
      const limits = JSON.parse(savedLimits);
      setModelLimits(limits);
      setCurrentLimit(limits[currentModel] || defaultLimits[currentModel] || defaultLimits.default);
    } else {
      setModelLimits(defaultLimits);
      setCurrentLimit(defaultLimits[currentModel] || defaultLimits.default);
    }
  };

  const saveModelLimits = (limits: { [key: string]: number }) => {
    localStorage.setItem('modelToolLimits', JSON.stringify(limits));
    setModelLimits(limits);
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

  const enableAllTools = () => {
    const updatedTools = tools.map(tool => ({ ...tool, enabled: true }));
    setTools(updatedTools);
    updatedTools.forEach(tool => {
      window.electronAPI.updateToolStatus(tool.name, true);
    });
  };

  const disableAllTools = () => {
    const updatedTools = tools.map(tool => ({ ...tool, enabled: false }));
    setTools(updatedTools);
    updatedTools.forEach(tool => {
      window.electronAPI.updateToolStatus(tool.name, false);
    });
  };

  const enableByCategory = (category: string) => {
    const updatedTools = tools.map(tool => 
      tool.category === category ? { ...tool, enabled: true } : tool
    );
    setTools(updatedTools);
    updatedTools.filter(t => t.category === category).forEach(tool => {
      window.electronAPI.updateToolStatus(tool.name, true);
    });
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
          <h2>🛠️ Gestión de Herramientas</h2>
          <button className="close-button" onClick={onClose}>✕</button>
        </div>

        <div className="tool-manager-content">
          {/* Información del modelo y límites */}
          <div className="model-info">
            <div className="model-details">
              <h3>📊 Modelo: {currentModel}</h3>
              <div className="tool-count">
                <span className={`count ${getEnabledToolsCount() > currentLimit ? 'over-limit' : ''}`}>
                  {getEnabledToolsCount()} / {tools.length} herramientas habilitadas
                </span>
                {getEnabledToolsCount() > currentLimit && (
                  <span className="warning">⚠️ Excede el límite de {currentLimit}</span>
                )}
              </div>
            </div>
            
            <div className="limit-control">
              <label htmlFor="limit-input">Límite para este modelo:</label>
              <input
                id="limit-input"
                type="number"
                min="1"
                max="100"
                value={currentLimit}
                onChange={(e) => handleLimitChange(Number(e.target.value))}
                className="limit-input"
                title="Número máximo de herramientas que puede usar este modelo"
              />
            </div>
          </div>

          {/* Estadísticas por categoría */}
          <div className="category-stats">
            <h4>📈 Por Categoría:</h4>
            <div className="stats-grid">
              {getCategoryStats().map(stat => (
                <div key={stat.category} className="stat-item">
                  <span className="category-name">{stat.category}</span>
                  <span className="category-count">{stat.enabled}/{stat.total}</span>
                  <button 
                    className="enable-category-btn"
                    onClick={() => enableByCategory(stat.category)}
                    title={`Habilitar todas las herramientas de ${stat.category}`}
                  >
                    ✓
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Controles de búsqueda y filtrado */}
          <div className="controls">
            <div className="search-control">
              <input
                type="text"
                placeholder="🔍 Buscar herramientas..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="search-input"
                title="Buscar herramientas por nombre o descripción"
              />
            </div>

            <div className="filter-control">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="category-filter"
                title="Filtrar herramientas por categoría"
              >
                <option value="all">🏷️ Todas las categorías</option>
                {getCategories().map(category => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </div>

            <div className="bulk-actions">
              <button onClick={enableAllTools} className="enable-all-btn">
                ✅ Habilitar Todas
              </button>
              <button onClick={disableAllTools} className="disable-all-btn">
                ❌ Deshabilitar Todas
              </button>
            </div>
          </div>

          {/* Lista de herramientas */}
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
                      title={`${tool.enabled ? 'Deshabilitar' : 'Habilitar'} ${tool.name}`}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                </div>
              </div>
            ))}
          </div>

          {filteredTools.length === 0 && (
            <div className="no-tools">
              <p>🔍 No se encontraron herramientas con los filtros actuales</p>
            </div>
          )}
        </div>

        <div className="tool-manager-footer">
          <div className="footer-info">
            <span>💡 Tip: Las herramientas deshabilitadas no estarán disponibles para el modelo</span>
          </div>
          <button onClick={onClose} className="close-footer-btn">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};

export default ToolManager;
