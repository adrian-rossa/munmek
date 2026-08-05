import { describe, it, expect } from 'vitest';

function scanCustomFields(rawAnalysis, targetItem) {
  const reservedKeys = new Set([
    'words_analysis', 'words', 'analysis', 'surface', 'word', 'base', 'pos',
    'definitions', 'definition', 'conjugation', 'notes', 'grammar_notes', 'id',
    'sentence', 'prevSentence', 'nextSentence', 'candidate'
  ]);
  const customCards = [];
  const seenKeys = new Set();

  const scanObj = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      const normKey = k.trim().toLowerCase();
      if (!reservedKeys.has(normKey) && v && !seenKeys.has(normKey)) {
        seenKeys.add(normKey);
        const title = k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        const valStr = typeof v === 'string' ? v : (Array.isArray(v) ? v.join('; ') : JSON.stringify(v));
        customCards.push({ title, value: valStr, rawKey: k });
      }
    }
  };

  scanObj(rawAnalysis);
  scanObj(targetItem);
  return customCards;
}

describe('Custom Gemini Fields Scanner', () => {
  it('extracts german_definition and japanese translation custom prompt fields', () => {
    const rawAnalysis = {
      japanese_translation: 'この文章の日本語訳です。',
      words_analysis: [
        {
          surface: '문맥',
          base: '문맥',
          pos: 'noun',
          definitions: ['context'],
          german_definition: 'Kontext; Zusammenhang'
        }
      ]
    };

    const targetItem = rawAnalysis.words_analysis[0];
    const results = scanCustomFields(rawAnalysis, targetItem);

    expect(results).toEqual([
      { title: 'Japanese Translation', value: 'この文章の日本語訳です。', rawKey: 'japanese_translation' },
      { title: 'German Definition', value: 'Kontext; Zusammenhang', rawKey: 'german_definition' }
    ]);
  });
});
