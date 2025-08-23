import { render, screen } from '@testing-library/react';
import MarkdownRenderer from '../MarkdownRenderer';

// Basic render tests

describe('MarkdownRenderer', () => {
  it('renders fenced code block with language', () => {
    const md = '```bash\necho "hello"\n```';
    render(<MarkdownRenderer content={md} />);
    expect(screen.getByText(/echo "hello"/)).toBeInTheDocument();
  });

  it('sanitizes script tags', () => {
    const md = '<script>alert("x")<\\/script>';
    render(<MarkdownRenderer content={md} />);
    expect(document.querySelector('script')).toBeNull();
  });

  it('renders list items', () => {
    const md = '- a\n- b';
    render(<MarkdownRenderer content={md} />);
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
  });
});
