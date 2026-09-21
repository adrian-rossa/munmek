import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';

describe('Ask LLM Fixes & Dynamic Tracking', () => {
  let MunmekUI;
  let mockDocument;
  let mockBody;
  let tooltipEl;

  beforeEach(() => {
    tooltipEl = {
      id: '',
      className: '',
      innerHTML: '',
      style: { setProperty: () => {}, display: 'none', visibility: 'hidden' },
      setAttribute: () => {},
      removeAttribute: () => {},
      addEventListener: () => {},
      classList: { contains: () => false, add: () => {}, remove: () => {} },
      closest: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      getBoundingClientRect: () => ({ width: 460, height: 300 })
    };

    mockBody = {
      appendChild: () => {}
    };

    mockDocument = {
      createElement: (tag) => {
        if (tag === 'div') return tooltipEl;
        return { style: {}, setAttribute: () => {}, addEventListener: () => {} };
      },
      getElementById: (id) => tooltipEl,
      body: mockBody
    };

    globalThis.document = mockDocument;
    globalThis.window = globalThis;

    const uiCode = fs.readFileSync('src/content/content_ui.js', 'utf8');
    const fn = new Function('global', uiCode);
    fn(globalThis);
    MunmekUI = globalThis.MunmekUI;
  });

  describe('cleanKoreanWord Particle Stripping (Issue 5)', () => {
    it('strips compound particles like 이나, 에게서, 에서는, 까지, 부터', () => {
      expect(MunmekUI.cleanKoreanWord('동안이나')).toBe('동안');
      expect(MunmekUI.cleanKoreanWord('친구에게서')).toBe('친구');
      expect(MunmekUI.cleanKoreanWord('서울에서는')).toBe('서울');
      expect(MunmekUI.cleanKoreanWord('어제부터')).toBe('어제');
      expect(MunmekUI.cleanKoreanWord('내일까지')).toBe('내일');
      expect(MunmekUI.cleanKoreanWord('너밖에')).toBe('너');
      expect(MunmekUI.cleanKoreanWord('그처럼')).toBe('그');
    });

    it('preserves verb/adjective citation forms ending in 다', () => {
      expect(MunmekUI.cleanKoreanWord('떠나다')).toBe('떠나다');
      expect(MunmekUI.cleanKoreanWord('보다')).toBe('보다');
      expect(MunmekUI.cleanKoreanWord('가다')).toBe('가다');
    });
  });

  describe('Hierarchical Definition Matching (Issue 3 & 5)', () => {
    it('correctly matches 어서 as adverb instead of ending', () => {
      const state = {
        word: '어서',
        dictionaryEntries: [
          {
            surface: '어서',
            pos: '부사',
            definitions: ['빨리, 지체하지 않고. (hurry, quickly, without hesitation)']
          },
          {
            surface: '어서',
            pos: '어미',
            definitions: ['앞의 내용이 뒤의 내용의 원인이나 이유가 됨을 나타내는 연결 어미. (connective ending indicating cause or reason)']
          }
        ]
      };

      const analysisData = {
        words_analysis: [
          {
            surface: '어서',
            base: '어서',
            pos: 'adverb',
            definitions: ['quickly, without hesitation, hurry'],
            grammar_notes: 'Adverb used to urge someone to do something quickly.'
          }
        ]
      };

      MunmekUI.autoSelectBestDefinitionFromGemini(state, analysisData);

      expect(state.geminiMatchedItemIndex).toBe(0);
      expect(state.geminiMatchedDefIndex).toBe(0);
    });

    it('correctly matches 동안 when surface has compound particle 동안이나', () => {
      const state = {
        word: '동안이나',
        dictionaryEntries: [
          {
            surface: '동안',
            base: '동안',
            pos: '명사',
            definitions: ['어느 때부터 다른 어느 때까지의 시간적 간격. (while, period of time)']
          },
          {
            surface: '동안',
            base: '동안',
            pos: '명사',
            hanja: '童顔',
            definitions: ['아이의 얼굴, 또는 나이에 비해 젊어 보이는 얼굴. (baby face)']
          }
        ]
      };

      const analysisData = {
        words_analysis: [
          {
            surface: '동안이나',
            base: '동안',
            pos: 'noun',
            definitions: ['for as long as (duration, period of time)'],
            grammar_notes: 'Noun 동안 followed by particle 이나 emphasizing surprisingly long duration.'
          }
        ]
      };

      MunmekUI.autoSelectBestDefinitionFromGemini(state, analysisData);

      expect(state.geminiMatchedItemIndex).toBe(0);
      expect(state.geminiMatchedDefIndex).toBe(0);
    });
  });

  describe('Visual Exaggeration of LLM Matched Definition', () => {
    it('renders prominent LLM matched badge and highlighted definition box', () => {
      const state = {
        word: '어서',
        dictionaryEntries: [
          {
            surface: '어서',
            pos: '부사',
            definitions: ['quickly, without hesitation.']
          }
        ],
        geminiMatchedGroupIndex: 0,
        geminiMatchedItemIndex: 0,
        geminiMatchedDefIndex: 0
      };

      const html = MunmekUI.renderDictionaryEntriesGrouped(state.dictionaryEntries, '어서', state);

      expect(html).toContain('✨ LLM Matched');
      expect(html).toContain('linear-gradient(135deg');
      expect(html).toContain('LLM Context-Matched Definition');
      expect(html).toContain('border-left: 5px solid #2f5d62');
      expect(html).toContain('background: #f0faf7');
    });
  });

  describe('Prompt Custom Fields JSON Structure (Issue 4)', () => {
    it('injects custom fields directly into the JSON template structure with description', () => {
      const DEFAULT_PROMPT = `Return ONLY valid JSON (no markdown backticks or commentary).

Return JSON with "words_analysis": [{
  "surface": "{WORD}",
  "base": "clean Korean citation lemma",
  "pos": "part of speech",
  "definitions": ["definition in context"],
  "conjugation": { "ending": "...", "explanation": "..." },
  "grammar_notes": "contextual breakdown based on scene/sentence context",
  "id": "1"
}]`;

      const customAiFields = [
        { key: 'japanese_translation', description: 'Japanese translation in context' },
        { key: 'japanese_word', description: 'Japanese dictionary headword equivalent' }
      ];

      const validFields = customAiFields.filter(f => f.key.length > 0);
      const customFieldsJson = validFields.map(f => {
        const desc = f.description || '...';
        return `"${f.key}": "${desc.replace(/"/g, '\\"')}"`;
      }).join(',\n  ');

      const updatedPrompt = DEFAULT_PROMPT.replace(
        /"id":\s*"1"\s*\r?\n\s*\}\]/,
        `"id": "1",\n  ${customFieldsJson}\n}]`
      );

      expect(updatedPrompt).toContain('"japanese_translation": "Japanese translation in context"');
      expect(updatedPrompt).toContain('"japanese_word": "Japanese dictionary headword equivalent"');
      expect(updatedPrompt).toMatch(/"id": "1",\s+"japanese_translation": "Japanese translation in context",\s+"japanese_word": "Japanese dictionary headword equivalent"\s+\}\]/);
    });
  });

  describe('Explicit Custom Fields Manager & Zero False Positives', () => {
    it('only generates Anki options from explicit customAiFields, never from natural prompt text', () => {
      const FIELD_VALUE_OPTIONS = [
        { value: 'none', label: 'None (Empty)' },
        { value: '{{word}}', label: 'Target Word' }
      ];

      const getDynamicFieldValueOptions = (customFields) => {
        const opts = [...FIELD_VALUE_OPTIONS];
        const existingValues = new Set(opts.map(o => o.value));

        if (Array.isArray(customFields)) {
          customFields.forEach((field) => {
            const key = (field.key || '').trim().replace(/[^a-zA-Z0-9_]/g, '');
            if (!key) return;
            const val = `{{${key}}}`;
            if (!existingValues.has(val)) {
              existingValues.add(val);
              const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + ' (Custom Field)';
              opts.push({ value: val, label });
            }
          });
        }
        return opts;
      };

      // Even if user writes words with underscores or quotes in prompt instructions:
      const naturalPrompt = "Explain nuance carefully. Use 'real_life' examples. Rule_1: be concise.";

      // Custom fields configured by user
      const customAiFields = [
        { key: 'japanese_translation', description: 'Japanese translation' }
      ];

      const options = getDynamicFieldValueOptions(customAiFields);
      const optionValues = options.map(o => o.value);

      // Explicit field is present
      expect(optionValues).toContain('{{japanese_translation}}');

      // False positives from natural prompt text are NEVER present
      expect(optionValues).not.toContain('{{real_life}}');
      expect(optionValues).not.toContain('{{Rule_1}}');
      expect(optionValues).not.toContain('{{nuance}}');
    });
  });

  describe('Badge Leak Prevention across Words in Same Sentence', () => {
    it('does NOT return or match analysis for an unrequested word in the same sentence', () => {
      const sentence = '어디 네 바이슨이 얼마나 잘 나는지 한번 보자';
      const cache = new Map();

      // Simulate LLM analysis for "바이슨"
      const bisonAnalysis = {
        target_word: '바이슨',
        definition: 'bison (large animal)',
        meaning: 'bison',
        words_analysis: [
          {
            surface: '바이슨',
            base: '바이슨',
            pos: 'noun',
            definitions: ['bison, wild ox of North America']
          }
        ]
      };
      cache.set(`바이슨__${sentence}__English`, bisonAnalysis);
      cache.set(`바이슨__${sentence}`, bisonAnalysis);

      // State for hovering over "얼마나"
      const olmanaState = {
        word: '얼마나',
        sentence: sentence,
        sentenceKey: sentence,
        dictionaryMatch: '얼마나',
        dictionaryEntries: [
          {
            surface: '얼마나',
            pos: '부사',
            definitions: ['how', 'some degree', 'how much']
          }
        ],
        geminiMatchedDefIndex: null,
        currentAnalysis: null
      };

      // Query cache for "얼마나"
      const result = MunmekUI.getGeminiAnalysisForState(olmanaState, cache);
      expect(result).toBeNull();

      // Calling autoSelectBestDefinitionFromGemini with null does NOT set any badge
      MunmekUI.autoSelectBestDefinitionFromGemini(olmanaState, result);
      expect(olmanaState.geminiMatchedDefIndex).toBeNull();
      expect(olmanaState.geminiMatchedItemIndex).toBeNull();

      // Now simulate Ask LLM clicked for "얼마나"
      const olmanaAnalysis = {
        target_word: '얼마나',
        definition: 'how much',
        meaning: 'how much',
        words_analysis: [
          {
            surface: '얼마나',
            base: '얼마나',
            pos: 'adverb',
            definitions: ['how much']
          }
        ]
      };
      cache.set(`얼마나__${sentence}__English`, olmanaAnalysis);
      cache.set(`얼마나__${sentence}`, olmanaAnalysis);

      const olmanaResult = MunmekUI.getGeminiAnalysisForState(olmanaState, cache);
      expect(olmanaResult).toEqual(olmanaAnalysis);

      MunmekUI.autoSelectBestDefinitionFromGemini(olmanaState, olmanaResult);
      expect(olmanaState.geminiMatchedDefIndex).toBe(2); // "how much" definition
    });
  });

  describe('Definition Token Matching & Threshold Enforcement', () => {
    it('Case 1: Definition token match wins over contradictory base match (쳐들어오다 vs 치다)', () => {
      const state = {
        word: '쳐들어올',
        sentence: '불의 제국이 곧 우리 마을로 쳐들어올 거야',
        sentenceKey: '불의 제국이 곧 우리 마을로 쳐들어올 거야',
        dictionaryMatch: '쳐들어오다',
        dictionaryEntries: [
          {
            dictTitle: 'KRDICT EN',
            surface: '치다',
            base: '치다',
            pos: 'verb',
            definitions: ['rain; snow; blow (to pour or blow strongly)']
          },
          {
            dictTitle: 'KRDICT EN',
            surface: '쳐들어오다',
            base: '쳐들어오다',
            pos: 'verb',
            definitions: ['come to invade; come to attack (to approach forcefully into territory)']
          }
        ],
        geminiMatchedGroupIndex: null,
        geminiMatchedItemIndex: null,
        geminiMatchedDefIndex: null
      };

      const analysisData = {
        target_word: '쳐들어올',
        definition: 'to invade; to attack (implies forceful entry)',
        words_analysis: [
          {
            surface: '쳐들어올',
            base: '치다', // LLM returned base "치다"
            pos: 'verb',
            definitions: ['to invade; to attack (implies forceful entry)']
          }
        ]
      };

      MunmekUI.autoSelectBestDefinitionFromGemini(state, analysisData);

      // Candidate 쳐들어오다 (itemIndex 1) MUST win because its definition matches "invade; attack",
      // even though candidate 치다 matches the base lemma "치다"
      expect(state.geminiMatchedItemIndex).toBe(1);
      expect(state.geminiMatchedDefIndex).toBe(0);
      expect(state.dictionaryEntries[state.geminiMatchedItemIndex].surface).toBe('쳐들어오다');
    });

    it('Case 3: No badge placed when dictionary has no matching definition (다 locative particle)', () => {
      const state = {
        word: '다',
        sentence: '어디다 숨겼지?',
        sentenceKey: '어디다 숨겼지?',
        dictionaryMatch: '다',
        dictionaryEntries: [
          {
            dictTitle: 'KRDICT EN',
            surface: '다',
            base: '다',
            pos: 'noun',
            definitions: ['all; everything (the entire whole without exception)']
          }
        ],
        geminiMatchedGroupIndex: null,
        geminiMatchedItemIndex: null,
        geminiMatchedDefIndex: null
      };

      const analysisData = {
        target_word: '다',
        definition: 'to (a place); at (a place)',
        words_analysis: [
          {
            surface: '다',
            base: '다',
            pos: 'particle',
            definitions: ['to (a place); at (a place) - directional or locative marker']
          }
        ]
      };

      MunmekUI.autoSelectBestDefinitionFromGemini(state, analysisData);

      // Strict threshold: Because "all; everything" has 0 token overlap with "place / directional / locative",
      // NO badge should be placed on "all; everything"
      expect(state.geminiMatchedDefIndex).toBeNull();
      expect(state.geminiMatchedItemIndex).toBeNull();
      expect(state.geminiMatchedGroupIndex).toBeNull();
    });

    it('Case 2: Correct definition tab selected for 되다 with conjecture context', () => {
      const state = {
        word: '되겠지',
        sentence: '다 잘 되겠지.',
        sentenceKey: '다 잘 되겠지.',
        dictionaryMatch: '되다',
        dictionaryEntries: [
          {
            dictTitle: 'KRDICT EN',
            surface: '되다',
            base: '되다',
            pos: 'verb',
            definitions: [
              'become (to change into something)',
              'reach; attain (to arrive at an age, time, or stage)',
              'be suitable (to be good enough or fit)',
              'turn out; seem; be likely (a guess about an outcome or state)'
            ]
          }
        ],
        geminiMatchedGroupIndex: null,
        geminiMatchedItemIndex: null,
        geminiMatchedDefIndex: null
      };

      const analysisData = {
        target_word: '되겠지',
        definition: 'It will probably be/seem (a guess about a state or outcome).',
        words_analysis: [
          {
            surface: '되겠지',
            base: '되다',
            pos: 'verb',
            definitions: ['It will probably be/seem (a guess about a state or outcome).']
          }
        ]
      };

      MunmekUI.autoSelectBestDefinitionFromGemini(state, analysisData);

      expect(state.geminiMatchedItemIndex).toBe(0);
      expect(state.geminiMatchedDefIndex).toBe(3); // Def 4: "turn out; seem; be likely (a guess about an outcome or state)"
    });
  });

  describe('Context Anchor & Candidate Preservation in content.js', () => {
    it('anchors sentence analysis to originalHoverWord', () => {
      const contentCode = fs.readFileSync('src/content/content.js', 'utf8');
      const bgCode = fs.readFileSync('src/background/background.js', 'utf8');

      // Verifies originalHoverWord is stored in hover state
      expect(contentCode).toContain('originalHoverWord: word');
      expect(contentCode).toContain('const targetWordForAi = state.originalHoverWord || state.word;');

      // Verifies candidateLine is generated in background.js without overriding WORD
      expect(bgCode).toContain('Candidate Under Review:');
      expect(bgCode).toContain('Verify if');
      expect(bgCode).toContain('is a true constituent of');

      // Verifies candidate auto-switch checks both base and surface
      expect(contentCode).toContain('state.geminiMatchedBase || state.geminiMatchedSurface');
      expect(contentCode).toContain('LLM Matched Base');
    });
  });

  describe('Compound Word Identification & Visual Indicators (Options 1 & 3)', () => {
    it('accurately identifies compound constituents (어디 + 다 in 어디다)', () => {
      const candidates = [
        { text: '어디', score: 100 },
        { text: '다', score: 90 },
        { text: '어디다', score: 80 },
        { text: '디다', score: 40 }
      ];

      const compound = MunmekUI.findCompoundPair(candidates, '어디다');
      expect(compound).not.toBeNull();
      expect(compound.part1.text).toBe('어디');
      expect(compound.part2.text).toBe('다');
      expect(compound.target).toBe('어디다');
    });

    it('identifies noun + particle compound and rejects bogus substrings (과거 + 에 in 과거에, rejecting 거)', () => {
      const candidates = [
        { text: '과거', score: 100 },
        { text: '거', score: 60 },
        { text: '에', score: 85 }
      ];

      const compound = MunmekUI.findCompoundPair(candidates, '과거에');
      expect(compound).not.toBeNull();
      expect(compound.part1.text).toBe('과거');
      expect(compound.part2.text).toBe('에');
      // 거 is NOT part of the compound pair
      expect(compound.part1.text).not.toBe('거');
      expect(compound.part2.text).not.toBe('거');
    });

    it('returns null when candidates do not concatenate to the target word', () => {
      const candidates = [
        { text: '사과', score: 100 },
        { text: '배', score: 80 }
      ];

      const compound = MunmekUI.findCompoundPair(candidates, '사과');
      expect(compound).toBeNull();
    });

    it('renders compound-pill-group (Option 1) in candidate chips row', () => {
      const state = {
        word: '어디다',
        originalHoverWord: '어디다',
        sentence: '어디다 숨겼지?',
        sentenceKey: '어디다 숨겼지?',
        dictionaryMatch: '어디',
        candidateList: [
          { text: '어디', score: 100 },
          { text: '다', score: 90 },
          { text: '어디다', score: 80 },
          { text: '디다', score: 40 }
        ],
        dictionaryEntries: [
          {
            dictTitle: 'KRDICT EN',
            surface: '어디',
            base: '어디',
            pos: 'pronoun',
            definitions: ['where; what place']
          }
        ]
      };

      MunmekUI.renderTooltip(state, new Map(), () => {}, () => {}, () => {});
      expect(tooltipEl.innerHTML).toContain('compound-pill-group');
      expect(tooltipEl.innerHTML).toContain('data-candidate="어디"');
      expect(tooltipEl.innerHTML).toContain('data-candidate="다"');
      expect(tooltipEl.innerHTML).not.toContain('compound-banner');
    });

    it('resolves verb stem to dictionary citation lemma (겁먹 -> 겁먹다) in compound pair', () => {
      const candidates = [
        { text: '겁먹다', posHint: 'verb', score: 96 },
        { text: '겁먹', posHint: 'verb/stem', score: 80 },
        { text: '지', posHint: 'grammar', score: 75 }
      ];

      const compound = MunmekUI.findCompoundPair(candidates, '겁먹지');
      expect(compound).not.toBeNull();
      expect(compound.part1.text).toBe('겁먹다');
      expect(compound.part2.text).toBe('지');
      expect(compound.target).toBe('겁먹지');
    });

    it('extracts geminiMatchedBase from LLM response even when dictionaryEntries is empty', () => {
      const state = {
        word: '긴',
        originalHoverWord: '긴',
        dictionaryMatch: '',
        dictionaryEntries: [] // Empty local dictionary entries
      };

      const analysisData = {
        words_analysis: [
          {
            surface: '긴',
            base: '길다',
            pos: 'adjective',
            definitions: ['long; prolonged']
          }
        ]
      };

      MunmekUI.autoSelectBestDefinitionFromGemini(state, analysisData);
      expect(state.geminiMatchedBase).toBe('길다');
      expect(state.geminiMatchedSurface).toBe('긴');
    });

    it('generates 길다 candidate from modifier 긴 via ㄹ-drop rule', () => {
      const KoreanLemmatizer = require('../src/nlp/korean_lemmatizer.js');
      const candidates = KoreanLemmatizer.deconjugate('긴');
      const gilMatch = candidates.find(c => c.text === '길다');
      expect(gilMatch).toBeDefined();
      expect(gilMatch.text).toBe('길다');
    });

    it('decomposes 3-part compound (할미 + 에게 + 도) and does NOT corrupt noun 할미 into 할미다', () => {
      const candidates = [
        { text: '할미에게도', posHint: 'surface', score: 100 },
        { text: '할미에게', posHint: 'noun/stem', score: 90 },
        { text: '할미', posHint: 'noun', score: 78, reason: 'stem prefix subword (할미)' },
        { text: '에게', posHint: 'noun', score: 76, reason: 'stem suffix subword (에게)' },
        { text: '도', posHint: 'particle', score: 75, reason: 'particle (도)' }
      ];

      const compound = MunmekUI.findCompoundChain(candidates, '할미에게도');
      expect(compound).not.toBeNull();
      expect(compound.parts.length).toBe(3);
      expect(compound.parts.map(p => p.text)).toEqual(['할미', '에게', '도']);
      // Verify noun is preserved and NOT converted to 할미다
      expect(compound.parts[0].text).toBe('할미');
      expect(compound.parts[0].text).not.toBe('할미다');
    });

    it('cleans compound particle 에게도 via cleanKoreanWord', () => {
      expect(MunmekUI.cleanKoreanWord('할미에게도')).toBe('할미');
    });

    it('renders feedback toast at the top of tooltip before dictionary content', () => {
      document.body.innerHTML = '';
      const state = {
        word: '따라잡다',
        originalHoverWord: '따라잡을',
        dictionaryMatch: '따라잡다',
        feedback: 'Created a new Anki card.',
        feedbackType: 'success',
        candidateList: [
          { text: '따라잡다', posHint: 'verb', isLlmInjected: true }
        ],
        dictionaryEntries: []
      };

      MunmekUI.renderTooltip(state, new Map(), () => {}, () => {}, () => {});
      const tooltip = document.getElementById('munmek-lookup-tooltip');
      expect(tooltip).not.toBeNull();
      const html = tooltip.innerHTML;
      expect(html).toContain('toast-feedback');
      expect(html).toContain('Created a new Anki card.');

      // Verify toast-feedback occurs before dict-empty or candidate chips in the HTML
      const toastIdx = html.indexOf('toast-feedback');
      const titleIdx = html.indexOf('class="title"');
      expect(titleIdx).toBeGreaterThan(-1);
      expect(toastIdx).toBeGreaterThan(titleIdx);
    });

    it('prioritizes LLM-injected candidates so they are not sliced off in candidate chips', () => {
      document.body.innerHTML = '';
      const state = {
        word: '잡다',
        originalHoverWord: '따라잡을',
        dictionaryMatch: '잡다',
        // Injected candidate 따라잡다 is at the end of a long list
        candidateList: [
          { text: '따라', posHint: 'noun' },
          { text: '잡을', posHint: 'noun' },
          { text: '잡다', posHint: 'verb' },
          { text: '따르다', posHint: 'verb' },
          { text: '잡', posHint: 'noun' },
          { text: '을', posHint: 'particle' },
          { text: '따라잡다', posHint: 'verb', isLlmInjected: true, reason: 'LLM Matched Base' }
        ],
        verifiedDictionaryCandidates: new Set(['따라', '잡을', '잡다', '따르다', '잡', '을']),
        dictionaryEntries: []
      };

      MunmekUI.renderTooltip(state, new Map(), () => {}, () => {}, () => {});
      const tooltip = document.getElementById('munmek-lookup-tooltip');
      expect(tooltip).not.toBeNull();
      // 따라잡다 must be rendered in the DOM chips despite being 7th in the candidate list
      expect(tooltip.innerHTML).toContain('data-candidate="따라잡다"');
      expect(tooltip.innerHTML).toContain('data-candidate="잡다"');
    });
  });
});



