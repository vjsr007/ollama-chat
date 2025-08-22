import React, { useState } from 'react';
import './JsonRenderer.css';

interface JsonRendererProps {
  data: any;
  maxDepth?: number;
  currentDepth?: number;
}

const JsonRenderer: React.FC<JsonRendererProps> = ({ 
  data, 
  maxDepth = 5, 
  currentDepth = 0 
}) => {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [imageErrors, setImageErrors] = useState<Set<string>>(new Set());

  const toggleExpanded = (key: string) => {
    const newExpanded = new Set(expandedKeys);
    if (newExpanded.has(key)) {
      newExpanded.delete(key);
    } else {
      newExpanded.add(key);
    }
    setExpandedKeys(newExpanded);
  };

  const handleImageError = (key: string) => {
    setImageErrors(prev => new Set(prev).add(key));
  };

  const isImageData = (value: string): boolean => {
    if (typeof value !== 'string') return false;
    
  // Detect different image formats
    const imagePatterns = [
      /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,/i,
      /^iVBORw0KGgo/, // PNG signature
      /^\/9j\//, // JPEG signature
      /^R0lGOD/, // GIF signature
      /^UklGR/, // WEBP signature
    ];
    
    return imagePatterns.some(pattern => pattern.test(value));
  };

  const formatImageData = (value: string): string => {
    if (value.startsWith('data:image/')) {
  return value; // Already has data URI prefix
    }
    
  // Detect format and add appropriate prefix
    if (value.startsWith('iVBORw0KGgo')) {
      return `data:image/png;base64,${value}`;
    } else if (value.startsWith('/9j/')) {
      return `data:image/jpeg;base64,${value}`;
    } else if (value.startsWith('R0lGOD')) {
      return `data:image/gif;base64,${value}`;
    } else if (value.startsWith('UklGR')) {
      return `data:image/webp;base64,${value}`;
    }
    
    // Default to PNG
    return `data:image/png;base64,${value}`;
  };

  const renderValue = (value: any, key: string, path: string = ''): React.ReactNode => {
    const fullPath = path ? `${path}.${key}` : key;

    if (value === null) {
      return <span className="json-null">null</span>;
    }

    if (typeof value === 'boolean') {
      return <span className="json-boolean">{value.toString()}</span>;
    }

    if (typeof value === 'number') {
      return <span className="json-number">{value}</span>;
    }

    if (typeof value === 'string') {
  // Check if value is an image
      if (isImageData(value)) {
        const imageKey = `${fullPath}_image`;
        const hasError = imageErrors.has(imageKey);
        
        if (hasError) {
          return (
            <div className="json-image-fallback">
              <span className="json-string">"{value.substring(0, 50)}..."</span>
              <span className="json-image-label">📷 Image data (failed to load)</span>
            </div>
          );
        }

        return (
          <div className="json-image-container">
            <div className="json-image-preview">
              <img 
                src={formatImageData(value)}
                alt={`Image for ${key}`}
                className="json-image"
                onError={() => handleImageError(imageKey)}
                loading="lazy"
              />
              <div className="json-image-info">
                <span className="json-image-label">📷 Image data</span>
                <span className="json-image-size">
                  {Math.round(value.length / 1024)} KB
                </span>
              </div>
            </div>
            <details className="json-image-raw">
              <summary>View raw data</summary>
              <span className="json-string">"{value.substring(0, 200)}..."</span>
            </details>
          </div>
        );
      }

      // String normal
      return <span className="json-string">"{value}"</span>;
    }

    if (Array.isArray(value)) {
      if (currentDepth >= maxDepth) {
        return <span className="json-truncated">[...{value.length} items]</span>;
      }

      const isExpanded = expandedKeys.has(fullPath);
      
      return (
        <div className="json-array">
          <span 
            className="json-bracket json-expandable"
            onClick={() => toggleExpanded(fullPath)}
          >
            [{isExpanded ? '' : `...${value.length} items`}
            {isExpanded && (
              <div className="json-array-content">
                {value.map((item, index) => (
                  <div key={index} className="json-array-item">
                    <span className="json-array-index">{index}:</span>
                    {renderValue(item, index.toString(), fullPath)}
                    {index < value.length - 1 && <span className="json-comma">,</span>}
                  </div>
                ))}
              </div>
            )}
            ]
          </span>
        </div>
      );
    }

    if (typeof value === 'object') {
      if (currentDepth >= maxDepth) {
        const keys = Object.keys(value);
        return <span className="json-truncated">{'{'} ...{keys.length} keys {'}'}</span>;
      }

      const keys = Object.keys(value);
      const isExpanded = expandedKeys.has(fullPath);

      return (
        <div className="json-object">
          <span 
            className="json-bracket json-expandable"
            onClick={() => toggleExpanded(fullPath)}
          >
            {'{'}
            {!isExpanded && keys.length > 0 && <span className="json-preview">...{keys.length} keys</span>}
            {isExpanded && (
              <div className="json-object-content">
                {keys.map((objKey, index) => (
                  <div key={objKey} className="json-object-item">
                    <span className="json-key">"{objKey}"</span>
                    <span className="json-colon">: </span>
                    {renderValue(value[objKey], objKey, fullPath)}
                    {index < keys.length - 1 && <span className="json-comma">,</span>}
                  </div>
                ))}
              </div>
            )}
            {'}'}
          </span>
        </div>
      );
    }

    return <span className="json-unknown">{String(value)}</span>;
  };

  const expandAll = () => {
    const getAllPaths = (obj: any, currentPath: string = ''): string[] => {
      const paths: string[] = [];
      
      if (Array.isArray(obj)) {
        paths.push(currentPath);
        obj.forEach((item, index) => {
          const itemPath = currentPath ? `${currentPath}.${index}` : index.toString();
          paths.push(...getAllPaths(item, itemPath));
        });
      } else if (typeof obj === 'object' && obj !== null) {
        paths.push(currentPath);
        Object.keys(obj).forEach(key => {
          const keyPath = currentPath ? `${currentPath}.${key}` : key;
          paths.push(...getAllPaths(obj[key], keyPath));
        });
      }
      
      return paths;
    };

    setExpandedKeys(new Set(getAllPaths(data)));
  };

  const collapseAll = () => {
    setExpandedKeys(new Set());
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
  };

  return (
    <div className="json-renderer">
      <div className="json-controls">
        <button onClick={expandAll} className="json-control-btn">
          📂 Expandir todo
        </button>
        <button onClick={collapseAll} className="json-control-btn">
          📁 Colapsar todo
        </button>
        <button onClick={copyToClipboard} className="json-control-btn">
          📋 Copiar JSON
        </button>
      </div>
      <div className="json-content">
        {renderValue(data, 'root')}
      </div>
    </div>
  );
};

export default JsonRenderer;
