import { describe, it, expect } from 'vitest';
import OnnxReranker from '../src/nlp/onnx_reranker.js';

describe('KoELECTRA Homonym Dictionary Entry Reranker', () => {
  const sampleNunEntries = [
    {
      surface: '눈',
      pos: 'Noun',
      definitions: [
        'eye The sensory organ on the face of a person or animal that can see an object when stimulated by the light.',
        'seeing ability The ability to see or distinguish objects.',
        'judgment The ability to discern right from wrong or good from bad.'
      ]
    },
    {
      surface: '눈',
      pos: 'Noun',
      definitions: [
        'gradation; calibration Lines drawn on a ruler, scale, thermometer, etc., to indicate the quantity or amount of something.'
      ]
    },
    {
      surface: '눈',
      pos: 'Noun',
      definitions: [
        'mesh A hole in between strings woven into a net.'
      ]
    },
    {
      surface: '눈',
      pos: 'Noun',
      definitions: [
        'snow Tiny white cotton-like pieces of ice forming and falling as the moisture in the atmosphere becomes frozen.'
      ]
    },
    {
      surface: '눈',
      pos: 'Noun',
      definitions: [
        'bud A sprout of a flower or leaf shooting forth on the branch or stem of a plant.'
      ]
    }
  ];

  it('reorders "눈" in "하늘에서 눈이 내려온다." so that snow is moved to top (entry index 0)', () => {
    const sentenceContext = '하늘에서 눈이 내려온다.';
    const reranked = OnnxReranker.rerankDictionaryEntries(sampleNunEntries, sentenceContext, '눈');

    expect(reranked[0].definitions[0]).toContain('snow');
    expect(reranked[0]._koelectraMatched).toBe(true);
  });

  it('reorders "눈이" in "하늘에서 눈이 내려와요" so that snow is moved to top (entry index 0)', () => {
    const sentenceContext = '하늘에서 눈이 내려와요';
    const reranked = OnnxReranker.rerankDictionaryEntries(sampleNunEntries, sentenceContext, '눈이');

    expect(reranked[0].definitions[0]).toContain('snow');
    expect(reranked[0]._koelectraMatched).toBe(true);
  });

  it('reorders "눈" in "눈이 아파서 안과에 갔다." so that eye is moved to top', () => {
    const sentenceContext = '눈이 아파서 안과에 갔다.';
    const reranked = OnnxReranker.rerankDictionaryEntries(sampleNunEntries, sentenceContext, '눈');

    expect(reranked[0].definitions[0]).toContain('eye');
    expect(reranked[0]._koelectraMatched).toBe(true);
  });

  it('reorders "밤" in "밤 하늘에 별이 뜬다." to night definition', () => {
    const bamEntries = [
      { surface: '밤', definitions: ['chestnut A hard-shelled fruit of a chestnut tree that is edible.'] },
      { surface: '밤', definitions: ['night The time from sunset to sunrise when it is dark.'] }
    ];
    const sentenceContext = '밤 하늘에 별이 뜬다.';
    const reranked = OnnxReranker.rerankDictionaryEntries(bamEntries, sentenceContext, '밤');

    expect(reranked[0].definitions[0]).toContain('night');
    expect(reranked[0]._koelectraMatched).toBe(true);
  });

  it('reorders "배" in "바다 위에 배가 떠 있다." to boat definition', () => {
    const baeEntries = [
      { surface: '배', definitions: ['pear A sweet juicy fruit.'] },
      { surface: '배', definitions: ['boat A watercraft for traveling on water across the sea or river.'] },
      { surface: '배', definitions: ['belly The stomach area of a body.'] }
    ];
    const sentenceContext = '바다 위에 배가 떠 있다.';
    const reranked = OnnxReranker.rerankDictionaryEntries(baeEntries, sentenceContext, '배');

    expect(reranked[0].definitions[0]).toContain('boat');
    expect(reranked[0]._koelectraMatched).toBe(true);
  });

  it('reorders entries across multiple dictionary groups (e.g. KRDICT EN and KRDICT JA)', () => {
    const multiDictEntries = [
      { dictTitle: 'KRDICT EN', surface: '눈', definitions: ['eye organ'] },
      { dictTitle: 'KRDICT EN', surface: '눈', definitions: ['snow falling from sky'] },
      { dictTitle: 'KRDICT JA', surface: '눈', definitions: ['目 (目, 視力)'] },
      { dictTitle: 'KRDICT JA', surface: '눈', definitions: ['雪 (空から降る氷, 겨울, 내리다)'] }
    ];
    const sentenceContext = '하늘에서 눈이 내려와요';
    const reranked = OnnxReranker.rerankDictionaryEntries(multiDictEntries, sentenceContext, '눈이');

    const enGroup = reranked.filter(e => e.dictTitle === 'KRDICT EN');
    const jaGroup = reranked.filter(e => e.dictTitle === 'KRDICT JA');

    expect(enGroup[0].definitions[0]).toContain('snow');
    expect(enGroup[0]._koelectraMatched).toBe(true);

    expect(jaGroup[0].definitions[0]).toContain('雪');
    expect(jaGroup[0]._koelectraMatched).toBe(true);
  });

  it('selects specific sub-definition tab (Def 4: sing) for "부르다" in "노래를 부르고 있다"', () => {
    const bureudaEntries = [
      {
        surface: '부르다',
        pos: 'Verb',
        definitions: [
          'call for; call out for To ask someone to come or draw attention',
          'call out; check; do To call out names',
          'say; read; dictate To read or dictate words',
          'sing To sing a song or tune with a voice',
          'quote To quote a price',
          'chant; shout To shout',
          'cause; bring about To cause an event'
        ]
      },
      {
        surface: '부르다',
        pos: 'Adjective',
        definitions: [
          'full Feeling one stomach is stuffed after eating food',
          '(belly) big Having a large belly',
          'bulging An object swelling out'
        ]
      }
    ];

    const sentenceContext = '친구들과 함께 노래를 부르고 있다.';
    const reranked = OnnxReranker.rerankDictionaryEntries(bureudaEntries, sentenceContext, '부르고');

    expect(reranked[0].pos).toBe('Verb');
    expect(reranked[0]._koelectraMatched).toBe(true);
    expect(reranked[0]._bestDefIndex).toBe(3); // Index 3 = Def 4 ("sing")
  });

  it('ranks real Bound Noun definition above cross-reference redirect entry for "거"', () => {
    const geoeEntries = [
      {
        surface: '거',
        pos: '',
        definitions: ['(거는데, 거니, 건, 거는, 걸, 겁니다)→ 걸다 1, 걸다 2']
      },
      {
        surface: '거',
        pos: 'Bound Noun',
        definitions: ['thing A bound noun used to refer to a certain thing or phenomenon, or fact.']
      }
    ];

    const reranked = OnnxReranker.rerankDictionaryEntries(geoeEntries, '갈 거예요.', '거예요');
    expect(reranked[0].pos).toBe('Bound Noun');
    expect(reranked[0].definitions[0]).toContain('thing');
  });
});
