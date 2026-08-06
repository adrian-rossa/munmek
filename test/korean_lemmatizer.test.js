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

  it('strips locative particle -에 (e.g. 편의점에 -> 편의점)', () => {
    const results = globalThis.KoreanLemmatizer.stripParticles('편의점에');
    const stems = results.map(r => r.stem);
    expect(stems).toContain('편의점');
  });

  it('strips compound particles -에도 and -께 (e.g. 학교에도 -> 학교, 선생님께 -> 선생님)', () => {
    const resultsEdo = globalThis.KoreanLemmatizer.stripParticles('학교에도');
    expect(resultsEdo.map(r => r.stem)).toContain('학교');

    const resultsKke = globalThis.KoreanLemmatizer.stripParticles('선생님께');
    expect(resultsKke.map(r => r.stem)).toContain('선생님');
  });

  it('strips copula -예요 (e.g.예요 -> 거)', () => {
    const results = globalThis.KoreanLemmatizer.stripParticles('거예요');
    expect(results.map(r => r.stem)).toContain('거');
  });
});
