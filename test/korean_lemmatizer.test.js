import { describe, it, expect } from 'vitest';
import '../src/nlp/korean_jamo.js';
import '../src/nlp/korean_lemmatizer.js';

describe('Korean Jamo Utility', () => {
  it('decomposes Hangul syllables into jamo components', () => {
    const decomposed = globalThis.KoreanJamo.decomposeChar('한');
    expect(decomposed.initial).toBe('ㅎ');
    expect(decomposed.vowel).toBe('ㅏ');
    expect(decomposed.final).toBe('ㄴ');
  });

  it('handles syllables without final consonants', () => {
    const decomposed = globalThis.KoreanJamo.decomposeChar('가');
    expect(decomposed.initial).toBe('ㄱ');
    expect(decomposed.vowel).toBe('ㅏ');
    expect(decomposed.final).toBe('');
  });
});

describe('Korean Lemmatizer Rule Engine', () => {
  it('strips common topic particles from surface forms', () => {
    const candidates = globalThis.KoreanLemmatizer.deconjugate('인구는');
    const texts = candidates.map(c => c.text);
    expect(texts).toContain('인구');
  });

  it('recovers base forms from polite verb endings', () => {
    const candidates = globalThis.KoreanLemmatizer.deconjugate('해요');
    const texts = candidates.map(c => c.text);
    expect(texts).toContain('하다');
  });

  it('recovers base forms from past tense endings', () => {
    const candidates = globalThis.KoreanLemmatizer.deconjugate('했다');
    const texts = candidates.map(c => c.text);
    expect(texts).toContain('하다');
  });

  it('recovers base forms from connective -고 endings', () => {
    const candidates = globalThis.KoreanLemmatizer.deconjugate('부르고');
    const texts = candidates.map(c => c.text);
    expect(texts).toContain('부르다');
  });

  it('deconjugates ㅡ-drop polite adjective endings (e.g. 배고파요 -> 배고프다)', () => {
    const candidates = globalThis.KoreanLemmatizer.deconjugate('배고파요');
    const texts = candidates.map(c => c.text);
    expect(texts).toContain('배고프다');
  });
});
