import { describe, it, expect } from 'vitest';
import OnnxReranker from '../src/nlp/onnx_reranker.js';

describe('Two-Stage Neural Pipeline: Candidate Deinflection & Multilingual Dictionary Sense Reranker', () => {
  describe('Stage 1: Korean Candidate Lemma Deinflection Reranker (KoELECTRA)', () => {
    it('ranks candidate lemmas based on Korean sentence context (e.g. 듣다 vs 들다)', async () => {
      const candidates = [
        { text: '들다', reason: 'lemma fallback', score: 50 },
        { text: '듣다', reason: 'lemma match', score: 50 }
      ];
      const sentenceContext = '음악을 크게 듣고 있어요.';

      const reranked = await OnnxReranker.rerankCandidatesAsync(candidates, sentenceContext);

      expect(reranked[0].text).toBe('듣다');
      expect(reranked[0].reason).toMatch(/Boost/);
    }, 30000);

    it('ranks candidate lemmas for construction verbs (e.g. 짓다 vs 지다)', async () => {
      const candidates = [
        { text: '지다', reason: 'lemma match', score: 50 },
        { text: '짓다', reason: 'lemma match', score: 50 }
      ];
      const sentenceContext = '목수가 새로운 집을 짓고 계십니다.';

      const reranked = await OnnxReranker.rerankCandidatesAsync(candidates, sentenceContext);

      expect(reranked[0].text).toBe('짓다');
    }, 30000);
  });

  describe('Stage 2: Multilingual Dictionary Sense & Tab Reranker (Multilingual Model)', () => {
    it('correctly ranks homonym entries and preselects specific definition tab (Def 2: sing) for 부르다 in English dictionary', async () => {
      const bureudaEntries = [
        {
          dictTitle: 'KRDICT EN',
          surface: '부르다',
          pos: 'Verb',
          definitions: [
            'call for; call out for To ask someone to come or draw attention',
            'sing To sing a song or tune with a voice',
            'quote To quote a price'
          ]
        }
      ];

      const sentenceContext = '가수가 무대 위에서 아름다운 노래를 부르고 있다.';
      const reranked = await OnnxReranker.rerankDictionaryEntriesAsync(bureudaEntries, sentenceContext, '부르고');

      expect(reranked[0]._koelectraMatched).toBe(true);
      expect(reranked[0]._bestDefIndex).toBe(1); // Def 2 ("sing")
    }, 30000);

    it('correctly ranks homonym entries and preselects specific definition tab for 부르다 in Japanese dictionary (KRDICT JA)', async () => {
      const bureudaEntriesJa = [
        {
          dictTitle: 'KRDICT JA',
          surface: '부르다',
          pos: 'Verb',
          definitions: [
            '呼ぶ【よぶ】 人を来させる',
            '歌う【うたう】 節をつけて声で歌を歌う',
            '唱える【となえる】'
          ]
        }
      ];

      const sentenceContext = '아이들이 신나게 노래를 부르고 있다.';
      const reranked = await OnnxReranker.rerankDictionaryEntriesAsync(bureudaEntriesJa, sentenceContext, '부르고');

      expect(reranked[0]._koelectraMatched).toBe(true);
      expect(reranked[0]._bestDefIndex).toBe(1); // Index 1 = 歌う ("sing")
    }, 30000);

    it('ranks dictionary entries for full stomach sense when context is food/eating', async () => {
      const bureudaEntries = [
        {
          dictTitle: 'KRDICT EN',
          surface: '부르다',
          pos: 'Adjective',
          definitions: [
            'full Feeling one stomach is stuffed after eating food'
          ]
        },
        {
          dictTitle: 'KRDICT EN',
          surface: '부르다',
          pos: 'Verb',
          definitions: [
            'sing To sing a song with a voice'
          ]
        }
      ];

      const sentenceContext = '점심을 많이 먹어서 배가 부르고 고통스럽다.';
      const reranked = await OnnxReranker.rerankDictionaryEntriesAsync(bureudaEntries, sentenceContext, '부르고');

      expect(reranked[0]._koelectraMatched).toBe(true);
      expect(reranked[0]._bestDefIndex).toBe(0); // Def 1 ("full")
    }, 30000);

    it('processes single-entry dictionary lookups and sets _bestDefIndex for sub-definition tab selection', async () => {
      const singleEntry = [
        {
          dictTitle: 'KRDICT EN',
          surface: '쓰다',
          pos: 'Verb',
          definitions: [
            'wear To wear a hat or glasses on face',
            'use To use money or time or tools',
            'write To write or record words or text on paper with a pen or pencil'
          ]
        }
      ];

      const sentenceContext = '학생이 공책에 연필로 글을 쓰고 있다.';
      const reranked = await OnnxReranker.rerankDictionaryEntriesAsync(singleEntry, sentenceContext, '쓰고');

      expect(reranked[0]._koelectraMatched).toBe(true);
      expect(typeof reranked[0]._bestDefIndex).toBe('number');
    }, 30000);

    it('asynchronously reranks dictionary entries and sets _bestDefIndex using rerankDictionaryEntriesAsync', async () => {
      const singleEntry = [
        {
          dictTitle: 'KRDICT EN',
          surface: '부르다',
          pos: 'Verb',
          definitions: [
            'call for; call out for To ask someone to come or draw attention',
            'sing To sing a song or tune with a voice',
            'quote To quote a price'
          ]
        }
      ];

      const sentenceContext = '무대에서 노래를 부르고 있다.';
      const reranked = await OnnxReranker.rerankDictionaryEntriesAsync(singleEntry, sentenceContext, '부르고');

      expect(reranked[0]._koelectraMatched).toBe(true);
      expect(reranked[0]._bestDefIndex).toBe(1); // Def 2 ("sing")
    }, 30000);

    it('correctly matches naming/calling sense (Def 1: call) for "부르고" in Wikipedia sentence "한국어라고 부르고"', async () => {
      const bureudaEntries = [
        {
          dictTitle: 'KRDICT EN',
          surface: '부르다',
          pos: 'Verb',
          definitions: [
            'call; refer to by name To call or refer to someone or something by a name in a language',
            'sing To sing a song or tune with a voice',
            'quote To quote a price'
          ]
        }
      ];

      const wikipediaSentence = '대한민국에서는 한국어라고 부르고, 조선민주주의인민공화국에서는 조선말이라고 한다.';
      const reranked = await OnnxReranker.rerankDictionaryEntriesAsync(bureudaEntries, wikipediaSentence, '부르고');

      expect(reranked[0]._koelectraMatched).toBe(true);
      expect(reranked[0]._bestDefIndex).toBe(0); // Def 1 ("call")
    }, 30000);

    it('verifies Stage 0 produces no heuristic confidence score and Stage 2 attaches real confidence & timing metadata', async () => {
      const rawEntries = [
        {
          dictTitle: 'KRDICT EN',
          surface: '부르다',
          pos: 'Verb',
          definitions: [
            'call for; call out for To ask someone to come or draw attention',
            'sing To sing a song or tune with a voice'
          ]
        }
      ];

      // Stage 0 (synchronous local dictionary lookup)
      const stage0Hits = OnnxReranker.rerankDictionaryEntries(rawEntries, '노래를 부르고 있다', '부르고');
      expect(stage0Hits[0]._confidenceScore).toBeUndefined();
      expect(stage0Hits[0]._defConfidenceScores).toBeUndefined();

      // Stage 2 (async neural definition rerank)
      const stage2Hits = await OnnxReranker.rerankDictionaryEntriesAsync(rawEntries, '노래를 부르고 있다', '부르고');
      expect(stage2Hits[0]._confidenceScore).toBeDefined();
      expect(stage2Hits[0]._defConfidenceScores).toBeDefined();
      expect(stage2Hits[0]._timing).toBeDefined();
      expect(typeof stage2Hits[0]._timing.queryMs).toBe('number');
      expect(typeof stage2Hits[0]._timing.passageMs).toBe('number');
      expect(typeof stage2Hits[0]._timing.precomputedHits).toBe('number');
      expect(stage2Hits[0]._timing.precomputedHits).toBeGreaterThanOrEqual(0);
    }, 30000);
  });
});
