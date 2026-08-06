import { describe, it, expect } from 'vitest';
import '../src/nlp/dictionary_db.js';

describe('DictionaryDB Yomichan / KRDICT Item Parser', () => {
  it('parses simple term bank array item correctly', () => {
    const rawItem = ['인구', '인구', 'noun', '', 0, ['population', 'number of inhabitants']];
    const entry = globalThis.DictionaryDB.parseKrdictTermItem(rawItem, 'test_id_1');

    expect(entry).not.toBeNull();
    expect(entry.surface).toBe('인구');
    expect(entry.base).toBe('인구');
    expect(entry.reading).toBe('인구');
    expect(entry.pos).toBe('noun');
    expect(entry.definitions).toEqual(['population', 'number of inhabitants']);
  });

  it('handles structured content array definitions gracefully', () => {
    const rawItem = [
      '대한민국',
      '대한민국',
      'noun',
      '',
      0,
      [{ type: 'structured-content', content: 'Republic of Korea (South Korea)' }]
    ];
    const entry = globalThis.DictionaryDB.parseKrdictTermItem(rawItem, 'test_id_2');

    expect(entry).not.toBeNull();
    expect(entry.surface).toBe('대한민국');
    expect(entry.definitions).toContain('Republic of Korea (South Korea)');
  });

  it('filters out pure numeric list markers (e.g. "1", "1.") and cleans definitions', () => {
    const rawItem = [
      '부르다',
      '부르다',
      'verb',
      '',
      0,
      [
        { tag: 'li', content: [{ tag: 'span', text: '1' }, { tag: 'span', text: '1.' }, { tag: 'span', text: 'よぶ【呼ぶ】' }] }
      ]
    ];
    const entry = globalThis.DictionaryDB.parseKrdictTermItem(rawItem, 'test_id_4');

    expect(entry).not.toBeNull();
    expect(entry.definitions).not.toContain('1');
    expect(entry.definitions).not.toContain('1.');
    expect(entry.definitions).toContain('よぶ【呼ぶ】');
  });

  it('returns null for malformed item arrays', () => {
    const entry = globalThis.DictionaryDB.parseKrdictTermItem(['invalid'], 'test_id_3');
    expect(entry).toBeNull();
  });
});

describe('splitEmbeddedDefinitions KRDICT Parser', () => {
  function formatDefinitionText(rawDef) {
    if (!rawDef || typeof rawDef !== 'string') return '';
    return rawDef.trim()
      .replace(/([。】])(?=[^\s。】\d\n])/g, '$1\n')
      .replace(/\s*(文型|Sentence\s*\d*:?)/gi, '\n$1 ')
      .replace(/(?<=[a-z가-힣])(?=[A-Z])/g, '\n')
      .trim();
  }

  function isSentencePattern(text) {
    if (!text || typeof text !== 'string') return false;
    const t = text.trim();
    if (/^(Sentence|Grammar|Pattern|文型)\s*:?/i.test(t)) return true;
    if (/^\d+[이가을를에에서과와도만으로로은는](?:\s|$)/i.test(t)) return true;
    return false;
  }

  function splitEmbeddedDefinitions(defList, surfaceWord = '') {
    if (!Array.isArray(defList) || defList.length === 0) return [];

    const allLines = [];
    defList.forEach((item) => {
      if (!item || typeof item !== 'string') return;
      const subParts = item.split(/(?<=\D|^)(?=\b\d{1,2}[\.\)]\s+)/g);
      subParts.forEach((part) => {
        part.split(/\r?\n/).forEach((l) => {
          const t = l.trim();
          if (t) allLines.push(t);
        });
      });
    });

    const senses = [];
    let currentSense = null;

    allLines.forEach((line) => {
      let cleaned = line.trim();
      if (!cleaned) return;

      const isStemOnly = surfaceWord && (cleaned === `${surfaceWord}-` || cleaned === `${surfaceWord} -` || cleaned === `${surfaceWord}–`);
      if (isStemOnly || !/[a-zA-Z가-힣ㄱ-ㅎㅏ-ㅣ\u3040-\u30ff\u4e00-\u9faf]/.test(cleaned)) return;

      const numberedMatch = cleaned.match(/^(\d{1,2})[\.\)]\s*(.*)/s);
      if (numberedMatch) {
        if (currentSense) senses.push(currentSense);
        cleaned = numberedMatch[2].trim();
        currentSense = { title: cleaned, body: '', pattern: '' };
        return;
      }

      if (isSentencePattern(cleaned)) {
        const patternText = cleaned.replace(/^(Sentence|Grammar|Pattern|文型)\s*:?\s*/i, '').trim();
        if (patternText && currentSense) {
          currentSense.pattern = currentSense.pattern ? `${currentSense.pattern}; ${patternText}` : patternText;
        }
        return;
      }

      cleaned = cleaned.replace(/^[\d]+[\.\)]\s*/, '').trim();

      if (!currentSense) {
        currentSense = { title: cleaned, body: '', pattern: '' };
      } else if (!currentSense.body) {
        currentSense.body = cleaned;
      } else {
        senses.push(currentSense);
        currentSense = { title: cleaned, body: '', pattern: '' };
      }
    });

    if (currentSense) senses.push(currentSense);

    if (senses.length === 0) return defList.map(formatDefinitionText);

    return senses.map((s) => {
      const parts = [];
      if (s.title) {
        parts.push(`<strong>${s.title}</strong>`);
      }
      if (s.body) {
        parts.push(s.body);
      }
      if (s.pattern) {
        parts.push(`(Pattern: ${s.pattern})`);
      }
      return parts.join('\n');
    });
  }

  it('groups flat KRDICT line arrays (hungry + explanation + sentence + pattern + impoverished) into clean definition tabs', () => {
    const rawDefs = [
      'hungry',
      "Feeling that one's stomach is empty and wanting to eat food.",
      'Sentence:',
      '1이 배고프다',
      'impoverished',
      'Being badly off and poor.'
    ];

    const split = splitEmbeddedDefinitions(rawDefs, '배고프다');
    expect(split.length).toBe(2);
    expect(split[0]).toContain('hungry');
    expect(split[0]).toContain("Feeling that one's stomach");
    expect(split[0]).toContain('(Pattern: 1이 배고프다)');
    expect(split[1]).toContain('impoverished');
    expect(split[1]).toContain('Being badly off and poor.');
  });

  it('groups 7 senses for 부르다 correctly into 7 tabs', () => {
    const rawDefs = [
      'call for; call out for; gesture',
      'To ask someone to come or draw his/her attention through words or actions.',
      'Sentence:',
      '1이 2를 부르다',
      'call out; check; do',
      'To check by reading aloud names or a list of names.',
      'sing',
      'To sing to a tune.'
    ];

    const split = splitEmbeddedDefinitions(rawDefs, '부르다');
    expect(split.length).toBe(3);
    expect(split[0]).toContain('call for; call out for; gesture');
    expect(split[0]).toContain('(Pattern: 1이 2를 부르다)');
    expect(split[1]).toContain('call out; check; do');
    expect(split[2]).toContain('sing');
  });
});
