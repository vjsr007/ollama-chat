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
    // Fast reject: single fenced code block with a non-JSON language
    if (/^```(?!json|javascript|js)[a-z0-9_-]+[\r\n][\s\S]*```\s*$/i.test(text.trim())) {
      return false;
    }
    // Heuristics focused on actual JSON/tool output; avoid generic { ... } inside code samples
    const indicativePatterns = [
      /```json/i,               // explicit json code fence
      /Tool executed:/i,        // tool output marker
      /Result:\s*[\{\[]/i,    // Result: followed by object/array
      /^\s*[\{\[][\s\S]*[\}\]]\s*$/m, // whole message is a JSON structure
      /"type"\s*:\s*"(text|image)"/i,
      /"mimeType"\s*":/i
    ];
    return indicativePatterns.some(r => r.test(text));
  };

  // If content likely contains JSON, use enhanced renderer
  if (hasJsonContent(content)) {
    return <EnhancedJsonRenderer content={content} />;
  }

  // Use markdown renderer (supports fenced code blocks) for remaining content
  return <div className="message-content"><MarkdownRenderer content={content} /></div>;
};

export default MessageContent;
