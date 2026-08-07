import { describe, it, expect } from 'vitest';
import OnnxReranker from '../src/nlp/onnx_reranker.js';

describe('Synthetic Evaluation Suite for Pure Neural NLP Pipeline (KoELECTRA & Multilingual E5)', () => {
  it('achieves >= 70% accuracy on Multilingual E5 definition sense disambiguation across multilingual test cases', async () => {
    const testCases = [
      {
        description: 'Naming / Calling sense for 부르고 in Wikipedia sentence (EN)',
        sentence: '대한민국에서는 한국어라고 부르고, 조선민주주의인민공화국에서는 조선말이라고 한다.',
        word: '부르고',
        expectedDefIndex: 0, // Def 1: call / name
        entries: [
          {
            dictTitle: 'KRDICT EN',
            surface: '부르다',
            pos: 'Verb',
            definitions: [
              'call for; call out for; gesture To ask someone to come or draw attention or refer to by name',
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
        ]
      },
      {
        description: 'Singing sense for 부르고 in music sentence (EN)',
        sentence: '가수가 무대 위에서 아름다운 노래를 부르고 있다.',
        word: '부르고',
        expectedDefIndex: 1, // Def 2: sing
        entries: [
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
        ]
      },
      {
        description: 'Full stomach sense for 부르고 in eating sentence (EN)',
        sentence: '점심을 많이 먹어서 배가 부르고 아프다.',
        word: '부르고',
        expectedDefIndex: 0, // Adjective Def 1: full stomach
        entries: [
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
        ]
      },
      {
        description: 'Writing sense for 쓰고 in writing sentence (EN)',
        sentence: '학생이 연필로 공책에 글을 쓰고 있다.',
        word: '쓰고',
        expectedDefIndex: 0, // Def 1: write
        entries: [
          {
            dictTitle: 'KRDICT EN',
            surface: '쓰다',
            pos: 'Verb',
            definitions: [
              'write To record words or text on paper with a pen',
              'wear To wear a hat or glasses on head or face',
              'use To use money or time or tools'
            ]
          }
        ]
      },
      {
        description: 'Wearing sense for 쓰고 in eyewear sentence (EN)',
        sentence: '햇빛이 너무 강해서 멋진 안경을 쓰고 나갔다.',
        word: '쓰고',
        expectedDefIndex: 1, // Def 2: wear glasses
        entries: [
          {
            dictTitle: 'KRDICT EN',
            surface: '쓰다',
            pos: 'Verb',
            definitions: [
              'write To record words on paper with a pen',
              'wear To wear a hat or glasses on head or face',
              'use To use money or time'
            ]
          }
        ]
      },
      {
        description: 'Bitter taste sense for 쓰고 in medicine sentence (EN)',
        sentence: '약이 너무 쓰고 맛이 없어요.',
        word: '쓰고',
        expectedDefIndex: 0, // Adjective Def 1: bitter taste
        entries: [
          {
            dictTitle: 'KRDICT EN',
            surface: '쓰다',
            pos: 'Adjective',
            definitions: [
              'bitter Having a bitter taste in mouth when taking medicine'
            ]
          },
          {
            dictTitle: 'KRDICT EN',
            surface: '쓰다',
            pos: 'Verb',
            definitions: [
              'write To record words on paper'
            ]
          }
        ]
      },
      {
        description: 'Japanese dictionary singing sense (JA)',
        sentence: '아이들이 신나게 노래를 부르고 있다.',
        word: '부르고',
        expectedDefIndex: 1, // Def 2: 歌う (sing)
        entries: [
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
        ]
      }
    ];

    let correctCount = 0;

    for (const testCase of testCases) {
      const result = await OnnxReranker.rerankDictionaryEntriesAsync(testCase.entries, testCase.sentence, testCase.word);
      const topEntry = result[0];
      const selectedDefIdx = topEntry._bestDefIndex ?? 0;

      if (selectedDefIdx === testCase.expectedDefIndex) {
        correctCount++;
      } else {
        console.log(`[Eval Miss] ${testCase.description}: expected Def ${testCase.expectedDefIndex + 1}, got Def ${selectedDefIdx + 1}`);
      }
    }

    const accuracy = (correctCount / testCases.length) * 100;
    console.log(`[Synthetic Evaluation Result] Accuracy: ${accuracy.toFixed(1)}% (${correctCount}/${testCases.length})`);

    expect(accuracy).toBeGreaterThanOrEqual(70);
  }, 30000);

  it('achieves >= 70% accuracy on KoELECTRA candidate stem selection (듣다 vs 들다, 짓다 vs 지다)', async () => {
    const candidateTestCases = [
      {
        sentence: '음악을 크게 듣고 있어요.',
        candidates: [
          { text: '들다', score: 50, posHint: 'verb' },
          { text: '듣다', score: 50, posHint: 'verb' }
        ],
        expectedStem: '듣다'
      },
      {
        sentence: '목수가 새로운 집을 짓고 계십니다.',
        candidates: [
          { text: '지다', score: 50, posHint: 'verb' },
          { text: '짓다', score: 50, posHint: 'verb' }
        ],
        expectedStem: '짓다'
      }
    ];

    let correctCount = 0;

    for (const testCase of candidateTestCases) {
      const result = await OnnxReranker.rerankCandidatesAsync(testCase.candidates, testCase.sentence);
      if (result[0]?.text === testCase.expectedStem) {
        correctCount++;
      }
    }

    const accuracy = (correctCount / candidateTestCases.length) * 100;
    console.log(`[KoELECTRA Evaluation Result] Candidate accuracy: ${accuracy.toFixed(1)}% (${correctCount}/${candidateTestCases.length})`);
    expect(accuracy).toBeGreaterThanOrEqual(70);
  }, 30000);
});
