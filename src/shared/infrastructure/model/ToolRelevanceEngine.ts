import Fuse from 'fuse.js';
import type { McpTool } from '../../domain/mcp';

export interface ToolRelevanceOptions {
  keywordBoost?: number;
  overlapBoost?: number;
  synonymBoost?: number;
  fuzzyMultiplier?: number;
  fuzzyThreshold?: number;
  domainBoosts?: Array<{ pattern: RegExp; userPattern: RegExp; boost: number }>;
  synonyms?: string[][]; // groups of synonyms
  triggerKeywords?: string[];
  maxTools?: number;
  trigramWeight?: number; // weight multiplier for language-agnostic trigram similarity
  enableTrigramSimilarity?: boolean;
}

export interface ScoredTool { tool: McpTool; score: number; }

export class ToolRelevanceEngine {
  private opts: Required<ToolRelevanceOptions>;
  private synonymLookup: Record<string,string[]> = {};

  constructor(options: ToolRelevanceOptions = {}) {
    this.opts = {
      keywordBoost: options.keywordBoost ?? 4,
      overlapBoost: options.overlapBoost ?? 1,
      synonymBoost: options.synonymBoost ?? 1.2,
      fuzzyMultiplier: options.fuzzyMultiplier ?? 8,
      fuzzyThreshold: options.fuzzyThreshold ?? 0.45,
      domainBoosts: options.domainBoosts ?? [],
      synonyms: options.synonyms ?? [],
      triggerKeywords: options.triggerKeywords ?? [],
      maxTools: options.maxTools ?? 15,
      trigramWeight: options.trigramWeight ?? 6,
      enableTrigramSimilarity: options.enableTrigramSimilarity ?? true
    };
    this.opts.synonyms.forEach(group => group.forEach(term => { this.synonymLookup[term] = group; }));
  }

  private normalize(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}+/gu, '')
      .replace(/ß/g, 'ss')
      .replace(/æ/g, 'ae')
      .replace(/œ/g, 'oe');
  }

  private trigramSet(text: string): Set<string> {
    const norm = this.normalize(text).replace(/[^a-z0-9]+/g, ' ');
    const compact = norm.replace(/\s+/g, ' ').trim();
    const trigrams = new Set<string>();
    if (compact.length < 3) return trigrams;
    for (let i = 0; i < compact.length - 2; i++) {
      trigrams.add(compact.slice(i, i + 3));
    }
    return trigrams;
  }

  private trigramSimilarity(a: string, b: string): number {
    const A = this.trigramSet(a);
    const B = this.trigramSet(b);
    if (!A.size || !B.size) return 0;
    let inter = 0;
    for (const t of A) if (B.has(t)) inter++;
    const union = A.size + B.size - inter;
    return union === 0 ? 0 : inter / union;
  }

  private expandTerms(text: string): string[] {
    const words = Array.from(new Set(text.split(/[^a-z0-9áéíóúüñ]+/i).filter(Boolean).map(w => w.toLowerCase())));
    const expanded = new Set<string>();
    words.forEach(w => {
      expanded.add(w);
      (this.synonymLookup[w] || []).forEach(s => expanded.add(s));
    });
    return Array.from(expanded);
  }

  score(userText: string, tools: McpTool[]): ScoredTool[] {
  const lowerUser = this.normalize(userText);
    const expandedTerms = this.expandTerms(lowerUser);
    const fuse = new Fuse(tools.map(t => ({ id: t.name, text: (t.name + ' ' + (t.description||'')).toLowerCase() })), {
      includeScore: true,
      threshold: this.opts.fuzzyThreshold,
      keys: ['text']
    });

    const scored: ScoredTool[] = tools.map(tool => {
  const haystackRaw = (tool.name + ' ' + (tool.description || '')).toLowerCase();
  const haystack = this.normalize(haystackRaw);
      let score = 0;
      // Keyword hits
      for (const kw of this.opts.triggerKeywords) {
        if (lowerUser.includes(kw) && haystack.includes(kw)) score += this.opts.keywordBoost;
        else if (haystack.includes(kw)) score += this.opts.overlapBoost;
      }
      // Synonyms
      for (const term of expandedTerms) {
        if (term.length < 3) continue;
        if (haystack.includes(term)) score += this.opts.synonymBoost;
      }
      // Fuzzy
      const fuseResult = [...fuse.search(tool.name), ...fuse.search(tool.description || '')];
      if (fuseResult.length) {
        const best = fuseResult.reduce((a: any, b: any) => a.score! < b.score! ? a : b);
        if (best.score !== undefined) score += Math.max(0, (0.6 - best.score) * this.opts.fuzzyMultiplier);
      }
      // Trigram similarity (language agnostic lexical overlap)
      if (this.opts.enableTrigramSimilarity) {
        const triSim = this.trigramSimilarity(lowerUser, haystack);
        if (triSim > 0) score += triSim * this.opts.trigramWeight;
      }
      // Domain boosts
      for (const db of this.opts.domainBoosts) {
        if (db.pattern.test(haystack) && db.userPattern.test(lowerUser)) score += db.boost;
      }
      return { tool, score };
    });

    scored.sort((a,b) => b.score - a.score);
    return scored;
  }

  select(userText: string, tools: McpTool[], max = this.opts.maxTools): McpTool[] {
    const scored = this.score(userText, tools);
    const positives = scored.filter(s => s.score > 0).map(s => s.tool);
    return (positives.length ? positives : []).slice(0, max);
  }
}
