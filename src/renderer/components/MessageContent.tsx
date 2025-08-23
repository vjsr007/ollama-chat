import React from 'react';
import EnhancedJsonRenderer from './EnhancedJsonRenderer';
import MarkdownRenderer from './MarkdownRenderer';
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

  // Use markdown renderer (supports fenced code blocks) for remaining content
  return <div className="message-content"><MarkdownRenderer content={content} /></div>;
};

export default MessageContent;
