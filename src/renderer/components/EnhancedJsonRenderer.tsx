import React, { useState } from 'react';
import JsonRenderer from './JsonRenderer';
import CodeBlock from './CodeBlock';
import './EnhancedJsonRenderer.css';

interface EnhancedJsonRendererProps {
  content: string;
}

interface JsonBlock {
  type: 'json' | 'code' | 'text';
  content: string;
  language?: string;
  startIndex: number;
  endIndex: number;
  parsed?: any;
}

const EnhancedJsonRenderer: React.FC<EnhancedJsonRendererProps> = ({ content }) => {
  const [expandedBlocks, setExpandedBlocks] = useState<Set<number>>(new Set());

  const detectJsonBlocks = (text: string): JsonBlock[] => {
    const blocks: JsonBlock[] = [];
    let lastIndex = 0;

    // Patterns for different types of JSON content
    const patterns = [
      // Code blocks with language specification
      {
        regex: /```(json|javascript|js)\s*\n([\s\S]*?)\n```/gi,
        type: 'code' as const,
        hasLanguage: true
      },
      // Generic code blocks that might contain JSON
      {
        regex: /```\s*\n([\s\S]*?)\n```/gi,
        type: 'code' as const,
        hasLanguage: false
      },
      // Tool execution results (common pattern in the app)
      {
        regex: /(Tool executed:.*?\nResult:\s*)([\s\S]*?)(?=\n\n|\nTool executed:|\n[A-Z]|$)/gi,
        type: 'json' as const,
        hasLanguage: false
      },
      // SYSTEM tool results (more specific pattern)
      {
        regex: /SYSTEM\s*\n\s*Tool executed:[^\n]*\n\s*Result:\s*([\s\S]*?)(?=\n\s*\n|\n[A-Z]|$)/gi,
        type: 'json' as const,
        hasLanguage: false
      },
      // Generic Result: pattern (for tool outputs)
      {
        regex: /Result:\s*(\[[\s\S]*?\]|\{[\s\S]*?\})/gi,
        type: 'json' as const,
        hasLanguage: false
      },
      // Standalone JSON objects/arrays
      {
        regex: /(\{(?:[^{}"]|"(?:[^"\\]|\\.)*"|{(?:[^{}"]|"(?:[^"\\]|\\.)*")*})*\})/g,
        type: 'json' as const,
        hasLanguage: false
      },
      {
        regex: /(\[(?:[^\[\]"]|"(?:[^"\\]|\\.)*"|\[(?:[^\[\]"]|"(?:[^"\\]|\\.)*")*\])*\])/g,
        type: 'json' as const,
        hasLanguage: false
      }
    ];

    const matches: Array<{
      match: RegExpMatchArray;
      type: 'json' | 'code';
      language?: string;
      content: string;
    }> = [];

    // Find all matches
    patterns.forEach(pattern => {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match;
      
      while ((match = regex.exec(text)) !== null) {
        let jsonContent: string;
        let language: string | undefined;

        if (pattern.hasLanguage && pattern.type === 'code') {
          language = match[1];
          jsonContent = match[2];
        } else if (pattern.type === 'code') {
          jsonContent = match[1];
        } else {
          // For tool results, try to get the JSON part after "Result:"
          if (match[0].includes('Tool executed:') || match[0].includes('Result:')) {
            // Extract everything after "Result:"
            const resultMatch = match[0].match(/Result:\s*([\s\S]*)/);
            jsonContent = resultMatch ? resultMatch[1].trim() : (match[2] || match[1]);
          } else {
            jsonContent = match[2] || match[1];
          }
        }

        // Try to parse as JSON to validate
        let parsed = null;
        try {
          // Clean up the JSON content first
          const cleanedContent = jsonContent.trim()
            .replace(/^\s*[\r\n]+/, '') // Remove leading newlines
            .replace(/[\r\n]+\s*$/, '') // Remove trailing newlines
            .replace(/,(\s*[}\]])/g, '$1'); // Remove trailing commas
          
          parsed = JSON.parse(cleanedContent);
        } catch (parseError) {
          // If it's in a json code block, still treat it as JSON for syntax highlighting
          if (language === 'json' || language === 'javascript' || language === 'js') {
            // Keep as code block even if invalid JSON
          } else if (pattern.type === 'json') {
            // For tool results, try a more lenient parsing
            try {
              // Try to extract just the JSON part more aggressively
              const jsonMatch = jsonContent.match(/(\[[\s\S]*\]|\{[\s\S]*\})/);
              if (jsonMatch) {
                const cleanedMatch = jsonMatch[1].trim()
                  .replace(/,(\s*[}\]])/g, '$1');
                parsed = JSON.parse(cleanedMatch);
              }
            } catch {
              continue; // Skip if still can't parse
            }
          }
        }

        matches.push({
          match,
          type: pattern.type,
          language,
          content: jsonContent
        });
      }
    });

    // Sort matches by position
    matches.sort((a, b) => a.match.index! - b.match.index!);

    // Remove overlapping matches (keep the first/most specific one)
    const filteredMatches: Array<{
      match: RegExpMatchArray;
      type: 'json' | 'code';
      language?: string;
      content: string;
    }> = [];
    for (const match of matches) {
      const start = match.match.index!;
      const end = start + match.match[0].length;
      
      const overlaps = filteredMatches.some(existing => {
        const existingStart = existing.match.index!;
        const existingEnd = existingStart + existing.match[0].length;
        
        return (start < existingEnd && end > existingStart);
      });
      
      if (!overlaps) {
        filteredMatches.push(match);
      }
    }

    // Build blocks array
    filteredMatches.forEach((match, index) => {
      const start = match.match.index!;
      const end = start + match.match[0].length;

      // Add text before this match
      if (start > lastIndex) {
        const textContent = text.slice(lastIndex, start).trim();
        if (textContent) {
          blocks.push({
            type: 'text',
            content: textContent,
            startIndex: lastIndex,
            endIndex: start
          });
        }
      }

      // Add the JSON/code block
      let parsed = null;
      try {
        parsed = JSON.parse(match.content.trim());
      } catch {
        // Keep as code if can't parse
      }

      blocks.push({
        type: parsed && typeof parsed === 'object' ? 'json' : 'code',
        content: match.content,
        language: match.language || 'json',
        startIndex: start,
        endIndex: end,
        parsed
      });

      lastIndex = end;
    });

    // Add remaining text
    if (lastIndex < text.length) {
      const remainingText = text.slice(lastIndex).trim();
      if (remainingText) {
        blocks.push({
          type: 'text',
          content: remainingText,
          startIndex: lastIndex,
          endIndex: text.length
        });
      }
    }

    // If no JSON blocks found, return the entire content as text
    if (blocks.length === 0) {
      blocks.push({
        type: 'text',
        content: text,
        startIndex: 0,
        endIndex: text.length
      });
    }

    return blocks;
  };

  const toggleExpanded = (index: number) => {
    const newExpanded = new Set(expandedBlocks);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedBlocks(newExpanded);
  };

  // Fast path: whole content is JSON
  let topLevelParsed: any = undefined;
  if (content) {
    try {
      topLevelParsed = JSON.parse(content);
    } catch { /* ignore */ }
  }

  const blocks = topLevelParsed !== undefined ? [{
    type: 'json' as const,
    content,
    startIndex: 0,
    endIndex: content.length,
    parsed: topLevelParsed,
    language: 'json'
  }] : detectJsonBlocks(content);

  return (
    <div className="enhanced-json-renderer">
      {blocks.map((block, index) => {
        if (block.type === 'text') {
          return (
            <div key={index} className="text-block">
              <pre className="text-content">{block.content}</pre>
            </div>
          );
        }

        if (block.type === 'json' && block.parsed) {
          const isExpanded = expandedBlocks.has(index);
          
          return (
            <div key={index} className="json-block">
              <div className="json-block-header">
                <button
                  className="json-toggle-btn"
                  onClick={() => toggleExpanded(index)}
                  title={isExpanded ? 'Collapse JSON' : 'Expand JSON'}
                >
                  {isExpanded ? '📄' : '📋'} JSON {isExpanded ? 'Tree View' : 'Code View'}
                </button>
                <button
                  className="json-copy-btn"
                  onClick={() => {
                    try { navigator.clipboard.writeText(JSON.stringify(block.parsed, null, 2)); } catch {}
                  }}
                  title="Copy JSON"
                >📎 Copy</button>
                <span className="json-size-info">
                  {typeof block.parsed === 'object' && block.parsed !== null 
                    ? `${Object.keys(block.parsed).length} properties`
                    : Array.isArray(block.parsed) 
                    ? `${block.parsed.length} items`
                    : 'value'
                  }
                </span>
              </div>
              
              {isExpanded ? (
                <div className="json-tree-view">
                  <JsonRenderer data={block.parsed} />
                </div>
              ) : (
                <div className="json-code-view">
                  <CodeBlock 
                    code={JSON.stringify(block.parsed, null, 2)} 
                    language="json" 
                  />
                </div>
              )}
            </div>
          );
        }

        // Code block
        return (
          <div key={index} className="code-block">
            <CodeBlock 
              code={block.content} 
              language={block.language || 'text'} 
            />
          </div>
        );
      })}
    </div>
  );
};

export default EnhancedJsonRenderer;
