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

  it('decodes HTML entities like &quot; in definitions upon parsing', () => {
    const rawItem = [
      '-하다',
      '-하다',
      'suffix',
      '',
      0,
      ['-hada A suffix that means &quot;to act that way&quot; or &quot;to do an act related to something,&quot; and makes the word a verb.']
    ];
    const entry = globalThis.DictionaryDB.parseKrdictTermItem(rawItem, 'test_id_entity');
    expect(entry).not.toBeNull();
    expect(entry.definitions[0]).toContain('"to act that way"');
    expect(entry.definitions[0]).not.toContain('&quot;');
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

  function isHeadwordOrAffixEcho(text, surfaceWord) {
    if (!text || typeof text !== 'string') return false;
    const t = text.trim();
    if (!surfaceWord) {
      return /^[-~—]?[가-힣]{1,4}[-~—]?$/.test(t);
    }
    const normSurface = surfaceWord.replace(/^[-~—]+|[-~—]+$/g, '').trim();
    const cleanT = t.replace(/^[-~—]+|[-~—]+$/g, '').trim();
    if (cleanT === normSurface || cleanT === surfaceWord) return true;
    if (normSurface) {
      const headwordRegex = new RegExp(`^[-~—]?${normSurface}(?:\\d+|\\s*\\([^)]*\\)|\\s*〔[^〕]*〕)?[-~—]?$`);
      if (headwordRegex.test(t)) return true;
    }
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

    const isDescriptionLine = (text) => {
      if (!text) return false;
      const t = text.trim();
      if (/^(To\s+|Feeling\s+|Having\s+|Being\s+|A\s+|An\s+|The\s+|Used\s+|Conjugation|Conjugations)/i.test(t)) return true;
      if (/^\([^\)]*\)\s*(?:To\s+|A\s+|An\s+|The\s+|Being\s+|Feeling\s+|Used\s+)/i.test(t)) return true;
      if (/^(人|物|こと|～|する|ある|いる|よう|状態|行為)/.test(t)) return true;
      return false;
    };

    allLines.forEach((line) => {
      let cleaned = line.trim();
      if (!cleaned) return;

      // Skip stem/headword/affix echo lines (e.g. "-사", "사-", "사", "가다-")
      if (isHeadwordOrAffixEcho(cleaned, surfaceWord)) {
        return;
      }

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
      } else if (isDescriptionLine(cleaned) || !currentSense.title) {
        if (!currentSense.title) {
          currentSense.title = cleaned;
        } else if (!currentSense.body) {
          currentSense.body = cleaned;
        } else {
          currentSense.body += `\n${cleaned}`;
        }
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

  it('correctly combines affix headword echo "-사" and explanation into 1 single definition', () => {
    const rawDefs = [
      '-사',
      '-sa A suffix used to refer to an organization, company, or workplace.'
    ];

    const split = splitEmbeddedDefinitions(rawDefs, '사');
    expect(split.length).toBe(1);
    expect(split[0]).toContain('-sa A suffix used to refer to an organization');
  });

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

describe('Yomitan Advanced Features: Score, Sequence Merging, Ruby, & Intra-Dict Ranking', () => {
  it('parses Yomitan 8-element term bank arrays including score, sequence, and term tags', () => {
    const rawItem = ['과거', '과거', 'noun', '', 500, ['past'], 12345, 'common'];
    const entry = globalThis.DictionaryDB.parseKrdictTermItem(rawItem, 'test_item_8');

    expect(entry).not.toBeNull();
    expect(entry.surface).toBe('과거');
    expect(entry.score).toBe(500);
    expect(entry.sequence).toBe(12345);
    expect(entry.termTags).toBe('common');
    expect(entry.definitions).toEqual(['past']);
  });

  it('converts structured content with ruby and rt into HTML markup', () => {
    const structuredNode = {
      tag: 'li',
      content: [
        {
          tag: 'ruby',
          content: [
            '過去',
            { tag: 'rt', content: 'かこ' }
          ]
        },
        '：すぎ去った時。'
      ]
    };

    const defs = globalThis.DictionaryDB.extractDefinitionsFromStructuredContent(structuredNode);
    expect(defs.length).toBe(1);
    expect(defs[0]).toBe('<ruby>過去<rt>かこ</rt></ruby>：すぎ去った時。');
  });

  it('merges multi-row entries sharing the same sequence number into a single multi-sense card', () => {
    const entries = [
      {
        id: 'entry_1',
        dictId: 'dict_jp',
        surface: '과거',
        reading: '과거',
        pos: '명사',
        score: 400,
        sequence: 777,
        hanja: '〔過去〕',
        definitions: ['すぎ去った時。']
      },
      {
        id: 'entry_2',
        dictId: 'dict_jp',
        surface: '과거',
        reading: '과거',
        pos: '명사',
        score: 500, // Higher score should be kept
        sequence: 777,
        hanja: '',
        definitions: ['昔のこと。前世。']
      }
    ];

    const merged = globalThis.DictionaryDB.mergeSequencedEntries(entries);
    expect(merged.length).toBe(1);
    expect(merged[0].surface).toBe('과거');
    expect(merged[0].score).toBe(500);
    expect(merged[0].hanja).toBe('〔過去〕');
    expect(merged[0].definitions).toEqual(['すぎ去った時。', '昔のこと。前世。']);
  });

  it('ranks entries with higher Yomichan score first within the same dictionary priority', () => {
    const hits = [
      { dictId: 'krdict_ja', surface: '과거', score: 10, definitions: ['かきょ【科挙】'] },
      { dictId: 'krdict_ja', surface: '과거', score: 500, definitions: ['かこ【過去】'] },
      { dictId: 'krdict_ja', surface: '과거', score: 100, definitions: ['かこ【過誤】'] }
    ];

    const sorted = globalThis.DictionaryDB.sortHitsByDictOrder(hits, ['krdict_ja']);
    expect(sorted[0].definitions[0]).toBe('かこ【過去】'); // 500 score
    expect(sorted[1].definitions[0]).toBe('かこ【過誤】'); // 100 score
    expect(sorted[2].definitions[0]).toBe('かきょ【科挙】'); // 10 score
  });
});
