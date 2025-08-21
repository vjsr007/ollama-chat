import React, { useState, useEffect } from 'react';
import './ArgumentEditor.css';

interface ArgumentDefinition {
  type: string;
  required?: boolean;
  description?: string;
  enum?: string[];
  default?: any;
  properties?: Record<string, ArgumentDefinition>;
  items?: ArgumentDefinition;
}

interface ArgumentEditorProps {
  argName: string;
  argDef: ArgumentDefinition;
  value: any;
  onChange: (value: any) => void;
}

const ArgumentEditor: React.FC<ArgumentEditorProps> = ({ 
  argName, 
  argDef, 
  value, 
  onChange 
}) => {
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonError, setJsonError] = useState('');

  // Detectar automáticamente si debería estar en modo JSON
  useEffect(() => {
    if (argDef.type === 'object' || argDef.type === 'array') {
      setJsonMode(true);
    }
  }, [argDef.type]);

  const handleJSONChange = (jsonString: string) => {
    try {
      if (jsonString.trim() === '') {
        onChange(undefined);
        setJsonError('');
        return;
      }
      
      const parsed = JSON.parse(jsonString);
      onChange(parsed);
      setJsonError('');
    } catch (error) {
      setJsonError('JSON inválido');
    }
  };

  const getPlaceholder = () => {
    if (argDef.description) return argDef.description;
    
    switch (argDef.type) {
      case 'string':
        return 'Ingrese texto...';
      case 'number':
        return 'Ingrese número...';
      case 'boolean':
        return 'true o false';
      case 'array':
        return '["item1", "item2"]';
      case 'object':
        return '{"key": "value"}';
      default:
        return 'Ingrese valor...';
    }
  };

  const formatValueForDisplay = (val: any): string => {
    if (val === undefined || val === null) return '';
    if (typeof val === 'string') return val;
    return JSON.stringify(val, null, 2);
  };

  const renderTypeIcon = () => {
    switch (argDef.type) {
      case 'string': return '📝';
      case 'number': return '🔢';
      case 'boolean': return '✅';
      case 'array': return '📋';
      case 'object': return '🗂️';
      default: return '📄';
    }
  };

  const renderInput = () => {
    // Si tiene enum, mostrar select
    if (argDef.enum && argDef.enum.length > 0) {
      return (
        <select
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          className="arg-select"
          title={`Seleccionar valor para ${argName}`}
          aria-label={`Seleccionar valor para ${argName}`}
        >
          <option value="">-- Seleccionar --</option>
          {argDef.enum.map(option => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    }

    // Boolean como checkbox
    if (argDef.type === 'boolean' && !jsonMode) {
      return (
        <div className="arg-boolean">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(e) => onChange(e.target.checked)}
            />
            <span className="checkbox-custom"></span>
            {value ? 'Verdadero' : 'Falso'}
          </label>
        </div>
      );
    }

    // Number como input number
    if (argDef.type === 'number' && !jsonMode) {
      return (
        <input
          type="number"
          value={value || ''}
          onChange={(e) => {
            const num = parseFloat(e.target.value);
            onChange(isNaN(num) ? undefined : num);
          }}
          placeholder={getPlaceholder()}
          className="arg-input"
        />
      );
    }

    // String simple
    if (argDef.type === 'string' && !jsonMode) {
      return (
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={getPlaceholder()}
          className="arg-input"
        />
      );
    }

    // JSON mode para tipos complejos o cuando se activa manualmente
    return (
      <div className="arg-json-container">
        <textarea
          value={formatValueForDisplay(value)}
          onChange={(e) => handleJSONChange(e.target.value)}
          placeholder={getPlaceholder()}
          className={`arg-textarea ${jsonError ? 'error' : ''}`}
          rows={Math.min(Math.max(3, formatValueForDisplay(value).split('\n').length), 10)}
        />
        {jsonError && <div className="json-error">❌ {jsonError}</div>}
      </div>
    );
  };

  return (
    <div className="argument-editor">
      <div className="arg-header">
        <label className="arg-label">
          <span className="arg-icon">{renderTypeIcon()}</span>
          <span className="arg-name">{argName}</span>
          {argDef.required && <span className="required">*</span>}
          <span className="arg-type">({argDef.type})</span>
        </label>
        
        <div className="arg-controls">
          {(argDef.type === 'string' || argDef.type === 'number' || argDef.type === 'boolean') && (
            <button
              type="button"
              onClick={() => setJsonMode(!jsonMode)}
              className={`mode-toggle ${jsonMode ? 'active' : ''}`}
              title={jsonMode ? 'Cambiar a modo simple' : 'Cambiar a modo JSON'}
            >
              {jsonMode ? '📝' : '{ }'}
            </button>
          )}
          
          {argDef.default !== undefined && (
            <button
              type="button"
              onClick={() => onChange(argDef.default)}
              className="default-btn"
              title="Usar valor por defecto"
            >
              ↺
            </button>
          )}
          
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="clear-btn"
            title="Limpiar valor"
          >
            ✕
          </button>
        </div>
      </div>

      {argDef.description && (
        <div className="arg-description">
          💡 {argDef.description}
        </div>
      )}

      <div className="arg-input-container">
        {renderInput()}
      </div>

      {argDef.default !== undefined && (
        <div className="arg-default">
          💭 Valor por defecto: <code>{JSON.stringify(argDef.default)}</code>
        </div>
      )}
    </div>
  );
};

export default ArgumentEditor;
