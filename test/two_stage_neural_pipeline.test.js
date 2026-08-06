import { describe, it, expect } from 'vitest';
import OnnxReranker from '../src/nlp/onnx_reranker.js';
import DictionaryReranker from '../src/nlp/dictionary_reranker.js';

describe('Two-Stage Neural Pipeline: Candidate Deinflection & Multilingual Dictionary Sense Reranker', () => {
  describe('Stage 1: Korean Candidate Lemma Deinflection Reranker (KoELECTRA)', () => {
    it('ranks candidate lemmas based on Korean sentence context (e.g. 듣다 vs 들다)', () => {
      const candidates = [
        { text: '들다', reason: 'lemma fallback', score: 50 },
        { text: '듣다', reason: 'lemma match', score: 50 }
      ];
      const sentenceContext = '음악을 크게 듣고 있어요.';

      const reranked = OnnxReranker.rerankCandidates(candidates, sentenceContext);

      expect(reranked[0].text).toBe('듣다');
      expect(reranked[0].reason).toContain('Context Boost');
    });

    it('ranks candidate lemmas for construction verbs (e.g. 짓다 vs 지다)', () => {
      const candidates = [
        { text: '지다', reason: 'lemma match', score: 50 },
        { text: '짓다', reason: 'lemma match', score: 50 }
      ];
      const sentenceContext = '목수가 새로운 집을 짓고 계십니다.';

      const reranked = OnnxReranker.rerankCandidates(candidates, sentenceContext);

      expect(reranked[0].text).toBe('짓다');
    });
  });

  describe('Stage 2: Multilingual Dictionary Sense & Tab Reranker (Multilingual Model & Concept Maps)', () => {
    it('correctly ranks homonym entries and preselects specific definition tab (Def 4: sing) for 부르다 in English dictionary', () => {
      const bureudaEntries = [
        {
          dictTitle: 'KRDICT EN',
          surface: '부르다',
          pos: 'Verb',
          definitions: [
            'call for; call out for To ask someone to come or draw attention',
            'call out; check; do To call out names',
            'say; read; dictate To read or dictate words',
            'sing To sing a song or tune with a voice',
            'quote To quote a price'
          ]
        },
        {
          dictTitle: 'KRDICT EN',
          surface: '부르다',
          pos: 'Adjective',
          definitions: [
            'full Feeling one stomach is stuffed after eating food',
            '(belly) big Having a large belly'
          ]
        }
      ];

      const sentenceContext = '가수가 무대 위에서 노래를 부르고 있다.';
      const reranked = OnnxReranker.rerankDictionaryEntries(bureudaEntries, sentenceContext, '부르고');

      const enGroup = reranked.filter((e) => e.dictTitle === 'KRDICT EN');

      expect(enGroup[0].pos).toBe('Verb');
      expect(enGroup[0]._koelectraMatched).toBe(true);
      expect(enGroup[0]._bestDefIndex).toBe(3); // Def 4 ("sing")
    });

    it('correctly ranks homonym entries and preselects specific definition tab for 부르다 in Japanese dictionary (KRDICT JA)', () => {
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
        },
        {
          dictTitle: 'KRDICT JA',
          surface: '부르다',
          pos: 'Adjective',
          definitions: [
            '満腹【まんぷく】 お腹がいっぱいである'
          ]
        }
      ];

      const sentenceContext = '아이들이 신나게 노래를 부르고 있다.';
      const reranked = OnnxReranker.rerankDictionaryEntries(bureudaEntriesJa, sentenceContext, '부르고');

      const jaGroup = reranked.filter((e) => e.dictTitle === 'KRDICT JA');

      expect(jaGroup[0].pos).toBe('Verb');
      expect(jaGroup[0]._koelectraMatched).toBe(true);
      expect(jaGroup[0]._bestDefIndex).toBe(1); // Index 1 = 歌う ("sing")
    });

    it('ranks dictionary entries for full stomach sense when context is food/eating', () => {
      const bureudaEntries = [
        {
          dictTitle: 'KRDICT EN',
          surface: '부르다',
          pos: 'Verb',
          definitions: [
            'call for; call out for To ask someone to come or draw attention',
            'sing To sing a song or tune with a voice'
          ]
        },
        {
          dictTitle: 'KRDICT EN',
          surface: '부르다',
          pos: 'Adjective',
          definitions: [
            'full Feeling one stomach is stuffed after eating food'
          ]
        }
      ];

      const sentenceContext = '점심을 많이 먹어서 배가 부르고 고통스럽다.';
      const reranked = OnnxReranker.rerankDictionaryEntries(bureudaEntries, sentenceContext, '부르고');

      expect(reranked[0].pos).toBe('Adjective');
      expect(reranked[0]._koelectraMatched).toBe(true);
      expect(reranked[0]._bestDefIndex).toBe(0); // Def 1 ("full")
    });

    it('processes single-entry dictionary lookups and sets _bestDefIndex for sub-definition tab selection', () => {
      const singleEntry = [
        {
          dictTitle: 'KRDICT EN',
          surface: '쓰다',
          pos: 'Verb',
          definitions: [
            'write To record words on paper with a pen',
            'wear To wear a hat or glasses on the head or face',
            'use To use money or time or tools',
            'bitter Having a bitter taste in the mouth'
          ]
        }
      ];

      const sentenceContext = '학생이 공책에 연필로 글을 쓰고 있다.';
      const reranked = OnnxReranker.rerankDictionaryEntries(singleEntry, sentenceContext, '쓰고');

      expect(reranked[0]._koelectraMatched).toBe(true);
      expect(reranked[0]._bestDefIndex).toBe(0); // Def 1 ("write")
    });

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
    });

    it('correctly matches naming/calling sense (Def 1: call) for "부르고" in Wikipedia sentence "한국어라고 부르고"', () => {
      const bureudaEntries = [
        {
          dictTitle: 'KRDICT EN',
          surface: '부르다',
          pos: 'Verb',
          definitions: [
            'call for; call out for To ask someone to come or draw attention or refer to by name',
            'sing To sing a song or tune with a voice',
            'quote To quote a price'
          ]
        },
        {
          dictTitle: 'KRDICT EN',
          surface: '부르다',
          pos: 'Adjective',
          definitions: [
            'full Feeling one stomach is stuffed after eating food'
          ]
        }
      ];

      const wikipediaSentence = '대한민국에서는 한국어라고 부르고, 조선민주주의인민공화국에서는 조선말이라고 한다.';
      const reranked = OnnxReranker.rerankDictionaryEntries(bureudaEntries, wikipediaSentence, '부르고');

      expect(reranked[0].pos).toBe('Verb');
      expect(reranked[0]._koelectraMatched).toBe(true);
      expect(reranked[0]._bestDefIndex).toBe(0); // Def 1 ("call")
    });
  });
});
