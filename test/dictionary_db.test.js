import { describe, it, expect } from 'vitest';
import '../dictionary_db.js';

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
