import { describe, it, expect } from 'vitest';
import { Jamo } from '../src/nlp/korean_jamo.js';
import * as Lemmatizer from '../src/nlp/korean_lemmatizer.js';

/**
 * Negative test cases: verify that nouns and other non-verb forms
 * are NOT incorrectly deconjugated into spurious *다 candidates.
 */
describe('Korean Lemmatizer Negative Tests (False Positive Prevention)', () => {
  function getCandidates(word) {
    const candidates = [];
    Lemmatizer.deconjugateVerbAdjective(word, (form, score, reason) => {
      candidates.push({ form, score, reason });
    });
    return candidates;
  }

  function getCandidateForms(word) {
    return getCandidates(word).map(c => c.form);
  }

  it('바나나 (banana) should NOT generate 바나나다', () => {
    const forms = getCandidateForms('바나나');
    expect(forms).not.toContain('바나나다');
  });

  it('커피 (coffee) should NOT generate 커피다', () => {
    const forms = getCandidateForms('커피');
    expect(forms).not.toContain('커피다');
  });

  it('카페 (cafe) should NOT generate 카페다', () => {
    const forms = getCandidateForms('카페');
    expect(forms).not.toContain('카페다');
  });

  it('라면 (ramen) should NOT generate 라면다', () => {
    const forms = getCandidateForms('라면');
    expect(forms).not.toContain('라면다');
  });

  it('서울 (Seoul) should NOT deconjugate to any *다 form', () => {
    const forms = getCandidateForms('서울');
    const daForms = forms.filter(f => f.endsWith('다'));
    expect(daForms).toHaveLength(0);
  });

  it('컴퓨터 (computer) should NOT deconjugate', () => {
    const forms = getCandidateForms('컴퓨터');
    const daForms = forms.filter(f => f.endsWith('다'));
    expect(daForms).toHaveLength(0);
  });

  it('아이스크림 (ice cream) should NOT generate spurious candidates', () => {
    const forms = getCandidateForms('아이스크림');
    const daForms = forms.filter(f => f.endsWith('다'));
    expect(daForms).toHaveLength(0);
  });

  it('한국어 (Korean language) should NOT generate 한국어다', () => {
    const forms = getCandidateForms('한국어');
    expect(forms).not.toContain('한국어다');
  });

  it('학교 (school) should NOT deconjugate', () => {
    const forms = getCandidateForms('학교');
    const daForms = forms.filter(f => f.endsWith('다'));
    expect(daForms).toHaveLength(0);
  });

  it('사람 (person) should NOT deconjugate', () => {
    const forms = getCandidateForms('사람');
    const daForms = forms.filter(f => f.endsWith('다'));
    expect(daForms).toHaveLength(0);
  });
});
