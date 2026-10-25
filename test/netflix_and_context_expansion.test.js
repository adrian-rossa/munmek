import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Netflix Episode Extraction & Context Expansion Tests', () => {
  let bgCode;
  let bgScope;

  beforeEach(() => {
    bgCode = fs.readFileSync(path.resolve(__dirname, '../src/background/background.js'), 'utf8');
    bgScope = {};

    const chromeMock = {
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onMessage: { addListener: vi.fn() }
      },
      storage: {
        local: {
          get: vi.fn((keys, cb) => cb({})),
          set: vi.fn((data, cb) => cb && cb())
        },
        onChanged: { addListener: vi.fn() }
      }
    };

    const fn = new Function('chrome', 'globalThis', `${bgCode};
      return {
        parseNetflixTitleString,
        cleanNetflixTitleString,
        searchTmdbShowOrMovie,
        resolveNetflixTmdbContext,
        fetchTmdbDetails,
        matchBestTmdbResult,
        extractMetadataFromNetflixHtml,
        handleSentenceAnalysisRequest,
        handleQuickGeminiFallback,
        DEFAULT_PROMPT
      };
    `);
    bgScope = fn(chromeMock, globalThis);
  });

  describe('1. German & Multilingual Netflix Episode Extraction', () => {
    it('parses German episode string "Flg. 3" without season as Episode 3', () => {
      const parsed = bgScope.parseNetflixTitleString('Avatar – Der Herr der Elemente: Flg. 3');
      expect(parsed.episodeNumber).toBe(3);
      expect(parsed.showTitle).toBe('Avatar – Der Herr der Elemente');
    });

    it('cleans quotes, streaming suffixes, and episode markers with cleanNetflixTitleString', () => {
      expect(bgScope.cleanNetflixTitleString('„Avatar – Der Herr der Elemente“ ansehen | Netflix')).toBe('Avatar – Der Herr der Elemente');
      expect(bgScope.cleanNetflixTitleString('"Squid Game" online ansehen | Netflix')).toBe('Squid Game');
      expect(bgScope.cleanNetflixTitleString('Crash Landing on You | Watch online')).toBe('Crash Landing on You');
      expect(bgScope.cleanNetflixTitleString('시청하기 더 글로리 | 넷플릭스')).toBe('더 글로리');
    });

    it('cleans quotes, streaming suffixes, and episode tags in searchTmdbShowOrMovie before query', async () => {
      let capturedUrl = '';
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        capturedUrl = String(url);
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ results: [] })
        });
      });

      try {
        await bgScope.searchTmdbShowOrMovie('„Avatar – Der Herr der Elemente“ ansehen | Netflix: Flg. 3', undefined, 'test-key');
        expect(capturedUrl).toContain('query=Avatar+%E2%80%93+Der+Herr+der+Elemente');
        expect(capturedUrl).not.toContain('Flg');
        expect(capturedUrl).not.toContain('ansehen');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('defaults seasonNumber to 1 when episodeNumber is present but season is null in resolveNetflixTmdbContext', async () => {
      const netflixData = {
        title: 'Avatar – Der Herr der Elemente',
        netflixId: '70116062',
        seasonNumber: null,
        episodeNumber: 3,
        hasDirectSynopsis: false
      };

      // Mock TMDB fetch responses
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        const u = String(url);
        if (u.includes('search/multi')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              results: [{ id: 246, name: 'Avatar: The Last Airbender', media_type: 'tv' }]
            })
          });
        }
        if (u.includes('/tv/246/season/1/episode/3')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              name: 'Der südliche Lufttempel',
              overview: 'Aang kehrt in seinen Heimattempel zurück...'
            })
          });
        }
        if (u.includes('/tv/246')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              name: 'Avatar: The Last Airbender',
              overview: 'A boy revealed to be an avatar seeks to save a war-torn world.'
            })
          });
        }
        return Promise.resolve({ ok: false });
      });

      try {
        const resolved = await bgScope.resolveNetflixTmdbContext(netflixData, { tmdbApiKey: 'test-api-key' });
        expect(resolved.tmdbMatched).toBe(true);
        expect(resolved.title).toContain('S1E3');
        expect(resolved.rawText).toContain('Episode (S1E3 - Der südliche Lufttempel): Aang kehrt in seinen Heimattempel zurück...');
        // Episode plot must appear before Show Premise
        const epIndex = resolved.rawText.indexOf('Episode (S1E3');
        const showIndex = resolved.rawText.indexOf('Show Premise:');
        expect(epIndex).toBeLessThan(showIndex);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('fetches German (de-DE) episode overview if Korean overview is empty', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url) => {
        const u = String(url);
        if (u.includes('language=ko-KR') && u.includes('season/1/episode/3')) {
          // Korean overview is empty
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ name: '남쪽 공기 사원', overview: '' })
          });
        }
        if (u.includes('language=de-DE') && u.includes('season/1/episode/3')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              name: 'Der südliche Lufttempel',
              overview: 'Aang kehrt in seinen Heimattempel zurück...'
            })
          });
        }
        if (u.includes('/tv/246')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ name: 'Avatar: The Last Airbender', overview: 'Show premise' })
          });
        }
        return Promise.resolve({ ok: false });
      });

      try {
        const details = await bgScope.fetchTmdbDetails(246, 'tv', null, 3, 'test-key');
        expect(details.episodeDetails).not.toBeNull();
        expect(details.episodeDetails.name).toBe('Der südliche Lufttempel');
        expect(details.episodeDetails.overview).toBe('Aang kehrt in seinen Heimattempel zurück...');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('disambiguates original 2005 Avatar (TMDB 246) from 2024 remake (TMDB 107113) using releaseYear in matchBestTmdbResult', () => {
      const results = [
        {
          id: 107113,
          name: 'Avatar: The Last Airbender',
          first_air_date: '2024-02-22',
          vote_count: 850,
          media_type: 'tv'
        },
        {
          id: 246,
          name: 'Avatar: The Last Airbender',
          first_air_date: '2005-02-21',
          vote_count: 4200,
          media_type: 'tv'
        }
      ];

      // When watching original with releaseYear 2005
      const matched2005 = bgScope.matchBestTmdbResult('Avatar: The Last Airbender', results, { releaseYear: 2005 });
      expect(matched2005.id).toBe(246);

      // When watching 2024 remake with releaseYear 2024
      const matched2024 = bgScope.matchBestTmdbResult('Avatar: The Last Airbender', results, { releaseYear: 2024 });
      expect(matched2024.id).toBe(107113);
    });

    it('extracts releaseYear from Netflix HTML metadata and JSON-LD in extractMetadataFromNetflixHtml', () => {
      const htmlWithJsonLd = `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@type": "TVSeries",
                "name": "Avatar: The Last Airbender",
                "startDate": "2005",
                "description": "Aang seeks to restore balance to the world."
              }
            </script>
          </head>
        </html>
      `;
      const meta = bgScope.extractMetadataFromNetflixHtml(htmlWithJsonLd);
      expect(meta.title).toBe('Avatar: The Last Airbender');
      expect(meta.releaseYear).toBe(2005);
      expect(meta.synopsis).toBe('Aang seeks to restore balance to the world.');
    });
  });

  describe('2. Prompt Upgrades & Homonym Disambiguation', () => {
    it('includes homonym disambiguation rule in DEFAULT_PROMPT', () => {
      expect(bgScope.DEFAULT_PROMPT).toContain('Disambiguate short homonyms (e.g., 차 [tea vs car]');
      expect(bgScope.DEFAULT_PROMPT).toContain('collocations (e.g., 한잔/마시다 -> tea; 타다/운전하다 -> vehicle)');
    });

    it('includes context-grounded grammar and dialogue nuance rules in DEFAULT_PROMPT', () => {
      expect(bgScope.DEFAULT_PROMPT).toContain('In "conjugation", break down grammar in context: [Word] + [Ending] = [Meaning in this sentence]');
      expect(bgScope.DEFAULT_PROMPT).toContain('Use sentence and dialogue context whenever relevant');
      expect(bgScope.DEFAULT_PROMPT).toContain('dialogue_nuance');
      expect(bgScope.DEFAULT_PROMPT).toContain('"dialogue_nuance": "tone and reaction to preceding dialogue (1-2 sentences)"');
    });

    it('formats dialogue context in chronological order in handleSentenceAnalysisRequest', async () => {
      let capturedPrompt = '';
      const originalCallAi = bgScope.callAiChatCompletion;

      // We can inspect prompt construction by providing mock callAi
      const chromeMock = {
        storage: {
          local: {
            get: vi.fn((keys, cb) => cb({ aiProvider: 'custom', customEndpointUrl: 'http://test' }))
          }
        }
      };

      const handlerCode = new Function('chrome', 'globalThis', `${bgCode};
        return {
          buildPrompt: (data) => {
            let dialogueContext = '';
            if (Array.isArray(data.contextLines) && data.contextLines.length > 0) {
              const lines = data.contextLines.filter(Boolean);
              if (lines.length > 0) {
                dialogueContext = 'Preceding Dialogue Context:\\n' + lines.map((l, i) => (i + 1) + '. ' + l).join('\\n') + '\\n';
              }
            }
            return DEFAULT_PROMPT
              .replace('{WORD}', data.word)
              .replace('{SENTENCE}', data.sentence)
              .replace('{DIALOGUE_CONTEXT}', dialogueContext)
              .replace('{CANDIDATE_LINE}', '');
          }
        };
      `);

      const res = handlerCode(chromeMock, globalThis);
      const prompt = res.buildPrompt({
        word: '차',
        sentence: '차나 한잔하면서 말이야',
        contextLines: [
          '흙의 왕국 배와 충돌했어요',
          '심심하던 차에 아주 잘됐군'
        ]
      });

      expect(prompt).toContain('Preceding Dialogue Context:\n1. 흙의 왕국 배와 충돌했어요\n2. 심심하던 차에 아주 잘됐군');
      const line1Idx = prompt.indexOf('1. 흙의 왕국 배와 충돌했어요');
      const line2Idx = prompt.indexOf('2. 심심하던 차에 아주 잘됐군');
      const curSentIdx = prompt.indexOf('차나 한잔하면서 말이야');

      // Must be chronological: Line 1 < Line 2 < Current Sentence
      expect(line1Idx).toBeLessThan(line2Idx);
      expect(line2Idx).toBeLessThan(curSentIdx);
    });
  });

  describe('3. Character Budgeting & Adaptive Subtitle Window', () => {
    it('applies 250 character limit to subtitle context buffer', () => {
      const buffer = [
        '첫 번째 대사입니다. 상황을 설명하는 대사입니다.',
        '두 번째 대사입니다. 주인공이 이야기합니다.',
        '세 번째 대사입니다. 아주 긴 대사입니다. ' + '긴 설명 '.repeat(20),
        '네 번째 대사입니다.'
      ];

      const count = 4;
      const rawLines = [...buffer];
      let totalLen = rawLines.reduce((sum, l) => sum + l.length, 0);
      while (rawLines.length > 1 && totalLen > 250) {
        totalLen -= rawLines.shift().length;
      }

      const totalResultLen = rawLines.reduce((sum, l) => sum + l.length, 0);
      expect(totalResultLen).toBeLessThanOrEqual(250);
      expect(rawLines[rawLines.length - 1]).toBe('네 번째 대사입니다.');
    });

    it('gracefully retrieves last N subtitle cues when current cue has punctuation or timing variation', () => {
      const buffer = [
        '누구야! 누가 내 물개육포 다 먹었어?',
        '어, 먹는 거였어?'
      ];
      const cur = '어젯밤에 내가 불 피우는 데 써 버렸는데';
      const count = 3;
      let idx = buffer.lastIndexOf(cur);
      let rawLines = [];
      if (idx !== -1) {
        rawLines = buffer.slice(Math.max(0, idx - count), idx);
      } else if (buffer.length > 0) {
        rawLines = buffer.slice(-count);
      }
      expect(rawLines).toEqual([
        '누구야! 누가 내 물개육포 다 먹었어?',
        '어, 먹는 거였어?'
      ]);
    });
  });

  describe('4. Standalone Definition Selection with autoSelectLlmDefinition Toggle', () => {
    let MunmekUI;

    beforeEach(() => {
      globalThis.document = {
        createElement: () => ({ style: { setProperty: () => {} }, setAttribute: () => {}, addEventListener: () => {} }),
        body: { appendChild: () => {} }
      };
      const uiCode = fs.readFileSync(path.resolve(__dirname, '../src/content/content_ui.js'), 'utf8');
      const fn = new Function('global', uiCode);
      fn(globalThis);
      MunmekUI = globalThis.MunmekUI;
    });

    it('respects autoSelectLlmDefinition: false in UI tab selection', () => {
      const state = {
        word: '부르다',
        dictionaryEntries: [
          {
            dictTitle: 'KRDICT EN',
            pos: 'verb',
            definitions: ['Sense 1: call out', 'Sense 2: sing', 'Sense 3: full']
          }
        ],
        selectedGroupIndex: 0,
        autoSelectLlmDefinition: false
      };

      const analysis = {
        base: '부르다',
        pos: 'verb',
        definitions: ['call for; invite someone']
      };

      MunmekUI.autoSelectBestDefinitionFromGemini(state, analysis);

      // Match is still calculated
      expect(state.geminiMatchedItemIndex).toBe(0);
      expect(state.geminiMatchedDefIndex).toBe(0);
      // But selectedDefinitionIndex is NOT forced when autoSelectLlmDefinition is false
      expect(state.selectedDefinitionIndex).toBeUndefined();
    });

    it('auto-selects tab when autoSelectLlmDefinition is true or undefined', () => {
      const state = {
        word: '부르다',
        dictionaryEntries: [
          {
            dictTitle: 'KRDICT EN',
            pos: 'verb',
            definitions: ['Sense 1: call out', 'Sense 2: sing', 'Sense 3: full']
          }
        ],
        selectedGroupIndex: 0,
        autoSelectLlmDefinition: true
      };

      const analysis = {
        base: '부르다',
        pos: 'verb',
        definitions: ['call for; invite someone']
      };

      MunmekUI.autoSelectBestDefinitionFromGemini(state, analysis);

      expect(state.geminiMatchedDefIndex).toBe(0);
      expect(state.selectedDefinitionIndex).toBe(0);
    });

    it('renders Context & Tone card in renderAnalysisSection when dialogue_nuance is present', () => {
      const rawAnalysis = {
        words_analysis: [
          {
            surface: '키우냐',
            base: '키우다',
            pos: 'verb',
            definitions: ['grow; raise; keep'],
            conjugation: {
              ending: '냐',
              explanation: 'Informal interrogative ending used here sarcastically or playfully asking if one keeps keys like pets.'
            },
            dialogue_nuance: 'Sarcastic and humorous question to Sokka asking if he somehow breeds keys, reacting to Katara\'s comment.'
          }
        ]
      };
      const state = { word: '키우냐' };
      const html = MunmekUI.renderAnalysisSection(rawAnalysis, state);

      expect(html).toContain('Context & Tone:');
      expect(html).toContain('Sarcastic and humorous question to Sokka');
      expect(html).toContain('Grammar:');
      expect(html).toContain('Ending <code>냐</code> — Informal interrogative ending');
      // Must not duplicate as Context Note
      expect(html).not.toContain('Context Note:');
    });
  });

  describe('5. Options Settings Persistence & Storage', () => {
    it('calls chrome.storage.local.get with null so all settings (subtitleContextLines, autoSelectLlmDefinition, etc.) persist', () => {
      const optionsCode = fs.readFileSync(path.resolve(__dirname, '../src/options/options.js'), 'utf8');
      expect(optionsCode).toContain('chrome.storage.local.get(null');
    });
  });

  describe('6. Web Article & Subtitle Context Extraction Upgrades', () => {
    let contentCode;
    let contentScope;

    beforeEach(() => {
      globalThis.document = {
        createElement: () => ({ style: { setProperty: () => {} }, setAttribute: () => {}, addEventListener: () => {} }),
        body: { appendChild: () => {} },
        contains: () => false,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {}
      };
      globalThis.window = {
        addEventListener: () => {},
        removeEventListener: () => {}
      };
      globalThis.chrome = {
        runtime: { sendMessage: () => {} },
        storage: { local: { get: (k, cb) => cb({}) } }
      };
      globalThis.MutationObserver = class {
        observe() {}
        disconnect() {}
      };
      globalThis.setInterval = () => 123;
      globalThis.clearInterval = () => {};

      contentCode = fs.readFileSync(path.resolve(__dirname, '../src/content/content.js'), 'utf8');
      const fn = new Function('globalThis', 'document', 'window', 'chrome', contentCode);
      fn(globalThis, globalThis.document, globalThis.window, globalThis.chrome);
      contentScope = globalThis.__MunmekContentInternal;
    });

    it('cleans Wikipedia CSS styles and citation brackets from DOM text', () => {
      const mockContainer = {
        cloneNode: () => {
          return {
            querySelectorAll: () => [],
            textContent: '99.9%.mw-parser-output .fix{background-color:var(--background-color-progressive-subtle);}[출처 필요] 이상 대한민국 서울 표준 한국어를 가르친다.'
          };
        }
      };

      const cleaned = contentScope.extractCleanBlockText(mockContainer, '');
      expect(cleaned).not.toContain('.mw-parser-output');
      expect(cleaned).not.toContain('[출처 필요]');
      expect(cleaned).toContain('99.9% 이상 대한민국 서울 표준 한국어를 가르친다.');
    });

    it('returns array of prevSentences in getSentenceWindow up to maxLines', () => {
      const paragraph = '첫 번째 문장입니다. 두 번째 문장입니다. 세 번째 문장입니다. 네 번째 문장입니다. 다섯 번째 문장입니다.';
      const res = contentScope.getSentenceWindow(paragraph, '네 번째 문장', 3);
      expect(res.currentSentence).toBe('네 번째 문장입니다.');
      expect(res.prevSentences).toEqual([
        '첫 번째 문장입니다.',
        '두 번째 문장입니다.',
        '세 번째 문장입니다.'
      ]);
      expect(res.prevSentence).toBe('세 번째 문장입니다.');
      expect(res.prevSentence2).toBe('두 번째 문장입니다.');
    });

    it('does not drop second sentence when p1 is > 120 chars as long as total <= 250 chars', () => {
      const p1 = '1992년 대한민국과 수교 이후에 양국이 활발하게 교류하면서 사회 각층 민간 생활 중에서 ‘한국어’ 또는 ‘한어’ 등의 명칭으로 쓴다.'; // 80+ chars
      const p2 = '중국에서는 과거 조선과의 교류로 인해 주로 조선말이라는 명칭을 사용해 왔으나 이후 변화가 생겼다.'; // ~60 chars
      const sentences = [p2, p1, '대한민국 서울 표준 한국어를 가르친다.'];
      const rawLines = [p2, p1];

      let totalLen = rawLines.reduce((sum, l) => sum + l.length, 0);
      while (rawLines.length > 1 && totalLen > 250) {
        totalLen -= rawLines.shift().length;
      }

      // Both sentences must be retained
      expect(rawLines).toHaveLength(2);
      expect(rawLines[0]).toBe(p2);
      expect(rawLines[1]).toBe(p1);
    });

    it('includes native YouTube and Netflix caption selectors in findAndObserveAsbPlayer', () => {
      expect(contentCode).toContain('.ytp-caption-segment');
      expect(contentCode).toContain('.player-timedtext-text-container');
      expect(contentCode).toContain('availablePrecedingCuesInHistory');
    });
  });
});
