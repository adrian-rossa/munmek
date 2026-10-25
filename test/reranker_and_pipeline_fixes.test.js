import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Stage 2 Reranking & NLP Pipeline Fixes', () => {
  let Lemmatizer;
  let KoreanPipeline;
  let MunmekUI;
  let parseNetflixTitleString;

  beforeAll(async () => {
    // 1. Load Lemmatizer
    const jamoCode = fs.readFileSync(path.resolve('src/nlp/korean_jamo.js'), 'utf8');
    const lemmatizerCode = fs.readFileSync(path.resolve('src/nlp/korean_lemmatizer.js'), 'utf8');
    const pipelineCode = fs.readFileSync(path.resolve('src/nlp/korean_pipeline.js'), 'utf8');
    const contentUiCode = fs.readFileSync(path.resolve('src/content/content_ui.js'), 'utf8');
    const backgroundCode = fs.readFileSync(path.resolve('src/background/background.js'), 'utf8');

    const globalObj = {
      console: console,
      Set: Set,
      Map: Map,
      Array: Array,
      String: String,
      Number: Number,
      Math: Math,
      parseInt: parseInt,
      RegExp: RegExp,
      Date: Date
    };

    // Run Jamo and Lemmatizer in sandbox
    const runInScope = new Function('window', 'globalThis', `
      ${jamoCode}
      ${lemmatizerCode}
      ${pipelineCode}
      ${contentUiCode}
      return {
        Jamo: window.KoreanJamo || globalThis.KoreanJamo,
        Lemmatizer: window.KoreanLemmatizer || globalThis.KoreanLemmatizer,
        KoreanPipeline: window.KoreanPipeline || globalThis.KoreanPipeline,
        MunmekUI: window.MunmekUI || globalThis.MunmekUI
      };
    `);

    const scope = runInScope(globalObj, globalObj);
    Lemmatizer = scope.Lemmatizer;
    KoreanPipeline = scope.KoreanPipeline;
    MunmekUI = scope.MunmekUI;

    // Extract parseNetflixTitleString from background.js
    const bgScope = new Function('window', 'globalThis', `
      ${backgroundCode}
      return { parseNetflixTitleString };
    `);
    parseNetflixTitleString = bgScope({}, {}).parseNetflixTitleString;
  });

  describe('Component 1: Netflix Multilingual Title & Episode Parsing', () => {
    it('parses German Netflix episode formats (Flg. 2 and Folge 2)', () => {
      const de1 = parseNetflixTitleString('Avatar – Der Herr der Elemente: Flg. 2 | Netflix');
      expect(de1.showTitle).toBe('Avatar – Der Herr der Elemente');
      expect(de1.episodeNumber).toBe(2);

      const de2 = parseNetflixTitleString('Dark: Staffel 1, Folge 3 | Netflix');
      expect(de2.showTitle).toBe('Dark');
      expect(de2.seasonNumber).toBe(1);
      expect(de2.episodeNumber).toBe(3);
    });

    it('parses French, Spanish, and Japanese Netflix title strings', () => {
      const fr = parseNetflixTitleString('Lupin: Saison 1 - Ép. 4 | Netflix');
      expect(fr.showTitle).toBe('Lupin');
      expect(fr.seasonNumber).toBe(1);
      expect(fr.episodeNumber).toBe(4);

      const es = parseNetflixTitleString('La Casa de Papel: Temporada 2, Cap. 5 | Netflix');
      expect(es.showTitle).toBe('La Casa de Papel');
      expect(es.seasonNumber).toBe(2);
      expect(es.episodeNumber).toBe(5);

      const ja = parseNetflixTitleString('Gokusen: 第2話 | Netflix');
      expect(ja.showTitle).toBe('Gokusen');
      expect(ja.episodeNumber).toBe(2);
    });
  });

  describe('Component 2: Lemmatizer & Particle Stripping Fixes', () => {
    it('strips compound quotative particle 라고는 to yield clean noun stem 무기', () => {
      const stripped = Lemmatizer.stripParticles('무기라고는');
      const particleHit = stripped.find((s) => s.particle === '라고는');
      expect(particleHit).toBeDefined();
      expect(particleHit.stem).toBe('무기');
    });

    it('protects atomic root nouns ending in 이 from false subject particle stripping', () => {
      // 원숭이 should NOT have '이' stripped to '원숭'
      const monkey = Lemmatizer.stripParticles('원숭이');
      const falseSubject = monkey.find((s) => s.particle === '이' && s.stem === '원숭');
      expect(falseSubject).toBeUndefined();

      // 뚱보원숭이 should NOT have '이' stripped to '뚱보원숭'
      const fatMonkey = Lemmatizer.stripParticles('뚱보원숭이');
      const falseMonkey = fatMonkey.find((s) => s.particle === '이' && s.stem === '뚱보원숭');
      expect(falseMonkey).toBeUndefined();

      // 고양이 should NOT have '이' stripped to '고양'
      const cat = Lemmatizer.stripParticles('고양이');
      expect(cat.find((s) => s.particle === '이' && s.stem === '고양')).toBeUndefined();
    });

    it('blocks spurious verb deconjugation on quotative stems (no 무기라골다 or 무기라다)', () => {
      const deconj = Lemmatizer.deconjugateVerbAdjective('무기라고는');
      const spuriousRieul = deconj.find((c) => c.lemma === '무기라골다');
      const spuriousDa = deconj.find((c) => c.lemma === '무기라다');
      expect(spuriousRieul).toBeUndefined();
      expect(spuriousDa).toBeUndefined();
    });
  });

  describe('Component 6: Compound Chain Quality-Weighted Scoring', () => {
    it('prefers substantive words (뚱보 + 원숭이) over invalid particle split (뚱보원숭 + 이)', () => {
      const candidates = [
        { text: '뚱보원숭이', score: 100, posHint: 'noun' },
        { text: '뚱보원숭', score: 90, posHint: 'noun', reason: 'stem subword' },
        { text: '뚱보', score: 78, posHint: 'noun', reason: 'prefix subword (뚱보)' },
        { text: '이', score: 75, posHint: 'particle' },
        { text: '원숭이', score: 70, posHint: 'noun', reason: 'suffix subword (원숭이)' }
      ];

      const chain = MunmekUI.findCompoundChain(candidates, '뚱보원숭이');
      expect(chain).not.toBeNull();
      expect(chain.parts.length).toBe(2);
      expect(chain.parts[0].text).toBe('뚱보');
      expect(chain.parts[1].text).toBe('원숭이');
    });
  });

  describe('Component 5: Confidence Badge Threshold & Tab Deconfliction', () => {
    it('suppresses ✨ Context Matched badge when confidence is below 70%', () => {
      const entry = {
        surface: '부르다',
        pos: 'Adjective',
        definitions: ['1. full Feeling stomach stuffed\n2. having big belly'],
        _koelectraMatched: true,
        _bestDefIndex: 0,
        _confidenceScore: '52%',
        _defConfidenceScores: ['52%', '48%']
      };

      const html = MunmekUI.renderSingleEntryCard(entry, 'IndexedDB Match', 0, { isStage2Enabled: true });
      // Under 70%, the header badge must NOT display ✨ Context Matched
      expect(html).not.toContain('✨ Context Matched');
      // Tabs should show the percentage without sparkle
      expect(html).toContain('(52%)');
      expect(html).not.toContain('Def 1: full Feeling one... (52%) ✨');
    });

    it('displays ✨ Context Matched badge when confidence is >= 70%', () => {
      const entry = {
        surface: '부르다',
        pos: 'Verb',
        definitions: ['call for; gesture', 'sing To sing a song'],
        _koelectraMatched: true,
        _bestDefIndex: 0,
        _confidenceScore: '83%',
        _defConfidenceScores: ['83%', '17%']
      };

      const html = MunmekUI.renderSingleEntryCard(entry, 'IndexedDB Match', 0, { isStage2Enabled: true });
      expect(html).toContain('✨ Context Matched · 83%');
      expect(html).toContain('✨');
    });

    it('deconflicts sparkles: when Ask LLM matches Def 2, Stage 2 does not put a conflicting sparkle on Def 1', () => {
      const entry = {
        surface: '부르다',
        pos: 'Verb',
        definitions: ['call for; gesture', 'sing To sing a song'],
        _koelectraMatched: true,
        _bestDefIndex: 0,
        _confidenceScore: '83%',
        _defConfidenceScores: ['83%', '17%']
      };

      const state = {
        isStage2Enabled: true,
        geminiMatchedGroupIndex: 0,
        geminiMatchedItemIndex: 0,
        geminiMatchedDefIndex: 1 // LLM matched Def 2
      };

      const html = MunmekUI.renderSingleEntryCard(entry, 'IndexedDB Match', 0, state);
      // Header has LLM Matched
      expect(html).toContain('✨ LLM Matched');
      // Only the LLM matched tab (Def 2) should have the sparkle, not Def 1
      expect(html).not.toContain('✨ Context Matched');
    });

    it('always displays confidence scores on single-definition entries (with no tabs)', () => {
      const singleDefConfident = {
        surface: '가설',
        pos: 'Noun',
        definitions: ['어떤 사실을 설명하기 위해 임시로 세운 이론. (hypothesis)'],
        _koelectraMatched: true,
        _bestDefIndex: 0,
        _confidenceScore: '65%'
      };

      const htmlConfident = MunmekUI.renderSingleEntryCard(singleDefConfident, 'IndexedDB Match', 0, { isStage2Enabled: true });
      expect(htmlConfident).toContain('✨ Context Matched · 65%');

      const singleDefSecondary = {
        surface: '가설',
        pos: 'Noun',
        definitions: ['시설이나 설비를 임시로 설치함. (temporary installation)'],
        _koelectraMatched: false,
        _bestDefIndex: 0,
        _confidenceScore: '28%'
      };

      const htmlSecondary = MunmekUI.renderSingleEntryCard(singleDefSecondary, 'IndexedDB Match', 1, { isStage2Enabled: true });
      // Single definition entry must visibly display its score in the header badge
      expect(htmlSecondary).toContain('Score · 28%');
    });

    it('selects Def 1 (call for, call out) over Def 2 (check names) for 부르다 when LLM states "to call or to name"', () => {
      const state = {
        word: '부르고',
        originalHoverWord: '부르고',
        dictionaryMatch: '부르다',
        dictionaryEntries: [
          {
            dictTitle: 'KRDICT EN',
            surface: '부르다',
            pos: 'Verb',
            definitions: [
              'call for; call out for; gesture\nTo ask someone to come or draw his/her attention through words or actions.',
              'call out; check; do\nTo check by reading aloud names or a list of names.',
              'say; read; dictate\nTo say words or sentences for someone to write down.',
              'sing\nTo sing to a tune.',
              'cause; bring about\nTo cause a certain situation or emotion.'
            ],
            _bestDefIndex: 0,
            _confidenceScore: '92%'
          }
        ]
      };

      const analysisData = {
        words_analysis: [
          {
            surface: '부르고',
            base: '부르다',
            pos: 'verb',
            definitions: ["The present progressive or simple form of the verb 'to call' or 'to name'."]
          }
        ]
      };

      MunmekUI.autoSelectBestDefinitionFromGemini(state, analysisData);

      // Def 1 (defIndex: 0) must be matched by Ask LLM, NOT Def 2 (defIndex: 1)
      expect(state.geminiMatchedItemIndex).toBe(0);
      expect(state.geminiMatchedDefIndex).toBe(0);
    });
  });
});
