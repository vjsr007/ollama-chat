import React from 'react';
import CodeBlock from './CodeBlock';

interface MessageContentProps {
  content: string;
}

const MessageContent: React.FC<MessageContentProps> = ({ content }) => {
  // Función para procesar el contenido y detectar bloques de código
  const processContent = (text: string) => {
    const parts: (string | { type: 'code'; code: string; language?: string })[] = [];
    
    // Regex para detectar bloques de código con ```
    const codeBlockRegex = /```(\w+)?\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(text)) !== null) {
      // Agregar texto antes del bloque de código
      if (match.index > lastIndex) {
        const textBefore = text.slice(lastIndex, match.index);
        if (textBefore.trim()) {
          parts.push(textBefore);
        }
      }

      // Agregar el bloque de código
      const language = match[1] || '';
      const code = match[2].trim();
      parts.push({
        type: 'code',
        code,
        language
      });

      lastIndex = match.index + match[0].length;
    }

    // Agregar texto restante
    if (lastIndex < text.length) {
      const remaining = text.slice(lastIndex);
      if (remaining.trim()) {
        parts.push(remaining);
      }
    }

    // Si no se encontraron bloques de código, devolver el texto original
    if (parts.length === 0) {
      parts.push(text);
    }

    return parts;
  };

  // Función para procesar texto plano (markdown básico)
  const processPlainText = (text: string) => {
    // Convertir **texto** a <strong>
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Convertir *texto* a <em>
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // Convertir `código` a <code>
    text = text.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
    
    // Convertir saltos de línea
    text = text.replace(/\n/g, '<br />');
    
    return text;
  };

  const parts = processContent(content);

  return (
    <div className="message-content">
      {parts.map((part, index) => {
        if (typeof part === 'string') {
          return (
            <div
              key={index}
              className="text-content"
              dangerouslySetInnerHTML={{
                __html: processPlainText(part)
              }}
            />
          );
        } else {
          return (
            <CodeBlock
              key={index}
              code={part.code}
              language={part.language}
              showLineNumbers={part.code.split('\n').length > 10}
            />
          );
        }
      })}
    </div>
  );
};

export default MessageContent;
