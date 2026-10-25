import { describe, it, expect } from 'vitest';
import SenseRerankerAdapters from '../src/nlp/sense_reranker_adapters.js';

describe('Sense Reranker Adapters (Option C & Option A/B)', () => {
  const sampleEntries = [
    {
      surface: '말',
      pos: '명사',
      definitions: ['1. 사람의 생각이나 느낌 따위를 입으로 나타내는 소리. 또는 그 소리로 된 체계. (speech, words)']
    },
    {
      surface: '말',
      pos: '명사',
      definitions: ['1. 말과의 포유류. 몸길이는 2~3미터이며, 갈기가 있고 꼬리는 길다. (horse)']
    }
  ];

  describe('Prompt preparation & Cleaning', () => {
    it('cleans ruby tags, html tags, and grammar patterns from definitions', () => {
      const dirty = '<ruby>話<rt>はなし</rt></ruby> <div class="def">1. Speech and words.</div> Sentence: 말이 씨가 된다.';
      const cleaned = SenseRerankerAdapters.cleanDefinitionForPrompt(dirty);
      expect(cleaned).not.toContain('<rt>');
      expect(cleaned).not.toContain('<div');
      expect(cleaned).not.toContain('Sentence:');
      expect(cleaned).toContain('Speech and words');
    });

    it('splits embedded numbered senses into distinct entries', () => {
      const embeddedDefs = ['1. To call, summon. 2. To sing a song. 3. Full (stomach).'];
      const split = SenseRerankerAdapters.splitEmbeddedDefinitions(embeddedDefs, '부르다');
      expect(split.length).toBe(3);
      expect(split[0]).toContain('To call');
      expect(split[1]).toContain('To sing');
      expect(split[2]).toContain('Full');
    });

    it('builds flat numbered candidate senses with accurate entryIndex and defIndex', () => {
      const candidates = SenseRerankerAdapters.buildSenseCandidates(sampleEntries, '말');
      expect(candidates.length).toBe(2);
      expect(candidates[0].candidateIndex).toBe(1);
      expect(candidates[0].entryIndex).toBe(0);
      expect(candidates[0].displayText).toContain('말 (명사):');
      expect(candidates[0].displayText).toContain('speech');

      expect(candidates[1].candidateIndex).toBe(2);
      expect(candidates[1].entryIndex).toBe(1);
      expect(candidates[1].displayText).toContain('horse');
    });

    it('strips example sentences and caps excessively long definitions', () => {
      const veryLong = 'To write letters or characters with a pen or pencil on paper or board. 예: 공책에 글씨를 바르게 쓰다. 학생이 일기를 쓴다. ' + 'a'.repeat(200);
      const cleaned = SenseRerankerAdapters.cleanDefinitionForPrompt(veryLong);
      expect(cleaned).not.toContain('공책에');
      expect(cleaned.length).toBeLessThanOrEqual(135);
    });

    it('uses fair round-robin budgeting to prevent bloated entries from starving other homonyms', () => {
      const bloatedEntries = [
        {
          surface: '쓰다',
          pos: '동사',
          definitions: Array.from({ length: 10 }, (_, i) => `${i + 1}. Verb sense ${i + 1} for 쓰다`)
        },
        {
          surface: '쓰다',
          pos: '형용사',
          definitions: ['1. Bitter taste like medicine.', '2. Painful and harsh experience.']
        }
      ];

      const candidates = SenseRerankerAdapters.buildSenseCandidates(bloatedEntries, '쓰다', 8);
      expect(candidates.length).toBe(8);

      const hasAdjective = candidates.some((c) => c.entryIndex === 1 && c.displayText.includes('Bitter'));
      expect(hasAdjective).toBe(true);
      expect(candidates.every((c) => c.candidateIndex <= 8)).toBe(true);
    });
  });

  describe('Option C: rerankWithLocalLlmChat (OpenAI /v1/chat/completions)', () => {
    it('uses temperature 0.0, max_tokens 5, and parses logprobs distribution correctly', async () => {
      let sentPayload = null;

      const mockFetch = async (url, opts) => {
        sentPayload = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: { content: '2' },
                logprobs: {
                  content: [
                    {
                      token: '2',
                      logprob: -0.15, // ~86% prob
                      top_logprobs: [
                        { token: '2', logprob: -0.15 },
                        { token: '1', logprob: -1.95 }  // ~14% prob
                      ]
                    }
                  ]
                }
              }
            ]
          })
        };
      };

      const reranked = await SenseRerankerAdapters.rerankWithLocalLlmChat(
        sampleEntries,
        '목장에서 말을 타고 달렸다.',
        '말',
        { customEndpointUrl: 'http://localhost:1234/v1', customModelId: 'test-model' },
        mockFetch
      );

      // Verify prompt parameters
      expect(sentPayload.temperature).toBe(0.0);
      expect(sentPayload.max_tokens).toBe(5);
      expect(sentPayload.logprobs).toBe(true);
      expect(sentPayload.messages[1].content).toContain('목장에서 말을 타고 달렸다.');

      // Verify winner (Entry 1: horse) was moved to the top
      expect(reranked.length).toBe(2);
      expect(reranked[0].definitions[0]).toContain('horse');
      expect(reranked[0]._koelectraMatched).toBe(true);
      expect(parseInt(reranked[0]._confidenceScore, 10)).toBeGreaterThanOrEqual(80);
      expect(Array.isArray(reranked[0]._defConfidenceScores)).toBe(true);
    });

    it('falls back to regex digit parsing when logprobs are omitted by local server', async () => {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: { content: 'The best match is option 1.' }
            }
          ]
        })
      });

      const reranked = await SenseRerankerAdapters.rerankWithLocalLlmChat(
        sampleEntries,
        '선생님의 말씀을 조용히 들었다.',
        '말',
        {},
        mockFetch
      );

      expect(reranked[0].definitions[0]).toContain('speech');
      expect(reranked[0]._bestDefIndex).toBe(0);
      expect(reranked[0]._koelectraMatched).toBe(true);
      expect(reranked[0]._confidenceScore).toBe('90%');
    });

    it('retries without logprobs if local backend returns HTTP 400', async () => {
      let attempts = 0;
      let lastPayload = null;

      const mockFetch = async (url, opts) => {
        attempts++;
        lastPayload = JSON.parse(opts.body);
        if (attempts === 1) {
          return {
            ok: false,
            status: 400,
            text: async () => 'logprobs is not supported by this backend'
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: '1' } }]
          })
        };
      };

      const reranked = await SenseRerankerAdapters.rerankWithLocalLlmChat(
        sampleEntries,
        '이야기를 나누다',
        '말',
        {},
        mockFetch
      );

      expect(attempts).toBe(2);
      expect(lastPayload.logprobs).toBeUndefined();
      expect(reranked[0].definitions[0]).toContain('speech');
    });

    it('preserves dictionary priority order and never moves a secondary dictionary to index 0', async () => {
      const multiDictEntries = [
        {
          dictTitle: 'KRDICT EN',
          surface: '부르다',
          pos: 'Verb',
          definitions: ['call for; call out for', 'sing a song']
        },
        {
          dictTitle: 'KRDICT JA',
          surface: '부르다',
          pos: 'Verb',
          definitions: ['呼ぶ', '歌う']
        }
      ];

      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: '2' } }] // picks sense 2
        })
      });

      const reranked = await SenseRerankerAdapters.rerankWithLocalLlmChat(
        multiDictEntries,
        '노래를 부르고 있다',
        '부르다',
        {},
        mockFetch
      );

      expect(reranked[0].dictTitle).toBe('KRDICT EN');
      expect(reranked[1].dictTitle).toBe('KRDICT JA');
      expect(reranked[0]._bestDefIndex).toBe(1);
      expect(reranked[0]._defConfidenceScores.length).toBe(2);
      expect(reranked[0]._defConfidenceScores.every((s) => typeof s === 'string')).toBe(true);
    });

    it('populates confidence scores for all 7 sub-definitions of a single entry', async () => {
      const sevenDefEntry = [
        {
          dictTitle: 'KRDICT EN',
          surface: '부르다',
          pos: 'Verb',
          definitions: [
            'call for; call out for; gesture',
            'call out; check; draw attention',
            'say; read; dictate',
            'sing to a tune',
            'quote a price',
            'name; call; refer to',
            'cause; bring about'
          ]
        }
      ];

      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: 'F' } }] // Def 6 ("name; call; refer to")
        })
      });

      const reranked = await SenseRerankerAdapters.rerankWithLocalLlmChat(
        sevenDefEntry,
        '한국어라고 부르고 있다',
        '부르고',
        {},
        mockFetch
      );

      expect(reranked[0]._bestDefIndex).toBe(5); // 0-based index 5 = Def 6
      expect(reranked[0]._defConfidenceScores.length).toBe(7);
      expect(reranked[0]._defConfidenceScores[5]).toMatch(/^(?:8[0-9]|9[0-2])%/);
      expect(reranked[0]._defConfidenceScores[0]).toMatch(/^\d{1,2}%/);
      expect(reranked[0]._defConfidenceScores[1]).toMatch(/^\d{1,2}%/);
      expect(reranked[0]._defConfidenceScores[6]).toMatch(/^\d{1,2}%/);
    });
  });

  describe('Option A & B: rerankWithSystemOne (Verdict / thecodacus / Jev)', () => {
    it('sends System One choice payload and maps confidence and distribution to standard contract', async () => {
      let sentUrl = null;
      let sentPayload = null;

      const mockFetch = async (url, opts) => {
        sentUrl = url;
        sentPayload = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            answers: {
              best_definition: {
                choice: 'def_2',
                confidence: 0.92,
                distribution: {
                  def_1: 0.08,
                  def_2: 0.92
                }
              }
            }
          })
        };
      };

      const reranked = await SenseRerankerAdapters.rerankWithSystemOne(
        sampleEntries,
        '들판에 야생마가 뛰어논다.',
        '말',
        { systemOneEndpointUrl: 'http://localhost:8090/v1/systemone' },
        mockFetch
      );

      expect(sentUrl).toBe('http://localhost:8090/v1/systemone');
      expect(sentPayload.questions.best_definition.type).toBe('choice');
      expect(sentPayload.questions.best_definition.options.def_1).toBeDefined();
      expect(sentPayload.questions.best_definition.options.def_2).toBeDefined();

      // Verify winner (def_2: horse)
      expect(reranked[0].definitions[0]).toContain('horse');
      expect(reranked[0]._koelectraMatched).toBe(true);
      expect(parseInt(reranked[0]._confidenceScore, 10)).toBeGreaterThanOrEqual(90);
    });
  });

  describe('Grammar note filtering & Multi-entry best definition assignment', () => {
    it('filters out KRDict grammar notes such as "\'3에 대하여\'로도 쓴다."', () => {
      const seolmyeongDefs = [
        '1. 자세히 밝혀서 말하다. (explain; account for)',
        "2. '3에 대하여'로도 쓴다."
      ];
      const senses = SenseRerankerAdapters.splitEmbeddedDefinitions(seolmyeongDefs, '설명하다');
      expect(senses.length).toBe(1);
      expect(senses[0]).toContain('explain; account for');
      expect(senses.some(s => s.includes('로도 쓴다'))).toBe(false);
    });

    it('assigns highest-scoring definition index and confidence score to EVERY entry, not just the winning entry', () => {
      const entries = [
        {
          surface: '부르다',
          pos: '동사',
          definitions: ['1. call for; call out', '2. sing a song', '3. chant; shout']
        },
        {
          surface: '부르다',
          pos: '형용사',
          definitions: ['1. full feeling stomach stuffed', '2. belly big']
        }
      ];

      const candidates = SenseRerankerAdapters.buildSenseCandidates(entries, '부르다');
      // Candidate 1 = Verb Def 1, Candidate 2 = Verb Def 2, Candidate 3 = Verb Def 3
      // Candidate 4 = Adj Def 1, Candidate 5 = Adj Def 2
      const probMap = {
        1: 0.25, // Verb Def 1 (highest within Verb)
        2: 0.05,
        3: 0.02,
        4: 0.62, // Adj Def 1 (highest overall winner)
        5: 0.06
      };

      // Winner candidate is 4 (Adj Def 1)
      const reranked = SenseRerankerAdapters.applyCandidateScoresToEntries(entries, candidates, probMap, 4, true);

      // Top entry is Adjective
      expect(reranked[0].pos).toBe('형용사');
      expect(reranked[0]._koelectraMatched).toBe(true);
      expect(reranked[0]._bestDefIndex).toBe(0); // Adj Def 1
      expect(reranked[0]._confidenceScore).toBe('62%');

      // Second entry is Verb
      expect(reranked[1].pos).toBe('동사');
      expect(reranked[1]._koelectraMatched).toBe(false);
      expect(reranked[1]._bestDefIndex).toBe(0); // Verb Def 1 (25%), NOT Def 2 or Def 3!
      expect(reranked[1]._confidenceScore).toBe('25%'); // Real score for Verb, not 1% baseline!
    });

    it('includes surface word inflection and grammatical particle instructions in the prompt', async () => {
      let sentPrompt = null;
      let sentSystem = null;

      const mockFetch = async (url, opts) => {
        const body = JSON.parse(opts.body);
        sentSystem = body.messages[0].content;
        sentPrompt = body.messages[1].content;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: 'A' } }]
          })
        };
      };

      await SenseRerankerAdapters.rerankWithLocalLlmChat(
        sampleEntries,
        '대한민국에서는 한국어라고 부르고',
        '부르다',
        { surfaceWord: '부르고' },
        mockFetch
      );

      expect(sentPrompt).toContain('"부르다" (inflected as "부르고" in context)');
      expect(sentSystem).toContain('attached particles');
      expect(sentSystem).toContain('-(이)라고');
    });

    it('selects highest probability candidate as winner when logprobs indicate different top choice than raw text', async () => {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: { content: '1' }, // raw text parsed to candidate 1
              logprobs: {
                content: [
                  {
                    token: '1',
                    top_logprobs: [
                      { token: '2', logprob: -0.22 }, // ~80% prob for candidate 2
                      { token: '1', logprob: -1.61 }  // ~20% prob for candidate 1
                    ]
                  }
                ]
              }
            }
          ]
        })
      });

      const reranked = await SenseRerankerAdapters.rerankWithLocalLlmChat(
        sampleEntries,
        '들판에 야생마가 있다',
        '말',
        {},
        mockFetch
      );

      // Even though raw choice was "1", logprobs gave candidate 2 (horse) 80%!
      expect(reranked[0].definitions[0]).toContain('horse');
      expect(reranked[0]._koelectraMatched).toBe(true);
      expect(reranked[0]._bestDefIndex).toBe(0);
      expect(parseInt(reranked[0]._confidenceScore, 10)).toBeGreaterThanOrEqual(75);
    });

    it('does not confuse English pronoun "I" in conversational preambles with candidate 9 (Option I)', async () => {
      const tenCandidates = Array.from({ length: 10 }, (_, i) => ({
        candidateIndex: i + 1,
        letter: String.fromCharCode(65 + i), // A, B, C, D, E, F, G, H, I, J
        entryIndex: Math.floor(i / 5),
        defIndex: i % 5,
        displayText: `Def ${i + 1}`
      }));

      // Test 1: parseChoiceIndex("I would select 1") must return 1, NOT 9 ('I')
      expect(SenseRerankerAdapters.parseChoiceIndex('I would choose 1.', tenCandidates)).toBe(1);
      expect(SenseRerankerAdapters.parseChoiceIndex('I think option 2 is correct.', tenCandidates)).toBe(2);
      expect(SenseRerankerAdapters.parseChoiceIndex('In this context, 1 fits best.', tenCandidates)).toBe(1);

      // Test 2: logprob token 'I' (from "I choose 1") must not get mapped to candidate 9
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: { content: '1' },
              logprobs: {
                content: [
                  {
                    token: '1',
                    top_logprobs: [
                      { token: 'I', logprob: -0.65 }, // 52% prob on pronoun "I"
                      { token: '1', logprob: -0.80 }  // 45% prob on digit 1
                    ]
                  }
                ]
              }
            }
          ]
        })
      });

      const entries = [
        { surface: '부르다', pos: 'Verb', definitions: ['call for; name'] },
        { surface: '부르다', pos: 'Adjective', definitions: ['full belly'] }
      ];

      const reranked = await SenseRerankerAdapters.rerankWithLocalLlmChat(
        entries,
        '대한민국에서는 한국어라고 부르고',
        '부르다',
        {},
        mockFetch
      );

      // Candidate 1 (Verb) must win with high confidence, NOT Adjective via 'I'
      expect(reranked[0].pos).toBe('Verb');
      expect(reranked[0]._koelectraMatched).toBe(true);
      expect(reranked[0]._bestDefIndex).toBe(0);
    });

    it('anchors on the actual decision token and rejects token 0 noise (e.g. newline having "7" in top_logprobs)', async () => {
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: { content: '\n1' },
              logprobs: {
                content: [
                  {
                    token: '\n',
                    logprob: -0.1,
                    top_logprobs: [
                      { token: '\n', logprob: -0.1 },
                      { token: '7', logprob: -2.0 } // Random vocabulary noise on newline token
                    ]
                  },
                  {
                    token: '1',
                    logprob: -0.05,
                    top_logprobs: [
                      { token: '1', logprob: -0.05 },
                      { token: '2', logprob: -3.5 }
                    ]
                  }
                ]
              }
            }
          ]
        })
      });

      const entries = [
        {
          surface: '부르다',
          pos: 'Verb',
          definitions: [
            'call for; call out for; gesture',
            'call out; check; do',
            'say; read; dictate',
            'sing',
            'quote',
            'chant; shout; say',
            'cause; bring about'
          ]
        },
        {
          surface: '부르다',
          pos: 'Adjective',
          definitions: ['full', '(belly) big', 'bulging; bellied']
        }
      ];

      const reranked = await SenseRerankerAdapters.rerankWithLocalLlmChat(
        entries,
        '대한민국에서는 한국어라고 부르고, 조선민주주의인민공화국에서는 조선말이라고 한다.',
        '부르다',
        {},
        mockFetch
      );

      // Verb must win with Def 1 selected, NOT Def 7 (cause; bring about)
      expect(reranked[0].pos).toBe('Verb');
      expect(reranked[0]._bestDefIndex).toBe(0);
      expect(reranked[0]._confidenceScore).toMatch(/^(?:9[0-9]|100)%$/);
      // Def 7 must have low residual score (<= 5%)
      expect(parseInt(reranked[0]._defConfidenceScores[6], 10)).toBeLessThanOrEqual(5);
    });

    it('returns 90% confidence immediately for single-definition entries', async () => {
      const singleEntry = [
        {
          surface: '포함',
          pos: 'Noun',
          definitions: ['inclusion; coverage']
        }
      ];

      const reranked = await SenseRerankerAdapters.rerankWithLocalLlmChat(
        singleEntry,
        '한국어를 알타이 제어에 포함하였지만',
        '포함',
        {},
        null
      );

      expect(reranked.length).toBe(1);
      expect(reranked[0]._confidenceScore).toBe('90%');
      expect(reranked[0]._defConfidenceScores).toEqual(['90%']);
    });
  });
});
