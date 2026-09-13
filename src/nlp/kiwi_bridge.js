/**
 * Kiwi WASM Morphological Analyzer Bridge
 * Integrates bab2min/Kiwi inside Chrome Offscreen Document and Node.js test environments.
 */
(function (global) {
  'use strict';

  let kiwiInstance = null;
  let kiwiInitPromise = null;

  async function initKiwiEngine(options = {}) {
    if (kiwiInstance) return kiwiInstance;
    if (kiwiInitPromise) return kiwiInitPromise;

    kiwiInitPromise = (async () => {
      const isNode = typeof process !== 'undefined' && process.versions && process.versions.node;
      
      let KiwiBuilder;
      let wasmPath;
      let modelFiles = {};

      if (isNode) {
        const fs = await import('fs');
        const path = await import('path');
        const builderModule = await import('kiwi-nlp/dist/kiwi-builder.js');
        KiwiBuilder = builderModule.KiwiBuilder;
        wasmPath = path.resolve('lib/kiwi/kiwi-wasm.wasm');

        const modelDir = path.resolve('lib/kiwi');
        for (const filename of fs.readdirSync(modelDir)) {
          if (filename.endsWith('.wasm')) continue;
          const fullPath = path.join(modelDir, filename);
          if (fs.statSync(fullPath).isFile()) {
            const buf = fs.readFileSync(fullPath);
            modelFiles[filename] = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
          }
        }
      } else {
        // Browser / Extension Offscreen environment
        const builderModule = await import('../../node_modules/kiwi-nlp/dist/kiwi-builder.js');
        KiwiBuilder = builderModule.KiwiBuilder;
        wasmPath = chrome.runtime.getURL('lib/kiwi/kiwi-wasm.wasm');

        const modelFileNames = ['combiningRule.txt', 'cong.mdl', 'default.dict', 'dialect.dict', 'extract.mdl', 'multi.dict', 'nounchr.mdl', 'sj.morph', 'typo.dict'];
        for (const filename of modelFileNames) {
          const fileUrl = chrome.runtime.getURL('lib/kiwi/' + filename);
          const res = await fetch(fileUrl);
          const buf = await res.arrayBuffer();
          modelFiles[filename] = new Uint8Array(buf);
        }
      }

      const builder = await KiwiBuilder.create(wasmPath);
      kiwiInstance = await builder.build({
        modelFiles,
        integrateAllomorph: true,
        loadDefaultDict: true,
        loadTypoDict: true,
        loadMultiDict: true,
        modelType: 'none'
      });

      return kiwiInstance;
    })();

    return kiwiInitPromise;
  }

  /**
   * Tokenize text and extract high-value morphological candidates with base lemmas and POS tags.
   * Leverages full native Kiwi WASM power: N-Best Top-2 decoding, typo tolerance, normalization,
   * full 23+ POS tagset, and bidirectional compound synthesis & decomposition.
   */
  function analyzeWithKiwi(kiwi, text, targetWord = '') {
    if (!kiwi || !text) return [];

    let topResults = [];
    try {
      // 8454207 is Match.allWithNormalizing (normalizes codas, emojis, allomorphs, and suffixes)
      topResults = kiwi.analyzeTopN(text, 2, 8454207, undefined, undefined, 'basic', 1.5) || [];
    } catch (e) {
      try {
        topResults = kiwi.analyzeTopN(text, 2) || [];
      } catch (e2) {
        topResults = [{ tokens: kiwi.tokenize(text) || [], score: 0 }];
      }
    }

    const candidates = [];
    const seen = new Set();

    const addCandidate = (candText, posHint, score, reason, isSubComponent = false) => {
      const clean = (candText || '').trim();
      if (!clean || seen.has(clean)) return;
      seen.add(clean);
      candidates.push({
        text: clean,
        posHint,
        score,
        reason,
        isSubComponent
      });
    };

    const target = (targetWord || '').trim();
    let targetStart = -1;
    let targetEnd = -1;
    if (target && text) {
      targetStart = text.indexOf(target);
      if (targetStart !== -1) {
        targetEnd = targetStart + target.length;
      }
    }

    topResults.forEach((res, rankIdx) => {
      const tokens = res.tokens || [];
      const rankPenalty = rankIdx === 0 ? 0 : 4;

      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        const str = t.str;
        const tag = t.tag;

        let isTargetOverlap = !target || str.includes(target) || target.includes(str);
        if (targetStart !== -1 && typeof t.position === 'number') {
          const tokenEnd = t.position + (t.length || 1);
          if (t.position < targetEnd && tokenEnd > targetStart) {
            isTargetOverlap = true;
          }
        }

        switch (tag) {
          case 'VV': {
            const baseLemma = str + '다';
            addCandidate(baseLemma, 'verb', (isTargetOverlap ? 96 : 85) - rankPenalty, 'Kiwi verb base (' + baseLemma + ')');
            addCandidate(str, 'verb/stem', 80 - rankPenalty, 'Kiwi verb stem (' + str + ')');
            break;
          }
          case 'VA': {
            const baseLemma = str + '다';
            addCandidate(baseLemma, 'adjective', (isTargetOverlap ? 96 : 85) - rankPenalty, 'Kiwi adjective base (' + baseLemma + ')');
            addCandidate(str, 'adjective/stem', 80 - rankPenalty, 'Kiwi adjective stem (' + str + ')');
            break;
          }
          case 'VX': {
            const baseLemma = str + '다';
            addCandidate(baseLemma, 'verb', (isTargetOverlap ? 92 : 82) - rankPenalty, 'Kiwi auxiliary verb (' + baseLemma + ')', true);
            addCandidate(str, 'verb/stem', 80 - rankPenalty, 'Kiwi auxiliary stem (' + str + ')', true);
            break;
          }
          case 'VCP': {
            addCandidate('이다', 'copula', (isTargetOverlap ? 94 : 85) - rankPenalty, 'Kiwi positive copula (이다)');
            break;
          }
          case 'VCN': {
            addCandidate('아니다', 'copula', (isTargetOverlap ? 94 : 85) - rankPenalty, 'Kiwi negative copula (아니다)');
            break;
          }
          case 'NNG':
          case 'NNP': {
            addCandidate(str, 'noun', (isTargetOverlap ? 94 : 85) - rankPenalty, 'Kiwi noun (' + str + ')');
            break;
          }
          case 'NNB': {
            if (str === '거') {
              addCandidate('것', 'noun', (isTargetOverlap ? 95 : 85) - rankPenalty, 'Kiwi bound noun (거 -> 것)');
              addCandidate('거', 'noun', 85 - rankPenalty, 'Kiwi bound noun (거)');
            } else {
              addCandidate(str, 'noun', (isTargetOverlap ? 92 : 80) - rankPenalty, 'Kiwi bound noun (' + str + ')');
            }
            break;
          }
          case 'NP': {
            addCandidate(str, 'pronoun', (isTargetOverlap ? 94 : 85) - rankPenalty, 'Kiwi pronoun (' + str + ')');
            break;
          }
          case 'NR': {
            addCandidate(str, 'numeral', (isTargetOverlap ? 92 : 82) - rankPenalty, 'Kiwi numeral (' + str + ')');
            break;
          }
          case 'XR': {
            addCandidate(str, 'root', (isTargetOverlap ? 88 : 80) - rankPenalty, 'Kiwi root (' + str + ')');
            break;
          }
          case 'XSN': {
            addCandidate(str, 'noun', (isTargetOverlap ? 88 : 78) - rankPenalty, 'Kiwi noun suffix (' + str + ')');
            break;
          }
          case 'MAG': {
            addCandidate(str, 'adverb', (isTargetOverlap ? 92 : 80) - rankPenalty, 'Kiwi adverb (' + str + ')');
            break;
          }
          case 'MAJ': {
            addCandidate(str, 'adverb', (isTargetOverlap ? 92 : 80) - rankPenalty, 'Kiwi conjunctive adverb (' + str + ')');
            break;
          }
          case 'MM': {
            addCandidate(str, 'determiner', (isTargetOverlap ? 92 : 80) - rankPenalty, 'Kiwi determiner (' + str + ')');
            break;
          }
          case 'IC': {
            addCandidate(str, 'interjection', (isTargetOverlap ? 90 : 78) - rankPenalty, 'Kiwi interjection (' + str + ')');
            break;
          }
          default: {
            if (tag.startsWith('JK') || tag === 'JX' || tag === 'JC') {
              addCandidate(str, 'particle', 75, 'Kiwi particle (' + str + ')');
            } else if (tag === 'EP' || tag === 'EF' || tag === 'EC' || tag === 'ETM' || tag === 'ETN') {
              addCandidate(str, 'grammar', 75, 'Kiwi grammar ending (' + str + ')');
            }
            break;
          }
        }
      }

      // 1. Auxiliary Verb Synthesis (VV + EC + ... + VX -> [Compound]다, e.g. 데려다주다)
      for (let i = 0; i < tokens.length - 1; i++) {
        if (tokens[i].tag === 'VV') {
          const vv = tokens[i];
          let j = i + 1;
          while (j < tokens.length && tokens[j].tag === 'EC') {
            j++;
          }
          if (j < tokens.length && tokens[j].tag === 'VX') {
            const vx = tokens[j];
            if (typeof vv.position === 'number' && typeof vx.position === 'number') {
              const compLemma = text.slice(vv.position, vx.position) + vx.str + '다';
              let isCompOverlap = !target || compLemma.includes(target) || target.includes(vx.str);
              if (targetStart !== -1) {
                const compEnd = vx.position + vx.length;
                if (vv.position < targetEnd && compEnd > targetStart) isCompOverlap = true;
              }
              addCandidate(compLemma, 'verb', (isCompOverlap ? 95 : 86) - rankPenalty, 'Kiwi auxiliary compound (' + compLemma + ')');
            }
          }
        }
      }

      // 2. Predicate Derivation Synthesis (NNG/XR + XSV/XSA -> [Stem]하다 / [Stem]스럽다)
      for (let i = 0; i < tokens.length - 1; i++) {
        const cur = tokens[i];
        const next = tokens[i + 1];
        if ((cur.tag === 'NNG' || cur.tag === 'NNP' || cur.tag === 'XR') && (next.tag === 'XSV' || next.tag === 'XSA')) {
          if (typeof cur.position === 'number' && typeof next.position === 'number') {
            const stemSurface = text.slice(cur.position, next.position + next.length);
            const lemma = stemSurface + '다';
            const pos = next.tag === 'XSV' ? 'verb' : 'adjective';
            let isOverlap = !target || lemma.includes(target) || target.includes(stemSurface);
            addCandidate(lemma, pos, (isOverlap ? 95 : 86) - rankPenalty, 'Kiwi derived predicate (' + lemma + ')');
          }
        }
      }

      // 3. Noun Compounding Synthesis (NNG + NNG / NNG + XSN)
      for (let i = 0; i < tokens.length - 1; i++) {
        const cur = tokens[i];
        const next = tokens[i + 1];
        if ((cur.tag === 'NNG' || cur.tag === 'NNP') && (next.tag === 'NNG' || next.tag === 'NNP' || next.tag === 'XSN')) {
          if (typeof cur.position === 'number' && typeof next.position === 'number') {
            const compNoun = text.slice(cur.position, next.position + next.length);
            let isOverlap = !target || compNoun.includes(target) || target.includes(compNoun);
            addCandidate(compNoun, 'noun', (isOverlap ? 94 : 85) - rankPenalty, 'Kiwi compound noun (' + compNoun + ')');
          }
        }
      }

      // 4. Noun + Copula (NNG/NNP/NNB/NP + VCP -> [Noun]이다)
      for (let i = 0; i < tokens.length - 1; i++) {
        const cur = tokens[i];
        const next = tokens[i + 1];
        if ((cur.tag === 'NNG' || cur.tag === 'NNP' || cur.tag === 'NNB' || cur.tag === 'NP') && next.tag === 'VCP') {
          const nounBase = cur.str === '거' ? '것' : cur.str;
          addCandidate(nounBase + '이다', 'noun/copula', 94 - rankPenalty, 'Kiwi noun + copula (' + nounBase + '이다)');
        }
      }

      // 5. Single-token Compound Verb Decomposition (날아오르다 -> 날다, 오르다)
      for (const t of tokens) {
        if ((t.tag === 'VV' || t.tag === 'VA') && t.str.length >= 3) {
          const s = t.str;
          if (s.startsWith('날아')) {
            addCandidate('날다', 'verb', 82, 'Related sub-verb (날다)', true);
            const rest = s.slice(2);
            if (rest) addCandidate(rest + '다', 'verb', 82, 'Related sub-verb (' + rest + '다)', true);
          } else if (s.startsWith('돌아')) {
            addCandidate('돌다', 'verb', 82, 'Related sub-verb (돌다)', true);
            const rest = s.slice(2);
            if (rest) addCandidate(rest + '다', 'verb', 82, 'Related sub-verb (' + rest + '다)', true);
          } else if (s.startsWith('뛰어')) {
            addCandidate('뛰다', 'verb', 82, 'Related sub-verb (뛰다)', true);
            const rest = s.slice(2);
            if (rest) addCandidate(rest + '다', 'verb', 82, 'Related sub-verb (' + rest + '다)', true);
          } else if (s.startsWith('걸어')) {
            addCandidate('걷다', 'verb', 82, 'Related sub-verb (걷다)', true);
            const rest = s.slice(2);
            if (rest) addCandidate(rest + '다', 'verb', 82, 'Related sub-verb (' + rest + '다)', true);
          } else if (s.startsWith('빠져')) {
            addCandidate('빠지다', 'verb', 82, 'Related sub-verb (빠지다)', true);
            const rest = s.slice(2);
            if (rest) addCandidate(rest + '다', 'verb', 82, 'Related sub-verb (' + rest + '다)', true);
          } else if (s.includes('다니')) {
            addCandidate('다니다', 'verb', 82, 'Related sub-verb (다니다)', true);
          }
        }

        // Subword decomposition for compound nouns (e.g. 감시탑 -> 감시, 탑; 조명탄 -> 조명, 탄)
        if (t.tag === 'NNG' && t.str.length >= 3) {
          const s = t.str;
          const knownSuffixRoots = ['탑', '탄', '권', '점', '계', '법', '론', '자', '성', '력', '물'];
          const lastChar = s[s.length - 1];
          if (knownSuffixRoots.includes(lastChar)) {
            const baseStem = s.slice(0, -1);
            let isBaseOverlap = !target || baseStem.includes(target) || target.includes(baseStem);
            addCandidate(baseStem, 'noun', isBaseOverlap ? 93 : 84, 'Kiwi compound head (' + baseStem + ')', true);
            let isSuffixOverlap = !target || target.includes(lastChar);
            addCandidate(lastChar, 'noun', isSuffixOverlap ? 88 : 78, 'Kiwi compound affix (' + lastChar + ')', true);
          }
        }
      }
    });

    candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
    return candidates;
  }

  const KiwiBridge = {
    initKiwiEngine,
    analyzeWithKiwi
  };

  const targetGlobal = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : global);
  targetGlobal.KiwiBridge = KiwiBridge;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = KiwiBridge;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
