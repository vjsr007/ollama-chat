import * as DOMPurify from 'dompurify';
import { marked } from 'marked';
import CodeBlock from './CodeBlock';

interface MarkdownRendererProps { content: string; }

// Lightweight language inference
const inferLang = (code: string, declared?: string) => {
  if (declared) return declared;
  const c = code.toLowerCase();
  if (/function |const |let |import |export /.test(c)) return 'javascript';
  if (/class |interface /.test(c)) return 'typescript';
  if (/def |print\(|if __name__/.test(c)) return 'python';
  if (/select .* from |insert into |update .* set |delete from /.test(c)) return 'sql';
  if (/^#!/.test(c) || /(npm |yarn |git |cd )/.test(c)) return 'bash';
  if (/get-|set-|new-|write-host|\$env:/.test(c)) return 'powershell';
  if (/".+":/.test(c) && /^[\[{]/.test(c)) return 'json';
  return 'text';
};

const fenceRegex = /```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g;

const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content }) => {
  const text = content || '';
  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Helper to parse markdown safely across marked versions (parse fn vs direct fn)
  const renderMarkdown = (md: string): string => {
    try {
      const anyMarked: any = marked as any;
      const raw = typeof anyMarked.parse === 'function' ? anyMarked.parse(md) : typeof anyMarked === 'function' ? anyMarked(md) : md;
      return typeof raw === 'string' ? raw : (raw ?? md);
    } catch (e) {
      console.warn('Markdown parse failed, falling back to plain text:', (e as Error).message);
      // Basic HTML escape
      return md
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
  };

  const sanitize = (html: string): string => {
    try {
      const purify: any = DOMPurify;
      if (purify && typeof purify.sanitize === 'function') return purify.sanitize(html);
    } catch { /* ignore */ }
    return html; // fallback unsanitized (already mostly safe from marked)
  };

  while ((match = fenceRegex.exec(text)) !== null) {
    const [full, langRaw, codeRaw] = match;
    const start = match.index;
    if (start > lastIndex) {
      const mdChunk = text.slice(lastIndex, start);
      if (mdChunk.trim()) {
        const html = sanitize(renderMarkdown(mdChunk));
        elements.push(<div key={elements.length} className="md-chunk" dangerouslySetInnerHTML={{ __html: html }} />);
      }
    }
    const code = codeRaw.replace(/\n$/,'');
    const lang = inferLang(code, langRaw);
    elements.push(<CodeBlock key={elements.length} code={code} language={lang} />);
    lastIndex = start + full.length;
  }
  // Resto
  if (lastIndex < text.length) {
    const mdChunk = text.slice(lastIndex);
    if (mdChunk.trim()) {
      const html = sanitize(renderMarkdown(mdChunk));
      elements.push(<div key={elements.length} className="md-chunk" dangerouslySetInnerHTML={{ __html: html }} />);
    }
  }

  if (!elements.length) {
    const html = sanitize(renderMarkdown(text));
    elements.push(<div key="single" className="md-chunk" dangerouslySetInnerHTML={{ __html: html }} />);
  }

  return <div className="markdown-renderer">{elements}</div>;
};

export default MarkdownRenderer;
