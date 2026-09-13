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

  it('deconjugates informal connective -아 endings (e.g. 작아 -> 작다)', () => {
    const candidates = globalThis.KoreanLemmatizer.deconjugate('작아');
    const texts = candidates.map(c => c.text);
    expect(texts).toContain('작다');
  });

  it('deconjugates propositive interrogative -ㄹ까요 (e.g. 갈까요 -> 가다)', () => {
    const candidates = globalThis.KoreanLemmatizer.deconjugate('갈까요');
    const texts = candidates.map(c => c.text);
    expect(texts).toContain('가다');
  });

  it('deconjugates vowel contraction in polite present -ㅏ endings (e.g. 들어가요 -> 들어가다)', () => {
    const candidates = globalThis.KoreanLemmatizer.deconjugate('들어가요');
    const texts = candidates.map(c => c.text);
    expect(texts).toContain('들어가다');
    // Ensure ㄷ-irregular does not over-match and generate 듣다
    expect(texts).not.toContain('듣다');
  });

  it('deconjugates past tense 르-irregular verbs (e.g. 골랐어요 -> 고르다, 불렀어요 -> 부르다)', () => {
    const candidates = globalThis.KoreanLemmatizer.deconjugate('골랐어요');
    const texts = candidates.map(c => c.text);
    expect(texts).toContain('고르다');

    const candidatesBulleo = globalThis.KoreanLemmatizer.deconjugate('불렀어요');
    expect(candidatesBulleo.map(c => c.text)).toContain('부르다');
  });

  it('deconjugates vowel contraction in -ㅐ stems (e.g. 꺼내요 -> 꺼내다, 보내요 -> 보내다)', () => {
    const candidates = globalThis.KoreanLemmatizer.deconjugate('꺼내요');
    const texts = candidates.map(c => c.text);
    expect(texts).toContain('꺼내다');
  });

  it('deconjugates vowel contraction in -ㅣ stems (e.g. 기다려요 -> 기다리다, 마셔요 -> 마시다)', () => {
    const candidates = globalThis.KoreanLemmatizer.deconjugate('기다려요');
    const texts = candidates.map(c => c.text);
    expect(texts).toContain('기다리다');

    const candidatesMasyeo = globalThis.KoreanLemmatizer.deconjugate('마셔요');
    expect(candidatesMasyeo.map(c => c.text)).toContain('마시다');
  });
});

describe('Korean Pipeline Compound & Subword Decomposition', () => {
  it('decomposes modifier-noun phrases (e.g. 매운라면 -> 맵다, 매운, 라면)', async () => {
    const pipeline = await import('../src/nlp/korean_pipeline.js');
    const KoreanPipeline = pipeline.default || globalThis.KoreanPipeline;
    const candidates = KoreanPipeline.analyzeKoreanWord('매운라면');
    const texts = candidates.map(c => c.text);
    expect(texts).toContain('맵다');
    expect(texts).toContain('매운');
    expect(texts).toContain('라면');
  });

  it('decomposes compound nouns (e.g. 얼음컵 -> 얼음, 컵)', async () => {
    const pipeline = await import('../src/nlp/korean_pipeline.js');
    const KoreanPipeline = pipeline.default || globalThis.KoreanPipeline;
    const candidates = KoreanPipeline.analyzeKoreanWord('얼음컵');
    const texts = candidates.map(c => c.text);
    expect(texts).toContain('얼음');
    expect(texts).toContain('컵');
  });

  it('correctly deconjugates -하는/-되는 verbs to -하다/-되다 and root noun without spurious ㄹ-drop (e.g. 지지하는 -> 지지하다, 지지)', async () => {
    const pipeline = await import('../src/nlp/korean_pipeline.js');
    const KoreanPipeline = pipeline.default || globalThis.KoreanPipeline;
    const candidates = KoreanPipeline.analyzeKoreanWord('지지하는');
    const texts = candidates.map(c => c.text);
    expect(texts).toContain('지지하다');
    expect(texts).toContain('지지');
    expect(texts).not.toContain('지지할다');
    expect(texts).not.toContain('지지하');
    expect(texts).not.toContain('지');
  });

  it('correctly deconjugates 공부하는 and 시작되는', async () => {
    const pipeline = await import('../src/nlp/korean_pipeline.js');
    const KoreanPipeline = pipeline.default || globalThis.KoreanPipeline;
    const candidatesGongbu = KoreanPipeline.analyzeKoreanWord('공부하는');
    const textsGongbu = candidatesGongbu.map(c => c.text);
    expect(textsGongbu).toContain('공부하다');
    expect(textsGongbu).toContain('공부');
    expect(textsGongbu).not.toContain('공부할다');

    const candidatesSijak = KoreanPipeline.analyzeKoreanWord('시작되는');
    const textsSijak = candidatesSijak.map(c => c.text);
    expect(textsSijak).toContain('시작되다');
    expect(textsSijak).toContain('시작');
    expect(textsSijak).not.toContain('시작될다');
  });

  it('deconjugates adjective conjecture 맛있겠다 -> 맛있다 and emits -겠다 grammar ending', async () => {
    const pipeline = await import('../src/nlp/korean_pipeline.js');
    const KoreanPipeline = pipeline.default || globalThis.KoreanPipeline;
    const candidates = KoreanPipeline.analyzeKoreanWord('맛있겠다');
    const texts = candidates.map(c => c.text);
    expect(texts).toContain('맛있다');
    expect(texts.some(t => t.includes('겠다'))).toBe(true);
  });

  it('deconjugates verb conjecture 먹겠다 -> 먹다 and polite 가겠어요 -> 가다', async () => {
    const pipeline = await import('../src/nlp/korean_pipeline.js');
    const KoreanPipeline = pipeline.default || globalThis.KoreanPipeline;
    expect(KoreanPipeline.analyzeKoreanWord('먹겠다').map(c => c.text)).toContain('먹다');
    expect(KoreanPipeline.analyzeKoreanWord('가겠어요').map(c => c.text)).toContain('가다');
    expect(KoreanPipeline.analyzeKoreanWord('하겠습니다').map(c => c.text)).toContain('하다');
    expect(KoreanPipeline.analyzeKoreanWord('했겠다').map(c => c.text)).toContain('하다');
    expect(KoreanPipeline.analyzeKoreanWord('좋겠다').map(c => c.text)).toContain('좋다');
    expect(KoreanPipeline.analyzeKoreanWord('알겠어').map(c => c.text)).toContain('알다');
  });

  it('strips particle 에서 from 세상에서 and emits BOTH 세상 and 에서 as candidates', async () => {
    const pipeline = await import('../src/nlp/korean_pipeline.js');
    const KoreanPipeline = pipeline.default || globalThis.KoreanPipeline;
    const candidates = KoreanPipeline.analyzeKoreanWord('세상에서');
    const texts = candidates.map(c => c.text);
    expect(texts).toContain('세상');
    expect(texts).toContain('에서');
    expect(texts).not.toContain('세상에서다');
  });

  it('strips quotative particle 이란 from 탓이란 and emits 탓 and 이란/란', async () => {
    const pipeline = await import('../src/nlp/korean_pipeline.js');
    const KoreanPipeline = pipeline.default || globalThis.KoreanPipeline;
    const candidates = KoreanPipeline.analyzeKoreanWord('탓이란');
    const texts = candidates.map(c => c.text);
    expect(texts).toContain('탓');
    expect(texts.some(t => t === '이란' || t === '란')).toBe(true);
  });

  it('deconjugates intent modifier 하려는 -> 하다 and 돌아가려는 -> 돌아가다', async () => {
    const pipeline = await import('../src/nlp/korean_pipeline.js');
    const KoreanPipeline = pipeline.default || globalThis.KoreanPipeline;
    const c1 = KoreanPipeline.analyzeKoreanWord('하려는');
    expect(c1.map(c => c.text)).toContain('하다');
    expect(c1.map(c => c.text)).toContain('려는');

    const c2 = KoreanPipeline.analyzeKoreanWord('돌아가려는');
    expect(c2.map(c => c.text)).toContain('돌아가다');
  });

  it('deconjugates ㅂ-irregular 부끄러워 -> 부끄럽다 without generating spurious 부끄러우다', async () => {
    const pipeline = await import('../src/nlp/korean_pipeline.js');
    const KoreanPipeline = pipeline.default || globalThis.KoreanPipeline;
    const candidates = KoreanPipeline.analyzeKoreanWord('부끄러워');
    const texts = candidates.map(c => c.text);
    expect(texts).toContain('부끄럽다');
    expect(texts).not.toContain('부끄러우다');
  });

  it('deconjugates compound verb 빠져나가지 -> 빠져나가다 with high confidence', async () => {
    const pipeline = await import('../src/nlp/korean_pipeline.js');
    const KoreanPipeline = pipeline.default || globalThis.KoreanPipeline;
    const candidates = KoreanPipeline.analyzeKoreanWord('빠져나가지');
    const texts = candidates.map(c => c.text);
    expect(texts).toContain('빠져나가다');
  });

  it('deconjugates past question ㅎ-irregular 그랬냐 -> 그렇다', async () => {
    const pipeline = await import('../src/nlp/korean_pipeline.js');
    const KoreanPipeline = pipeline.default || globalThis.KoreanPipeline;
    const candidates = KoreanPipeline.analyzeKoreanWord('그랬냐');
    const texts = candidates.map(c => c.text);
    expect(texts).toContain('그렇다');
  });
});
