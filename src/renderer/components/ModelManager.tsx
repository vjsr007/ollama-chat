import React, { useState, useEffect } from 'react';
import './ModelManager.css';

interface ExternalModel {
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

interface ModelManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

const ModelManager: React.FC<ModelManagerProps> = ({ isOpen, onClose }) => {
  const [externalModels, setExternalModels] = useState<ExternalModel[]>([]);
  const [showAddModel, setShowAddModel] = useState(false);
  const [editingModel, setEditingModel] = useState<ExternalModel | null>(null);
  const [newModel, setNewModel] = useState<Partial<ExternalModel>>({
    provider: 'openai',
    enabled: true,
    temperature: 0.7,
    maxTokens: 4096
  });

  // Modelos predefinidos populares
  const predefinedModels = {
    'openai': [
      { model: 'gpt-4o', name: 'GPT-4o', description: 'Modelo más avanzado de OpenAI' },
      { model: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Versión optimizada de GPT-4o' },
      { model: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'GPT-4 con mayor ventana de contexto' },
      { model: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', description: 'Modelo rápido y eficiente' }
    ],
    'anthropic': [
      { model: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Modelo más potente de Anthropic' },
      { model: 'claude-3-opus-20240229', name: 'Claude 3 Opus', description: 'Modelo premium de Anthropic' },
      { model: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', description: 'Modelo rápido y económico' }
    ],
    'github-copilot': [
      { model: 'gpt-4o', name: 'GitHub Copilot GPT-4o', description: 'GPT-4o vía GitHub Copilot' },
      { model: 'gpt-4o-mini', name: 'GitHub Copilot GPT-4o Mini', description: 'GPT-4o Mini vía GitHub Copilot' },
      { model: 'claude-3.5-sonnet', name: 'GitHub Copilot Claude 3.5', description: 'Claude 3.5 vía GitHub Copilot' },
      { model: 'o1-preview', name: 'GitHub Copilot o1-preview', description: 'Modelo o1-preview vía GitHub Copilot' }
    ],
    'google': [
      { model: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: 'Modelo avanzado de Google' },
      { model: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Modelo rápido de Google' }
    ],
    'cohere': [
      { model: 'command-r-plus', name: 'Command R+', description: 'Modelo premium de Cohere' },
      { model: 'command-r', name: 'Command R', description: 'Modelo estándar de Cohere' }
    ]
  };

  useEffect(() => {
    if (isOpen) {
      loadExternalModels();
    }
  }, [isOpen]);

  const loadExternalModels = async () => {
    try {
      // Cargar modelos externos desde el backend
      const response = await (window as any).externalModels?.getAll();
      if (response && response.success) {
        setExternalModels(response.models);
      }
    } catch (error) {
      console.error('Error loading external models:', error);
    }
  };

  const saveExternalModels = (models: ExternalModel[]) => {
    // Los modelos se guardan automáticamente en el backend
    setExternalModels(models);
  };

  const addModel = async () => {
    if (!newModel.name || !newModel.model || !newModel.provider) {
      alert('Por favor completa todos los campos obligatorios');
      return;
    }

    try {
      const modelToAdd = {
        name: newModel.name!,
        provider: newModel.provider!,
        model: newModel.model!,
        apiKey: newModel.apiKey,
        endpoint: newModel.endpoint,
        enabled: newModel.enabled ?? true,
        description: newModel.description,
        maxTokens: newModel.maxTokens,
        temperature: newModel.temperature
      };

      const response = await (window as any).externalModels?.add(modelToAdd);
      if (response && response.success) {
        await loadExternalModels(); // Recargar la lista
        
        setNewModel({
          provider: 'openai',
          enabled: true,
          temperature: 0.7,
          maxTokens: 4096
        });
        setShowAddModel(false);
      } else {
        alert('Error agregando el modelo');
      }
    } catch (error) {
      console.error('Error adding model:', error);
      alert('Error agregando el modelo');
    }
  };

  const removeModel = async (id: string) => {
    try {
      const response = await (window as any).externalModels?.remove(id);
      if (response && response.success) {
        await loadExternalModels(); // Recargar la lista
      } else {
        alert('Error eliminando el modelo');
      }
    } catch (error) {
      console.error('Error removing model:', error);
      alert('Error eliminando el modelo');
    }
  };

  const toggleModel = async (id: string) => {
    try {
      const model = externalModels.find(m => m.id === id);
      if (!model) return;
      
      const response = await (window as any).externalModels?.toggle(id, !model.enabled);
      if (response && response.success) {
        await loadExternalModels(); // Recargar la lista
      } else {
        alert('Error cambiando estado del modelo');
      }
    } catch (error) {
      console.error('Error toggling model:', error);
      alert('Error cambiando estado del modelo');
    }
  };

  const startEditModel = (model: ExternalModel) => {
    setEditingModel(model);
    setNewModel({
      name: model.name,
      provider: model.provider,
      model: model.model,
      apiKey: model.apiKey,
      endpoint: model.endpoint,
      enabled: model.enabled,
      description: model.description,
      maxTokens: model.maxTokens,
      temperature: model.temperature
    });
    setShowAddModel(true);
  };

  const saveEditedModel = async () => {
    if (!editingModel || !newModel.name || !newModel.model || !newModel.provider) {
      alert('Por favor completa todos los campos obligatorios');
      return;
    }

    try {
      const modelToUpdate = {
        name: newModel.name!,
        provider: newModel.provider!,
        model: newModel.model!,
        apiKey: newModel.apiKey,
        endpoint: newModel.endpoint,
        enabled: newModel.enabled ?? true,
        description: newModel.description,
        maxTokens: newModel.maxTokens,
        temperature: newModel.temperature
      };

      const response = await (window as any).externalModels?.update(editingModel.id, modelToUpdate);
      if (response && response.success) {
        await loadExternalModels(); // Recargar la lista
        
        setNewModel({
          provider: 'openai',
          enabled: true,
          temperature: 0.7,
          maxTokens: 4096
        });
        setShowAddModel(false);
        setEditingModel(null);
      } else {
        alert('Error actualizando el modelo');
      }
    } catch (error) {
      console.error('Error updating model:', error);
      alert('Error actualizando el modelo');
    }
  };

  const cancelEdit = () => {
    setEditingModel(null);
    setNewModel({
      provider: 'openai',
      enabled: true,
      temperature: 0.7,
      maxTokens: 4096
    });
    setShowAddModel(false);
  };

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case 'openai': return '🤖';
      case 'anthropic': return '🧠';
      case 'github-copilot': return '🐙';
      case 'google': return '🔍';
      case 'cohere': return '⚡';
      default: return '🌐';
    }
  };

  const getProviderColor = (provider: string) => {
    switch (provider) {
      case 'openai': return '#10a37f';
      case 'anthropic': return '#d97706';
      case 'github-copilot': return '#6366f1';
      case 'google': return '#4285f4';
      case 'cohere': return '#8b5cf6';
      default: return '#6b7280';
    }
  };

  const addPredefinedModel = async (provider: string, modelInfo: any) => {
    try {
      const modelToAdd = {
        name: modelInfo.name,
        provider: provider as any,
        model: modelInfo.model,
        enabled: true,
        description: modelInfo.description,
        temperature: 0.7,
        maxTokens: 4096
      };

      const response = await (window as any).externalModels?.add(modelToAdd);
      if (response && response.success) {
        await loadExternalModels(); // Recargar la lista
      } else {
        alert('Error agregando el modelo predefinido');
      }
    } catch (error) {
      console.error('Error adding predefined model:', error);
      alert('Error agregando el modelo predefinido');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="model-manager-overlay">
      <div className="model-manager">
        <div className="model-manager-header">
          <h2>🌐 Gestión de Modelos Externos</h2>
          <button className="close-button" onClick={onClose}>✕</button>
        </div>

        <div className="model-manager-content">
          {/* Modelos configurados */}
          <div className="models-section">
            <div className="section-header">
              <h3>📋 Modelos Configurados</h3>
              <button 
                onClick={() => setShowAddModel(true)}
                className="add-model-btn"
              >
                ➕ Agregar Modelo
              </button>
            </div>

            {externalModels.length === 0 ? (
              <div className="no-models">
                <p>No hay modelos externos configurados</p>
                <p className="hint">Agrega modelos de OpenAI, Anthropic, GitHub Copilot y más</p>
              </div>
            ) : (
              <div className="models-list">
                {externalModels.map(model => (
                  <div key={model.id} className={`model-item ${model.enabled ? 'enabled' : 'disabled'}`}>
                    <div className="model-info">
                      <div className="model-header">
                        <span className="model-icon">{getProviderIcon(model.provider)}</span>
                        <span className="model-name">{model.name}</span>
                        <span 
                          className={`model-provider ${model.provider}`}
                        >
                          {model.provider}
                        </span>
                      </div>
                      <div className="model-details">
                        <span className="model-model">{model.model}</span>
                        {model.description && (
                          <span className="model-description">{model.description}</span>
                        )}
                      </div>
                      {model.apiKey && (
                        <div className="model-key">🔑 API Key configurada</div>
                      )}
                    </div>
                    
                    <div className="model-controls">
                      <button
                        onClick={() => toggleModel(model.id)}
                        className={`toggle-btn ${model.enabled ? 'enabled' : 'disabled'}`}
                        title={model.enabled ? 'Deshabilitar' : 'Habilitar'}
                      >
                        {model.enabled ? '👁️' : '🚫'}
                      </button>
                      <button
                        onClick={() => startEditModel(model)}
                        className="edit-btn"
                        title="Editar modelo"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => removeModel(model.id)}
                        className="remove-btn"
                        title="Eliminar modelo"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Modelos predefinidos */}
          <div className="predefined-section">
            <h3>⭐ Modelos Populares</h3>
            <div className="predefined-providers">
              {Object.entries(predefinedModels).map(([provider, models]) => (
                <div key={provider} className="provider-section">
                  <h4>
                    <span className="provider-icon">{getProviderIcon(provider)}</span>
                    {provider.charAt(0).toUpperCase() + provider.slice(1).replace('-', ' ')}
                  </h4>
                  <div className="predefined-models">
                    {models.map(modelInfo => (
                      <div key={modelInfo.model} className="predefined-model">
                        <div className="predefined-info">
                          <span className="predefined-name">{modelInfo.name}</span>
                          <span className="predefined-description">{modelInfo.description}</span>
                        </div>
                        <button
                          onClick={() => addPredefinedModel(provider, modelInfo)}
                          className="add-predefined-btn"
                          title="Agregar este modelo"
                        >
                          ➕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Formulario para agregar/editar modelo */}
          {showAddModel && (
            <div className="add-model-form">
              <h3>{editingModel ? '✏️ Editar Modelo' : '➕ Agregar Nuevo Modelo'}</h3>
              
              <div className="form-row">
                <div className="form-group">
                  <label>Proveedor</label>
                  <select
                    value={newModel.provider}
                    onChange={(e) => setNewModel(prev => ({ ...prev, provider: e.target.value as any }))}
                    title="Seleccionar proveedor del modelo"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="github-copilot">GitHub Copilot</option>
                    <option value="google">Google</option>
                    <option value="cohere">Cohere</option>
                  </select>
                </div>
                
                <div className="form-group">
                  <label>Nombre del modelo</label>
                  <input
                    type="text"
                    value={newModel.name || ''}
                    onChange={(e) => setNewModel(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Ej: GPT-4o"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>ID del modelo</label>
                  <input
                    type="text"
                    value={newModel.model || ''}
                    onChange={(e) => setNewModel(prev => ({ ...prev, model: e.target.value }))}
                    placeholder="Ej: gpt-4o"
                  />
                </div>
                
                <div className="form-group">
                  <label>API Key (opcional)</label>
                  <input
                    type="password"
                    value={newModel.apiKey || ''}
                    onChange={(e) => setNewModel(prev => ({ ...prev, apiKey: e.target.value }))}
                    placeholder="Tu API key"
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Descripción (opcional)</label>
                <input
                  type="text"
                  value={newModel.description || ''}
                  onChange={(e) => setNewModel(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Descripción del modelo"
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Temperatura</label>
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={newModel.temperature || 0.7}
                    onChange={(e) => setNewModel(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                    title="Configurar temperatura del modelo"
                    placeholder="0.7"
                  />
                </div>
                
                <div className="form-group">
                  <label>Max Tokens</label>
                  <input
                    type="number"
                    min="1"
                    max="128000"
                    value={newModel.maxTokens || 4096}
                    onChange={(e) => setNewModel(prev => ({ ...prev, maxTokens: parseInt(e.target.value) }))}
                    title="Configurar tokens máximos"
                    placeholder="4096"
                  />
                </div>
              </div>

              <div className="form-actions">
                <button 
                  onClick={editingModel ? saveEditedModel : addModel} 
                  className="save-btn"
                >
                  {editingModel ? '💾 Actualizar Modelo' : '💾 Guardar Modelo'}
                </button>
                <button onClick={editingModel ? cancelEdit : () => setShowAddModel(false)} className="cancel-btn">
                  ❌ Cancelar
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="model-manager-footer">
          <div className="footer-info">
            <span>💡 Los modelos externos requieren API keys válidas para funcionar</span>
          </div>
          <button onClick={onClose} className="close-footer-btn">
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModelManager;
