import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';

describe('MunmekUI Tooltip Rendering Engine', () => {
  let MunmekUI;
  let mockDocument;
  let mockBody;
  let tooltipEl;

  beforeEach(() => {
    // Setup mock DOM environment
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
      body: mockBody
    };

    globalThis.document = mockDocument;
    globalThis.window = globalThis;

    // Load content_ui.js
    const uiCode = fs.readFileSync('src/content/content_ui.js', 'utf8');
    const fn = new Function('global', uiCode);
    fn(globalThis);
    MunmekUI = globalThis.MunmekUI;
  });

  it('renders dictionary entries grouped without throwing reference errors', () => {
    const state = {
      word: '가다',
      sentence: '학교에 가다',
      sentenceKey: '학교에 가다',
      dictionaryEntries: [
        {
          surface: '가다',
          pos: '동사',
          dictTitle: 'KRDICT',
          definitions: ['한 곳에서 다른 곳으로 장소를 이동하다.'],
          _confidenceScore: '92%',
          _koelectraMatched: true,
          _bestDefIndex: 0
        }
      ],
      dictionaryMatch: '가다',
      candidateList: [
        { text: '가다', score: 96, posHint: 'verb' },
        { text: '가', score: 75, posHint: 'particle' }
      ],
      lookupReason: 'IndexedDB Surface Match',
      isStage2Enabled: true
    };

    expect(() => {
      MunmekUI.renderTooltip(state, new Map(), () => {}, () => {}, () => {});
    }).not.toThrow();

    expect(tooltipEl.innerHTML).toContain('한 곳에서 다른 곳으로 장소를 이동하다.');
    expect(tooltipEl.innerHTML).toContain('border-left: 6px solid #2f5d62');
  });

  it('renders dictionary group tabs when multiple dictionaries are present', () => {
    const state = {
      word: '가다',
      sentence: '학교에 가다',
      sentenceKey: '학교에 가다',
      dictionaryEntries: [
        {
          surface: '가다',
          pos: '동사',
          dictTitle: 'KRDICT',
          definitions: ['장소를 이동하다']
        },
        {
          surface: '가다',
          pos: '동사',
          dictTitle: 'Naver',
          definitions: ['to go']
        }
      ],
      dictionaryMatch: '가다',
      candidateList: [{ text: '가다', score: 96, posHint: 'verb' }]
    };

    MunmekUI.renderTooltip(state, new Map(), () => {}, () => {}, () => {});
    expect(tooltipEl.innerHTML).toContain('Dict: KRDICT');
    expect(tooltipEl.innerHTML).toContain('Dict: Naver');
  });

  it('renders collapsible definition when senses exceed 3 lines', () => {
    const multiLineDef = 'To eat food\nTo consume meals\nTo take medicine\nTo drink broth\nTo swallow';
    const state = {
      word: '먹다',
      sentence: '밥을 먹다',
      sentenceKey: '밥을 먹다',
      dictionaryEntries: [
        {
          surface: '먹다',
          pos: '동사',
          dictTitle: 'KRDICT',
          definitions: [multiLineDef]
        }
      ],
      dictionaryMatch: '먹다',
      candidateList: [{ text: '먹다', score: 96, posHint: 'verb' }]
    };

    MunmekUI.renderTooltip(state, new Map(), () => {}, () => {}, () => {});
    expect(tooltipEl.innerHTML).toContain('Show all 5 definitions ▾');
    expect(tooltipEl.innerHTML).toContain('def-hidden-0');
  });

  it('renders partitioned candidate chips with verified dict hits first', () => {
    const state = {
      word: '악당티가',
      sentence: '악당티가 난다',
      sentenceKey: '악당티가 난다',
      candidateList: [
        { text: '가', score: 75, posHint: 'particle' },
        { text: '악당', score: 94, posHint: 'noun' },
        { text: '티', score: 94, posHint: 'noun' }
      ],
      verifiedDictionaryCandidates: new Set(['악당', '티']),
      lookupReason: 'Looking up in IndexedDB...'
    };

    MunmekUI.renderTooltip(state, new Map(), () => {}, () => {}, () => {});
    expect(tooltipEl.innerHTML).toContain('악당');
    expect(tooltipEl.innerHTML).toContain('티');
  });

  describe('cleanKoreanLemma & cleanKoreanWord', () => {
    it('sanitizes base forms with English glosses, parentheticals, and punctuation', () => {
      expect(MunmekUI.cleanKoreanLemma('부르다 (to call, to name)')).toBe('부르다');
      expect(MunmekUI.cleanKoreanLemma('부르다(to call)')).toBe('부르다');
      expect(MunmekUI.cleanKoreanLemma('부르다: to call')).toBe('부르다');
      expect(MunmekUI.cleanKoreanLemma('부르다 - to call, to name')).toBe('부르다');
      expect(MunmekUI.cleanKoreanLemma('부르다 / to call')).toBe('부르다');
      expect(MunmekUI.cleanKoreanLemma('부르다 to call')).toBe('부르다');
      expect(MunmekUI.cleanKoreanLemma('가다 (동사)')).toBe('가다');
      expect(MunmekUI.cleanKoreanLemma('아이')).toBe('아이');
      expect(MunmekUI.cleanKoreanLemma('먹다')).toBe('먹다');
    });

    it('cleanKoreanWord preserves -다 verbs and strips particles on nouns', () => {
      expect(MunmekUI.cleanKoreanWord('부르다 (to call, to name)')).toBe('부르다');
      expect(MunmekUI.cleanKoreanWord('부르다')).toBe('부르다');
      expect(MunmekUI.cleanKoreanWord('먹다')).toBe('먹다');
      expect(MunmekUI.cleanKoreanWord('악당티가')).toBe('악당티');
      expect(MunmekUI.cleanKoreanWord('세상에서')).toBe('세상');
    });

    it('sets clean geminiMatchedBase when LLM returns gloss in base field', () => {
      const state = {
        word: '부르고',
        dictionaryMatch: '부르다',
        dictionaryEntries: [
          {
            surface: '부르다',
            definitions: ['to call out, to name']
          }
        ]
      };
      const analysisData = {
        words_analysis: [
          {
            surface: '부르고',
            base: '부르다 (to call, to name)',
            pos: '동사',
            definitions: ['to call, name']
          }
        ]
      };

      MunmekUI.autoSelectBestDefinitionFromGemini(state, analysisData);
      expect(state.geminiMatchedBase).toBe('부르다');
    });
  });

  describe('Feedback Toast States', () => {
    it('does NOT render toast feedback while isAiLoading is true', () => {
      const state = {
        word: '부르고',
        feedback: 'Analyzing context & grammar with LLM...',
        feedbackType: 'info',
        isAiLoading: true
      };

      MunmekUI.renderTooltip(state, new Map(), () => {}, () => {}, () => {});
      expect(tooltipEl.innerHTML).not.toContain('toast-feedback');
      expect(tooltipEl.innerHTML).not.toContain('✅');
      expect(tooltipEl.innerHTML).toContain('munmek-loading-card');
    });

    it('renders toast-success with green styling and checkmark ONLY for success', () => {
      const state = {
        word: '부르다',
        feedback: 'Created a new Anki card.',
        feedbackType: 'success'
      };

      MunmekUI.renderTooltip(state, new Map(), () => {}, () => {}, () => {});
      expect(tooltipEl.innerHTML).toContain('toast-success');
      expect(tooltipEl.innerHTML).toContain('✅');
      expect(tooltipEl.innerHTML).toContain('Created a new Anki card.');
      expect(tooltipEl.innerHTML).toContain('#dcfce7');
    });

    it('renders toast-info with neutral styling and info icon for info feedback', () => {
      const state = {
        word: '부르다',
        feedback: 'Sending card to Anki...',
        feedbackType: 'info'
      };

      MunmekUI.renderTooltip(state, new Map(), () => {}, () => {}, () => {});
      expect(tooltipEl.innerHTML).toContain('toast-info');
      expect(tooltipEl.innerHTML).toContain('ℹ️');
      expect(tooltipEl.innerHTML).not.toContain('✅');
      expect(tooltipEl.innerHTML).toContain('#f0f9ff');
    });

    it('renders toast-error with warning icon for error feedback', () => {
      const state = {
        word: '부르다',
        feedback: 'AnkiConnect request failed.',
        feedbackType: 'error'
      };

      MunmekUI.renderTooltip(state, new Map(), () => {}, () => {}, () => {});
      expect(tooltipEl.innerHTML).toContain('toast-error');
      expect(tooltipEl.innerHTML).toContain('⚠️');
      expect(tooltipEl.innerHTML).toContain('AnkiConnect request failed.');
      expect(tooltipEl.innerHTML).toContain('#fee2e2');
    });
  });

  describe('Multi-Dictionary Cross-Lingual Sense Alignment', () => {
    it('aligns homonym senses across English and Japanese dictionaries without falsely tagging entry 0', () => {
      const state = {
        word: '과거',
        dictionaryEntries: [
          // Group 0: KRDICT EN
          {
            dictTitle: 'KRDICT EN',
            word: '과거',
            surface: '과거',
            hanja: '過去',
            definitions: ['1. past; a time that has passed']
          },
          {
            dictTitle: 'KRDICT EN',
            word: '과거',
            surface: '과거',
            hanja: '科擧',
            definitions: ['1. state examination in Goryeo/Joseon']
          },
          // Group 1: KRDICT JA (where Entry 0 is 科挙 and Entry 1 is 過去)
          {
            dictTitle: 'KRDICT JA',
            word: '과거',
            surface: '과거',
            hanja: '科擧',
            definitions: ['1. かきょ【科挙】昔、官吏を登用するために実施された試験。']
          },
          {
            dictTitle: 'KRDICT JA',
            word: '과거',
            surface: '과거',
            hanja: '過去',
            definitions: ['1. かこ【過去】今より前の時。']
          }
        ]
      };

      const analysisData = {
        words_analysis: [
          {
            surface: '과거',
            base: '과거',
            definitions: ['past, a time that has passed']
          }
        ]
      };

      MunmekUI.autoSelectBestDefinitionFromGemini(state, analysisData);

      // Verify per-group matching with English LLM analysis
      expect(state.geminiMatchesByGroup).toBeDefined();
      // Group 0 (English) matched entry 0 (past / 過去)
      expect(state.geminiMatchesByGroup[0].itemIndex).toBe(0);
      expect(state.geminiMatchesByGroup[0].matched).toBe(true);

      // Group 1 (Japanese) is NOT matched when LLM response is in English (language-exclusive)
      expect(state.geminiMatchesByGroup[1].matched).toBe(false);

      // When rendering the Japanese dictionary group tab (selectedGroupIndex = 1) with English analysis:
      state.selectedGroupIndex = 1;
      state.currentAnalysis = analysisData;
      state.currentAnalysisLanguage = 'English';
      MunmekUI.renderTooltip(state, new Map(), () => {}, () => {}, () => {});

      let html = tooltipEl.innerHTML;
      // Japanese dictionary tab does NOT receive LLM Matched badge for an English explanation
      expect(html).not.toContain('✨ LLM Matched');
      // No intrusive banner is displayed; instead the action button adapts symmetrically to Refresh LLM (Japanese)
      expect(html).not.toContain('munmek-dict-lang-banner');
      expect(html).toContain('✨ Refresh LLM (Japanese)');

      // Now, refresh or ask LLM in Japanese:
      const japaneseAnalysisData = {
        _responseLanguage: 'Japanese',
        words_analysis: [
          {
            surface: '과거',
            base: '과거',
            definitions: ['今より前の時。かこ【過去】']
          }
        ]
      };
      MunmekUI.autoSelectBestDefinitionFromGemini(state, japaneseAnalysisData);
      state.currentAnalysis = japaneseAnalysisData;
      state.currentAnalysisLanguage = 'Japanese';

      // Group 1 (Japanese) is now matched to entry 1 (過去)
      expect(state.geminiMatchesByGroup[1].itemIndex).toBe(1);
      expect(state.geminiMatchesByGroup[1].matched).toBe(true);
      // Group 0 (English) is NOT matched because LLM response is Japanese
      expect(state.geminiMatchesByGroup[0].matched).toBe(false);

      MunmekUI.renderTooltip(state, new Map(), () => {}, () => {}, () => {});
      html = tooltipEl.innerHTML;
      // Now Japanese entry 1 HAS the LLM Matched badge!
      expect(html).toContain('かこ【過去】');
      expect(html).toContain('今より前の時。');
      expect(html).toContain('✨ LLM Matched');
      expect(html).not.toContain('✨ LLM Matched (Def 1)');
    });

    it('decodes HTML entities like &quot;, &#39;, &amp;, &lt;, &gt; in definitions and tooltips', () => {
      // 1. Direct utility test
      const rawText = '-hada A suffix that means &quot;to act that way&quot; or &quot;to do an act related to something,&quot; and makes the word a verb.';
      const decoded = MunmekUI.decodeHtmlEntities(rawText);
      expect(decoded).toBe('-hada A suffix that means "to act that way" or "to do an act related to something," and makes the word a verb.');
      expect(decoded).not.toContain('&quot;');

      // 2. decodeHtmlEntities handles quotes, apostrophes, ampersands, and numeric codes
      expect(MunmekUI.decodeHtmlEntities('Tom &amp; Jerry&#39;s &quot;Show&quot; &#60;test&#62;')).toBe('Tom & Jerry\'s "Show" <test>');

      // 3. splitEmbeddedDefinitions decodes entities so HTML does not have double-escaped &amp;quot;
      const split = MunmekUI.splitEmbeddedDefinitions([
        '1. -hada A suffix that means &quot;to act that way&quot;',
        '2. Another sense with &#39;single quotes&#39; &amp; &quot;double&quot;'
      ]);
      expect(split[0]).not.toContain('&amp;quot;');
      expect(split[0]).toContain('&quot;to act that way&quot;');
      expect(MunmekUI.decodeHtmlEntities(MunmekUI.stripHtml(split[0]))).toContain('"to act that way"');

      expect(split[1]).not.toContain('&amp;quot;');
      expect(split[1]).not.toContain('&amp;#39;');
      expect(MunmekUI.decodeHtmlEntities(MunmekUI.stripHtml(split[1]))).toContain("'single quotes'");
      expect(MunmekUI.decodeHtmlEntities(MunmekUI.stripHtml(split[1]))).toContain('"double"');

      // 4. Full renderTooltip check with entity-containing definition
      const state = {
        word: '-하다',
        dictionaryEntries: [
          {
            dictTitle: 'KRDICT EN',
            surface: '-하다',
            base: '-하다',
            definitions: [
              '-hada A suffix that means &quot;to act that way&quot; or &quot;to do an act related to something,&quot; and makes the word a verb.'
            ]
          }
        ]
      };
      MunmekUI.renderTooltip(state, new Map(), () => {}, () => {}, () => {});
      // In the tooltip innerHTML, must never contain double-escaped &amp;quot;
      expect(tooltipEl.innerHTML).not.toContain('&amp;quot;');
      expect(tooltipEl.innerHTML).toContain('&quot;to act that way&quot;');
    });

    it('renders custom prompt fields (e.g. japanese_translation) inside LLM analysis card', () => {
      const targetItem = {
        surface: '과거에',
        base: '과거',
        pos: 'adverbial phrase',
        definitions: ['In the past'],
        conjugation: { ending: '에', explanation: 'Indicates a point in time.' },
        grammar_notes: 'Referring to historical background.',
        japanese_translation: '過去に起きたことだ。'
      };

      const rawAnalysis = {
        words_analysis: [targetItem]
      };

      const customFields = MunmekUI.extractCustomFields(targetItem, rawAnalysis);
      expect(customFields).toEqual([
        {
          key: 'japanese_translation',
          label: 'Japanese Translation',
          value: '過去に起きたことだ。'
        }
      ]);

      const html = MunmekUI.renderAnalysisSection(rawAnalysis, { word: '과거에' });
      expect(html).toContain('LLM: 과거에');
      expect(html).toContain('Japanese Translation:');
      expect(html).toContain('過去に起きたことだ。');
      expect(html).toContain('munmek-custom-field');
    });

    it('renders custom prompt fields when returned at the root level of rawAnalysis', () => {
      const rawAnalysis = {
        words_analysis: [
          {
            surface: '과거에',
            base: '과거',
            pos: 'adverbial phrase',
            definitions: ['In the past']
          }
        ],
        japanese_translation: '過去に起きたことだ。',
        nuance: 'Literary or formal tone'
      };

      const customFields = MunmekUI.extractCustomFields(rawAnalysis.words_analysis[0], rawAnalysis);
      expect(customFields.length).toBe(2);
      expect(customFields[0]).toEqual({
        key: 'japanese_translation',
        label: 'Japanese Translation',
        value: '過去に起きたことだ。'
      });
      expect(customFields[1]).toEqual({
        key: 'nuance',
        label: 'Nuance',
        value: 'Literary or formal tone'
      });

      const html = MunmekUI.renderAnalysisSection(rawAnalysis, { word: '과거에' });
      expect(html).toContain('Japanese Translation:');
      expect(html).toContain('過去に起きたことだ。');
      expect(html).toContain('Nuance:');
      expect(html).toContain('Literary or formal tone');
    });
  });

  describe('Yomitan-Inspired Definition UI & Markup Enhancements', () => {
    it('renders "Show all N definitions ▾" toggle when definition has more than 3 lines', () => {
      const state = {
        word: '부르다',
        sentence: '한국어라고 부르고',
        sentenceKey: '한국어라고 부르고',
        dictionaryEntries: [
          {
            surface: '부르다',
            pos: '동사',
            dictTitle: 'KRDICT',
            definitions: [
              'To call someone by name.\nTo ask someone to come over.\nTo utter a loud shout.\nTo invoke a person in speech.'
            ]
          }
        ],
        dictionaryMatch: '부르다',
        candidateList: [{ text: '부르다', score: 95 }],
        isStage2Enabled: false
      };

      MunmekUI.renderTooltip(state, new Map(), () => {}, () => {}, () => {});
      expect(tooltipEl.innerHTML).toContain('Show all 4 definitions ▾');
      expect(tooltipEl.innerHTML).not.toContain('senses');
    });

    it('preserves ruby and rt markup safely without escaping into &lt;ruby&gt;', () => {
      const escaped = MunmekUI.escapeHtmlPreservingMarkup(
        'Definition: <ruby>過去<rt>かこ</rt></ruby> means past. <script>alert(1)</script> 5 < 10'
      );

      expect(escaped).toContain('<ruby>過去<rt>かこ</rt></ruby>');
      expect(escaped).not.toContain('&lt;ruby&gt;');
      expect(escaped).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(escaped).toContain('5 &lt; 10');
    });

    it('strips rt furigana reading tags in stripHtml to prevent text concatenation pollution', () => {
      const text = MunmekUI.stripHtml('<ruby>過去<rt>かこ</rt></ruby>：すぎ去った時。');
      expect(text).toBe('過去：すぎ去った時。');
      expect(text).not.toContain('かこ');
    });

    it('renders native ruby tags inside definition card', () => {
      const state = {
        word: '과거',
        sentence: '과거에 살다',
        sentenceKey: '과거에 살다',
        dictionaryEntries: [
          {
            surface: '과거',
            pos: '명사',
            dictTitle: 'KRDICT JA',
            definitions: [
              '<ruby>過去<rt>かこ</rt></ruby>：すぎ去った時。'
            ]
          }
        ],
        dictionaryMatch: '과거',
        candidateList: [{ text: '과거', score: 95 }],
        isStage2Enabled: false
      };

      MunmekUI.renderTooltip(state, new Map(), () => {}, () => {}, () => {});
      expect(tooltipEl.innerHTML).toContain('<ruby>過去<rt>かこ</rt></ruby>');
      expect(tooltipEl.innerHTML).not.toContain('&lt;ruby&gt;');
    });

    it('ignores internal metadata keys starting with underscore in extractCustomFields', () => {
      const rawAnalysis = {
        words_analysis: [{
          word: '과거',
          nuance: 'Refers to the past in a formal or historical sense'
        }],
        _responseLanguage: 'English',
        _cached: true,
        custom_note: 'Important vocabulary'
      };
      Object.defineProperty(rawAnalysis, '_hiddenInternal', {
        value: 'hidden',
        enumerable: false
      });

      const fields = MunmekUI.extractCustomFields(rawAnalysis.words_analysis[0], rawAnalysis);
      const keys = fields.map(f => f.key);
      expect(keys).toContain('nuance');
      expect(keys).toContain('custom_note');
      expect(keys).not.toContain('_responseLanguage');
      expect(keys).not.toContain('responseLanguage');
      expect(keys).not.toContain('_cached');
      expect(keys).not.toContain('_hiddenInternal');
    });

    it('adapts Ask LLM button to Refresh LLM (Japanese) when switching dictionaries after initial query', () => {
      const state = {
        word: '과거',
        sentence: '과거에 살다',
        dictionaryEntries: [
          { surface: '과거', dictTitle: 'KRDICT EN', definitions: ['The past.'] },
          { surface: '과거', dictTitle: 'KRDICT JA', definitions: ['過去。'] }
        ],
        selectedGroupIndex: 0,
        currentAnalysisLanguage: 'English'
      };

      // Initial: before any analysis
      let actionsHtml = MunmekUI.renderActions(state, false);
      expect(actionsHtml).toContain('✨ Ask LLM');
      expect(actionsHtml).not.toContain('Refresh in');

      // After English analysis
      actionsHtml = MunmekUI.renderActions(state, true);
      expect(actionsHtml).toContain('✨ Refresh LLM');
      expect(actionsHtml).not.toContain('Refresh in');

      // Switch to Japanese dictionary tab
      state.selectedGroupIndex = 1;
      actionsHtml = MunmekUI.renderActions(state, true);
      expect(actionsHtml).toContain('✨ Refresh LLM (Japanese)');
      expect(actionsHtml).not.toContain('Refresh in');

      // Once Japanese analysis is cached
      state.cachedAnalysesByLang = {
        'Japanese': { words_analysis: [{ word: '과거' }] }
      };
      state.currentAnalysisLanguage = 'Japanese';
      actionsHtml = MunmekUI.renderActions(state, true);
      expect(actionsHtml).toContain('✨ Refresh LLM');
      expect(actionsHtml).not.toContain('Refresh LLM (Japanese)');
    });

    it('does not render top banner when switching between multi-dictionary tabs', () => {
      const state = {
        word: '과거',
        sentence: '과거에 살다',
        dictionaryEntries: [
          { surface: '과거', dictTitle: 'KRDICT EN', definitions: ['The past.'] },
          { surface: '과거', dictTitle: 'KRDICT JA', definitions: ['過去。'] }
        ],
        selectedGroupIndex: 1,
        currentAnalysisLanguage: 'English'
      };

      const html = MunmekUI.renderDictionaryEntriesGrouped(state.dictionaryEntries, '과거', state);
      expect(html).not.toContain('munmek-dict-lang-banner');
      expect(html).not.toContain('Viewing KRDICT JA');
      expect(html).toContain('Dict: KRDICT JA');
    });
  });
});


