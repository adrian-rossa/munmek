import { describe, it, expect } from 'vitest';

// Pure logic implementations matching background.js template helpers
function buildTemplateContext(data) {
  const dictionaryEntry = data.dictionaryEntry || {};
  const analysis = data.analysis || {};
  const definitions = Array.isArray(dictionaryEntry.definitions) ? dictionaryEntry.definitions : [];

  const ctx = {
    word: data.word || '',
    base: dictionaryEntry.base || analysis.base || data.word || '',
    pos: dictionaryEntry.pos || analysis.pos || '',
    definition: data.selectedDefinition || definitions.join('; ') || analysis.translation || analysis.definition || '',
    translation: analysis.translation || analysis.definition || '',
    grammar: analysis.grammar || analysis.grammar_notes || dictionaryEntry.grammar_notes || '',
    hanja: analysis.hanja || dictionaryEntry.hanja || '',
    notes: analysis.notes || dictionaryEntry.grammar_notes || '',
    sentence: data.sentence || '',
    prevSentence: data.prevSentence || '',
    nextSentence: data.nextSentence || '',
    candidate: data.candidate || '',
    analysisJson: analysis ? JSON.stringify(analysis, null, 2) : ''
  };

  if (analysis && typeof analysis === 'object') {
    Object.keys(analysis).forEach((key) => {
      if (!(key in ctx)) {
        const val = analysis[key];
        ctx[key] = typeof val === 'object' ? JSON.stringify(val) : String(val ?? '');
      }
    });
  }

  return ctx;
}

function renderTemplate(template, context) {
  let result = String(template || '');
  Object.keys(context).forEach((key) => {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'gi');
    result = result.replace(regex, context[key] !== undefined && context[key] !== null ? String(context[key]) : '');
  });
  return result.replace(/\{\{[^}]+\}\}/g, '');
}

function convertNewlinesToBr(str) {
  if (typeof str !== 'string' || !str) return '';
  return str.replace(/\r?\n/g, '<br>');
}

describe('Background Template & Dynamic Context Rendering', () => {
  it('renders standard built-in placeholders correctly', () => {
    const data = {
      word: '인구는',
      sentence: '한국어 사용 인구는 약 8천만 명이다.',
      dictionaryEntry: { base: '인구', pos: 'noun', definitions: ['population'] }
    };
    const ctx = buildTemplateContext(data);
    const rendered = renderTemplate('Front: {{word}}, Base: {{base}}, Def: {{definition}}', ctx);

    expect(rendered).toBe('Front: 인구는, Base: 인구, Def: population');
  });

  it('dynamically renders custom LLM JSON fields in template placeholders', () => {
    const data = {
      word: '장수왕',
      analysis: {
        cultural_context: 'King Jangsu of Goguryeo (5th century)',
        formality_level: 'historical'
      }
    };
    const ctx = buildTemplateContext(data);
    const rendered = renderTemplate('Note: {{cultural_context}} (Level: {{formality_level}})', ctx);

    expect(rendered).toBe('Note: King Jangsu of Goguryeo (5th century) (Level: historical)');
  });

  it('removes unhandled double brace placeholders cleanly', () => {
    const ctx = { word: 'test' };
    const rendered = renderTemplate('{{word}} - {{missing_field}}', ctx);
    expect(rendered).toBe('test - ');
  });

  it('converts multi-line definition newlines into <br> tags for Anki HTML rendering', () => {
    const data = {
      word: '저녁',
      selectedDefinition: 'evening\nThe hours between the time when the sun starts setting and the time when the night falls.'
    };
    const ctx = buildTemplateContext(data);
    const rendered = renderTemplate('{{definition}}', ctx);
    const converted = convertNewlinesToBr(rendered);

    expect(converted).toBe('evening<br>The hours between the time when the sun starts setting and the time when the night falls.');
  });
});
