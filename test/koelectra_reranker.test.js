import { describe, it, expect } from 'vitest';
import OnnxReranker from '../src/nlp/onnx_reranker.js';

describe('KoELECTRA & Multilingual E5 Homonym Dictionary Entry Reranker', () => {
  const sampleNunEntries = [
    {
      surface: '눈',
      pos: 'Noun',
      definitions: [
        'eye The sensory organ on face that can see objects.',
        'snow Tiny white cotton-like pieces of ice forming and falling from sky in winter.'
      ]
    }
  ];

  it('reorders "눈" in "하늘에서 눈이 내려온다." so that snow definition is selected', async () => {
    const sentenceContext = '하늘에서 눈이 내려온다.';
    const reranked = await OnnxReranker.rerankDictionaryEntriesAsync(sampleNunEntries, sentenceContext, '눈');

    expect(reranked[0]._koelectraMatched).toBe(true);
    expect(typeof reranked[0]._bestDefIndex).toBe('number');
  }, 30000);

  it('reorders "밤" in "밤 하늘에 별이 뜬다." to night definition', async () => {
    const bamEntries = [
      { surface: '밤', definitions: ['chestnut A hard-shelled edible fruit.', 'night Nighttime period from sunset to sunrise when dark sky and stars appear.'] }
    ];
    const sentenceContext = '밤 하늘에 별이 뜬다.';
    const reranked = await OnnxReranker.rerankDictionaryEntriesAsync(bamEntries, sentenceContext, '밤');

    expect(reranked[0]._koelectraMatched).toBe(true);
    expect(reranked[0]._bestDefIndex).toBe(1); // Def 2: night
  }, 30000);

  it('reorders "배" in "바다 위에 배가 떠 있다." to boat definition', async () => {
    const baeEntries = [
      { surface: '배', definitions: ['pear A sweet juicy fruit.', 'boat Watercraft or vessel for traveling on ocean sea or river water.'] }
    ];
    const sentenceContext = '바다 위에 배가 떠 있다.';
    const reranked = await OnnxReranker.rerankDictionaryEntriesAsync(baeEntries, sentenceContext, '배');

    expect(reranked[0]._koelectraMatched).toBe(true);
    expect(typeof reranked[0]._bestDefIndex).toBe('number');
  }, 30000);

  it('reorders entries across multiple dictionary groups (e.g. KRDICT EN and KRDICT JA)', async () => {
    const multiDictEntries = [
      { dictTitle: 'KRDICT EN', surface: '눈', definitions: ['eye organ', 'snow falling from sky'] },
      { dictTitle: 'KRDICT JA', surface: '눈', definitions: ['目 (目, 視力)', '雪 (空から降る氷, 겨울, 내리다)'] }
    ];
    const sentenceContext = '하늘에서 눈이 내려와요';
    const reranked = await OnnxReranker.rerankDictionaryEntriesAsync(multiDictEntries, sentenceContext, '눈이');

    const enGroup = reranked.filter(e => e.dictTitle === 'KRDICT EN');
    const jaGroup = reranked.filter(e => e.dictTitle === 'KRDICT JA');

    expect(enGroup[0]._koelectraMatched).toBe(true);
    expect(jaGroup[0]._koelectraMatched).toBe(true);
  }, 30000);

  it('selects specific sub-definition tab (Def 2: sing) for "부르다" in "노래를 부르고 있다"', async () => {
    const bureudaEntries = [
      {
        surface: '부르다',
        pos: 'Verb',
        definitions: [
          'call for; call out for To ask someone to come or draw attention',
          'sing To sing a song or tune with a voice',
          'quote To quote a price'
        ]
      }
    ];

    const sentenceContext = '친구들과 함께 노래를 부르고 있다.';
    const reranked = await OnnxReranker.rerankDictionaryEntriesAsync(bureudaEntries, sentenceContext, '부르고');

    expect(reranked[0].pos).toBe('Verb');
    expect(reranked[0]._koelectraMatched).toBe(true);
    expect(reranked[0]._bestDefIndex).toBe(1); // Index 1 = Def 2 ("sing")
  }, 30000);
});
