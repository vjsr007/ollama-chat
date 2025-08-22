import React, { useState, useEffect } from 'react';
import './ModelManager.css';

interface ExternalModel {
  id: string;
  name: string;
  provider: 'openai' | 'anthropic' | 'github-copilot' | 'google' | 'cohere' | 'mistral' | 'custom';
  model: string;
  apiKey?: string;
  endpoint?: string;
  enabled: boolean;
  description?: string;
  maxTokens?: number;
  temperature?: number;
  lastValidationStatus?: 'valid' | 'invalid' | 'error';
  lastValidationMessage?: string;
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

  // Popular predefined models
  const predefinedModels: Record<string, any[]> = {
    'openai': [
      { model: 'gpt-4o', name: 'GPT-4o', description: 'OpenAI\'s most advanced model' },
      { model: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Optimized version of GPT-4o' },
      { model: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: 'GPT-4 with larger context window' },
      { model: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', description: 'Fast and efficient model' }
    ],
    'anthropic': [
      { model: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Anthropic\'s most powerful model' },
      { model: 'claude-3-opus-20240229', name: 'Claude 3 Opus', description: 'Anthropic\'s premium model' },
      { model: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', description: 'Fast and economical model' }
    ],
    'github-copilot': [
      { model: 'gpt-4o', name: 'GitHub Copilot GPT-4o', description: 'GPT-4o via GitHub Copilot' },
      { model: 'gpt-4o-mini', name: 'GitHub Copilot GPT-4o Mini', description: 'GPT-4o Mini via GitHub Copilot' },
      { model: 'claude-3.5-sonnet', name: 'GitHub Copilot Claude 3.5', description: 'Claude 3.5 via GitHub Copilot' },
      { model: 'o1-preview', name: 'GitHub Copilot o1-preview', description: 'o1-preview model via GitHub Copilot' }
    ],
    'google': [
      { model: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: 'Google\'s advanced model' },
      { model: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', description: 'Google\'s fast model' }
    ],
    'cohere': [
      { model: 'command-r-plus', name: 'Command R+', description: 'Cohere\'s premium model' },
      { model: 'command-r', name: 'Command R', description: 'Cohere\'s standard model' }
    ],
    'mistral': [
      { model: 'mistral-large-latest', name: 'Mistral Large', description: 'Largest Mistral reasoning model' },
      { model: 'mistral-small-latest', name: 'Mistral Small', description: 'Smaller fast Mistral model' },
      { model: 'codestral-latest', name: 'Codestral', description: 'Mistral code generation model' }
    ]
  };

  useEffect(() => {
    if (isOpen) {
      loadExternalModels();
    }
  }, [isOpen]);

  const loadExternalModels = async () => {
    try {
      // Load external models from backend
      const response = await (window as any).externalModels?.getAll();
      if (response && response.success) {
        setExternalModels(response.models);
      }
    } catch (error) {
      console.error('Error loading external models:', error);
    }
  };

  const saveExternalModels = (models: ExternalModel[]) => {
    // Models are automatically saved in the backend
    setExternalModels(models);
  };

  const addModel = async () => {
    if (!newModel.name || !newModel.model || !newModel.provider) {
      alert('Please complete all required fields');
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
        await loadExternalModels(); // Reload the list
        window.dispatchEvent(new Event('external-models-updated'));
        
        setNewModel({
          provider: 'openai',
          enabled: true,
          temperature: 0.7,
          maxTokens: 4096
        });
        setShowAddModel(false);
      } else {
        alert('Error adding model');
      }
    } catch (error) {
      console.error('Error adding model:', error);
      alert('Error adding model');
    }
  };

  const removeModel = async (id: string) => {
    try {
      const response = await (window as any).externalModels?.remove(id);
      if (response && response.success) {
        await loadExternalModels(); // Reload the list
        window.dispatchEvent(new Event('external-models-updated'));
      } else {
        alert('Error removing model');
      }
    } catch (error) {
      console.error('Error removing model:', error);
      alert('Error removing model');
    }
  };

  const toggleModel = async (id: string) => {
    try {
      const model = externalModels.find(m => m.id === id);
      if (!model) return;
      
      const response = await (window as any).externalModels?.toggle(id, !model.enabled);
      if (response && response.success) {
        await loadExternalModels(); // Reload the list
        window.dispatchEvent(new Event('external-models-updated'));
      } else {
        alert('Error changing model status');
      }
    } catch (error) {
      console.error('Error toggling model:', error);
      alert('Error changing model status');
    }
  };

  const validateModel = async (id: string) => {
    try {
      const res = await (window as any).externalModels?.validateModel(id);
      if (res && res.success) {
        await loadExternalModels();
      } else {
        alert('Error validating model: ' + (res?.message || 'unknown'));
      }
    } catch (e) {
      console.error('Error validating model', e);
      alert('Error validating model');
    }
  };

  const startEditModel = (model: ExternalModel) => {
    setEditingModel(model);
    setNewModel({
      name: model.name,
      provider: model.provider,
      model: model.model,
  // If apiKey is the secure sentinel, don't prefill (user leaves blank to keep existing)
  apiKey: model.apiKey === '__SECURE__' ? '' : model.apiKey,
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
      alert('Please complete all required fields');
      return;
    }

    try {
      const modelToUpdate: any = {
        name: newModel.name!,
        provider: newModel.provider!,
        model: newModel.model!,
        endpoint: newModel.endpoint,
        enabled: newModel.enabled ?? true,
        description: newModel.description,
        maxTokens: newModel.maxTokens,
        temperature: newModel.temperature
      };
      // Only send apiKey if user typed something (blank means keep existing)
      if (newModel.apiKey && newModel.apiKey.trim() !== '') {
        modelToUpdate.apiKey = newModel.apiKey.trim();
      }

      const response = await (window as any).externalModels?.update(editingModel.id, modelToUpdate);
      if (response && response.success) {
        await loadExternalModels(); // Reload the list
        window.dispatchEvent(new Event('external-models-updated'));
        
        setNewModel({
          provider: 'openai',
          enabled: true,
          temperature: 0.7,
          maxTokens: 4096
        });
        setShowAddModel(false);
        setEditingModel(null);
      } else {
        alert('Error updating model');
      }
    } catch (error) {
      console.error('Error updating model:', error);
      alert('Error updating model');
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
  case 'mistral': return '🌀';
  case 'custom': return '🛠️';
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
  case 'mistral': return '#0ea5e9';
  case 'custom': return '#6b7280';
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
        await loadExternalModels(); // Reload the list
      } else {
        alert('Error adding predefined model');
      }
    } catch (error) {
      console.error('Error adding predefined model:', error);
      alert('Error adding predefined model');
    }
  };

  if (!isOpen) return null;

  const openCopilot = () => {
    window.open('https://github.com/copilot', '_blank');
  };

  return (
    <div className="model-manager-overlay">
      <div className="model-manager">
        <div className="model-manager-header">
          <h2>🌐 External Model Management</h2>
          <button className="close-button" onClick={onClose}>✕</button>
        </div>

        <div className="model-manager-content">
          {/* Configured models */}
          <div className="models-section">
            <div className="section-header">
              <h3>📋 Configured Models</h3>
              <button 
                onClick={() => setShowAddModel(true)}
                className="add-model-btn"
              >
                ➕ Add Model
              </button>
              <button
                onClick={openCopilot}
                className="add-model-btn"
                title="Open GitHub Copilot Chat"
              >🐙 Open Copilot</button>
            </div>

            {externalModels.length === 0 ? (
              <div className="no-models">
                <p>No external models configured</p>
                <p className="hint">Add models from OpenAI, Anthropic, GitHub Copilot and more</p>
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
                      {model.apiKey === '__SECURE__' && (
                        <div className="model-key">� API Key stored securely</div>
                      )}
                      {model.lastValidationStatus && (
                        <div className={`model-validation status-${model.lastValidationStatus}`} title={model.lastValidationMessage || ''}>
                          {model.lastValidationStatus === 'valid' && '✅ Valid'}
                          {model.lastValidationStatus === 'invalid' && '⚠️ Invalid'}
                          {model.lastValidationStatus === 'error' && '❌ Error'}
                          {model.lastValidationMessage && (
                            <span className="validation-msg"> - {model.lastValidationMessage}</span>
                          )}
                          {model.provider === 'github-copilot' && model.lastValidationMessage?.includes('404') && (
                            <div className="validation-hint">
                              🔍 The GitHub Models API returned 404 for this model id. Verify:
                              <ul>
                                <li>Model ID is exact (e.g. claude-3.5-sonnet, gpt-4o, gpt-4o-mini, o3-mini, claude-3-haiku, mistral-large)</li>
                                <li>Your account has access to GitHub Models preview / Copilot entitlement</li>
                                <li>Your PAT is active & includes read:user (and models scope if required)</li>
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    
                    <div className="model-controls">
                      <button
                        onClick={() => validateModel(model.id)}
                        className="validate-btn"
                        title="Validate model/API key"
                      >🧪</button>
                      <button
                        onClick={() => toggleModel(model.id)}
                        className={`toggle-btn ${model.enabled ? 'enabled' : 'disabled'}`}
                        title={model.enabled ? 'Disable' : 'Enable'}
                      >
                        {model.enabled ? '👁️' : '🚫'}
                      </button>
                      <button
                        onClick={() => startEditModel(model)}
                        className="edit-btn"
                        title="Edit model"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => removeModel(model.id)}
                        className="remove-btn"
                        title="Remove model"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Predefined models */}
          <div className="predefined-section">
              <h3>⭐ Popular Models</h3>
              <div className="copilot-hint">
                🐙 GitHub Copilot models use your GitHub token via the GitHub Models API. Token is stored securely (never written to disk).
              </div>
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
                          title="Add this model"
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

          {/* Form to add/edit model */}
          {showAddModel && (
            <div className="add-model-form">
              <h3>{editingModel ? '✏️ Edit Model' : '➕ Add New Model'}</h3>
              
              <div className="form-row">
                <div className="form-group">
                  <label>Provider</label>
                  <select
                    value={newModel.provider}
                    onChange={(e) => setNewModel(prev => ({ ...prev, provider: e.target.value as any }))}
                    title="Select model provider"
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="github-copilot">GitHub Copilot</option>
                    <option value="google">Google</option>
                    <option value="cohere">Cohere</option>
                    <option value="mistral">Mistral</option>
                    <option value="custom">Custom (OpenAI-Compatible)</option>
                  </select>
                </div>
                
                <div className="form-group">
                  <label>Model name</label>
                  <input
                    type="text"
                    value={newModel.name || ''}
                    onChange={(e) => setNewModel(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g. GPT-4o"
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Model ID</label>
                  <input
                    type="text"
                    value={newModel.model || ''}
                    onChange={(e) => setNewModel(prev => ({ ...prev, model: e.target.value }))}
                    placeholder="e.g. gpt-4o"
                  />
                </div>
                
                <div className="form-group">
                  <label>API Key (optional)</label>
                  <input
                    type="password"
                    value={newModel.apiKey || ''}
                    onChange={(e) => setNewModel(prev => ({ ...prev, apiKey: e.target.value }))}
                    placeholder="Your API key"
                  />
                    {editingModel && (
                      <button
                        type="button"
                        className="inline-btn"
                        onClick={() => setNewModel(prev => ({ ...prev, apiKey: '' }))}
                        title="Leave blank to keep stored key; enter new value to replace"
                      >Clear</button>
                    )}
                </div>
              </div>

              <div className="form-group">
                <label>Description (optional)</label>
                <input
                  type="text"
                  value={newModel.description || ''}
                  onChange={(e) => setNewModel(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Model description"
                />
              </div>

              {(newModel.provider === 'openai' || newModel.provider === 'custom') && (
                <div className="form-group">
                  <label>Custom Endpoint (optional)</label>
                  <input
                    type="text"
                    value={newModel.endpoint || ''}
                    onChange={(e) => setNewModel(prev => ({ ...prev, endpoint: e.target.value }))}
                    placeholder="https://api.your-endpoint.com/v1"
                  />
                </div>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label>Temperature</label>
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={newModel.temperature || 0.7}
                    onChange={(e) => setNewModel(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                    title="Configure model temperature"
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
                    title="Configure maximum tokens"
                    placeholder="4096"
                  />
                </div>
              </div>

              <div className="form-actions">
                <button 
                  onClick={editingModel ? saveEditedModel : addModel} 
                  className="save-btn"
                >
                  {editingModel ? '💾 Update Model' : '💾 Save Model'}
                </button>
                <button onClick={editingModel ? cancelEdit : () => setShowAddModel(false)} className="cancel-btn">
                  ❌ Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="model-manager-footer">
          <div className="footer-info">
            <span>💡 External models require valid API keys to function</span>
          </div>
          <button onClick={onClose} className="close-footer-btn">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModelManager;
