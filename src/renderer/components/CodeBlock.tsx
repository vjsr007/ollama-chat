import React, { useEffect, useRef, useState } from 'react';
import '../prism-theme.css';

interface CodeBlockProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ 
  code, 
  language = 'text', 
  showLineNumbers = false 
}) => {
  const codeRef = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);

  // Función para aplicar resaltado básico sin Prism.js (para evitar problemas de bundling)
  const highlightCode = (code: string, lang: string) => {
    // Si el lenguaje es text o no reconocido, devolver tal como está
    if (lang === 'text' || lang === '') {
      return code;
    }

    // Escapar HTML
    const escapedCode = code
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    // Aplicar resaltado básico para algunos lenguajes comunes
    let highlightedCode = escapedCode;

    switch (lang.toLowerCase()) {
      case 'javascript':
      case 'js':
      case 'typescript':
      case 'ts':
        highlightedCode = highlightedCode
          .replace(/\b(function|const|let|var|if|else|for|while|return|import|export|class|interface|type)\b/g, '<span class="keyword">$1</span>')
          .replace(/\b(true|false|null|undefined)\b/g, '<span class="boolean">$1</span>')
          .replace(/\b(\d+)\b/g, '<span class="number">$1</span>')
          .replace(/(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g, '<span class="string">$1$2$1</span>')
          .replace(/(\/\/.*$)/gm, '<span class="comment">$1</span>')
          .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="comment">$1</span>');
        break;
      
      case 'python':
      case 'py':
        highlightedCode = highlightedCode
          .replace(/\b(def|class|if|elif|else|for|while|return|import|from|as|try|except|finally|with|pass|break|continue)\b/g, '<span class="keyword">$1</span>')
          .replace(/\b(True|False|None)\b/g, '<span class="boolean">$1</span>')
          .replace(/\b(\d+)\b/g, '<span class="number">$1</span>')
          .replace(/(["'`])((?:\\.|(?!\1)[^\\])*?)\1/g, '<span class="string">$1$2$1</span>')
          .replace(/(#.*$)/gm, '<span class="comment">$1</span>');
        break;
      
      case 'css':
        highlightedCode = highlightedCode
          .replace(/([a-z-]+)(\s*:\s*)/g, '<span class="property">$1</span>$2')
          .replace(/(#[0-9a-fA-F]{3,6})/g, '<span class="value">$1</span>')
          .replace(/(\d+(?:px|em|rem|%|vh|vw))/g, '<span class="value">$1</span>')
          .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="comment">$1</span>');
        break;
      
      case 'json':
        highlightedCode = highlightedCode
          .replace(/(["'])((?:\\.|(?!\1)[^\\])*?)\1(\s*:)/g, '<span class="property">$1$2$1</span>$3')
          .replace(/:\s*(["'])((?:\\.|(?!\1)[^\\])*?)\1/g, ': <span class="string">$1$2$1</span>')
          .replace(/:\s*(\b\d+\b)/g, ': <span class="number">$1</span>')
          .replace(/:\s*\b(true|false|null)\b/g, ': <span class="boolean">$1</span>');
        break;
      
      case 'html':
      case 'xml':
        highlightedCode = highlightedCode
          .replace(/(&lt;\/?)([\w-]+)/g, '$1<span class="tag">$2</span>')
          .replace(/([\w-]+)(=)/g, '<span class="attr-name">$1</span>$2')
          .replace(/=(&quot;|&#39;)(.*?)(\1)/g, '=<span class="attr-value">$1$2$3</span>')
          .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="comment">$1</span>');
        break;
    }

    return highlightedCode;
  };

  useEffect(() => {
    if (codeRef.current) {
      const detectedLanguage = detectLanguage(code);
      const finalLanguage = language !== 'text' ? language : detectedLanguage;
      const highlighted = highlightCode(code, finalLanguage);
      codeRef.current.innerHTML = highlighted;
    }
  }, [code, language]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  // Detectar el lenguaje automáticamente si no se proporciona
  const detectLanguage = (code: string): string => {
    if (language !== 'text') return language;
    
    const codeLines = code.toLowerCase().trim();
    
    // JavaScript/TypeScript
    if (codeLines.includes('function') || codeLines.includes('const ') || 
        codeLines.includes('let ') || codeLines.includes('var ') ||
        codeLines.includes('import ') || codeLines.includes('export ')) {
      if (codeLines.includes('interface ') || codeLines.includes(': string') ||
          codeLines.includes(': number') || codeLines.includes('tsx')) {
        return 'typescript';
      }
      return 'javascript';
    }
    
    // Python
    if (codeLines.includes('def ') || codeLines.includes('import ') ||
        codeLines.includes('from ') || codeLines.includes('print(') ||
        codeLines.includes('if __name__')) {
      return 'python';
    }
    
    // CSS
    if (codeLines.includes('{') && codeLines.includes('}') && 
        codeLines.includes(':') && !codeLines.includes('function')) {
      return 'css';
    }
    
    // JSON
    if ((codeLines.startsWith('{') || codeLines.startsWith('[')) &&
        codeLines.includes('"') && codeLines.includes(':')) {
      return 'json';
    }
    
    // HTML
    if (codeLines.includes('<') && codeLines.includes('>') &&
        (codeLines.includes('<div') || codeLines.includes('<html') ||
         codeLines.includes('<body') || codeLines.includes('<head'))) {
      return 'html';
    }
    
    // SQL
    if (codeLines.includes('select ') || codeLines.includes('from ') ||
        codeLines.includes('where ') || codeLines.includes('insert ') ||
        codeLines.includes('update ') || codeLines.includes('delete ')) {
      return 'sql';
    }
    
    // Bash/Shell
    if (codeLines.includes('#!/bin/bash') || codeLines.includes('cd ') ||
        codeLines.includes('npm ') || codeLines.includes('git ') ||
        codeLines.startsWith('$')) {
      return 'bash';
    }
    
    // PowerShell
    if (codeLines.includes('get-') || codeLines.includes('set-') ||
        codeLines.includes('new-') || codeLines.includes('$env:') ||
        codeLines.includes('write-host')) {
      return 'powershell';
    }
    
    return 'text';
  };

  const detectedLanguage = language !== 'text' ? language : detectLanguage(code);

  return (
    <div className="code-block-container">
      <div className="code-block-header">
        <span className="code-language">{detectedLanguage}</span>
        <button 
          className="code-copy-btn"
          onClick={handleCopy}
          title={copied ? 'Copied!' : 'Copy code'}
        >
          {copied ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
            </svg>
          )}
        </button>
      </div>
      <pre className={`code-block ${showLineNumbers ? 'line-numbers' : ''}`}>
        <code 
          ref={codeRef}
          className={`language-${detectedLanguage}`}
        >
        </code>
      </pre>
    </div>
  );
};

export default CodeBlock;
