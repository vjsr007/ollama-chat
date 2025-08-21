import React from 'react';
import CodeBlock from './CodeBlock';
import EnhancedJsonRenderer from './EnhancedJsonRenderer';
import './MessageContent.css';

interface MessageContentProps {
  content: string;
}

const MessageContent: React.FC<MessageContentProps> = ({ content }) => {
  // Check if content contains JSON patterns for enhanced rendering
  const hasJsonContent = (text: string): boolean => {
    const jsonPatterns = [
      /```json/i,
      /Tool executed:/i,
      /Result:\s*[\{\[]/i,
      /SYSTEM\s*\n.*Tool executed:/i,
      /Result:\s*\[/i,
      /^\s*[\{\[]/,
      /[\{\[].{20,}/,
      /"type":\s*"(text|image)"/i,
      /"data":\s*"/i,
      /"mimeType":\s*"/i
    ];
    
    return jsonPatterns.some(pattern => pattern.test(text));
  };

  // If content likely contains JSON, use enhanced renderer
  if (hasJsonContent(content)) {
    return <EnhancedJsonRenderer content={content} />;
  }

  // Original code block processing for non-JSON content
  const parts = content.split(/(```[\s\S]*?```)/);
  
  return (
    <div className="message-content">
      {parts.map((part, index) => {
        if (part.startsWith('```') && part.endsWith('```')) {
          const lines = part.split('\n');
          const firstLine = lines[0];
          const language = firstLine.slice(3).trim() || 'text';
          const code = lines.slice(1, -1).join('\n');
          
          return <CodeBlock key={index} code={code} language={language} />;
        }
        
        return (
          <div
            key={index}
            className="text-content"
          >
            {part}
          </div>
        );
      })}
    </div>
  );
};

export default MessageContent;
