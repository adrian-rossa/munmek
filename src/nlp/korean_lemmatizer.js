/**
 * Korean Morphological Lemmatizer & Rule Engine
 * Handles particle stripping, copulas, honorifics, tenses, and irregular verb/adjective de-conjugations.
 */
(function (global) {
  'use strict';

  const Jamo = (typeof globalThis !== 'undefined' && globalThis.KoreanJamo) || (typeof module !== 'undefined' && module.exports ? require('./korean_jamo') : global.KoreanJamo);

  const PARTICLES = [
    // Multi-syllable particles (longest match first)
    { text: '으로부터', type: 'particle', rule: 'particle-from' },
    { text: '에서부터', type: 'particle', rule: 'particle-from-starting' },
    { text: '이야말로', type: 'particle', rule: 'particle-emphasis-이야말로' },
    { text: '야말로', type: 'particle', rule: 'particle-emphasis-야말로' },
    { text: '에게서', type: 'particle', rule: 'particle-from-person' },
    { text: '한테서', type: 'particle', rule: 'particle-from-person' },
    { text: '보다는', type: 'particle', rule: 'particle-than-topic' },
    { text: '에서도', type: 'particle', rule: 'particle-at-also' },
    { text: '에서는', type: 'particle', rule: 'particle-at-topic' },
    { text: '에서의', type: 'particle', rule: 'particle-at-possessive' },
    { text: '에게는', type: 'particle', rule: 'particle-to-person-topic' },
    { text: '한테는', type: 'particle', rule: 'particle-to-person-topic' },
    { text: '으로의', type: 'particle', rule: 'particle-towards-possessive' },
    { text: '까지는', type: 'particle', rule: 'particle-until-topic' },
    { text: '부터는', type: 'particle', rule: 'particle-from-topic' },
    { text: '로서의', type: 'particle', rule: 'particle-status-possessive' },
    { text: '로써의', type: 'particle', rule: 'particle-means-possessive' },
    { text: '로서는', type: 'particle', rule: 'particle-status-topic' },
    { text: '로써는', type: 'particle', rule: 'particle-means-topic' },

    // Standard 2-syllable particles
    { text: '에는', type: 'particle', rule: 'particle-in/at-topic' },
    { text: '에도', type: 'particle', rule: 'particle-in/at-also' },
    { text: '에의', type: 'particle', rule: 'particle-in/at-possessive' },
    { text: '에서', type: 'particle', rule: 'particle-at/in/from' },
    { text: '에게', type: 'particle', rule: 'particle-to-person' },
    { text: '한테', type: 'particle', rule: 'particle-to-person' },
    { text: '께는', type: 'particle', rule: 'particle-to-person-hon-topic' },
    { text: '께도', type: 'particle', rule: 'particle-to-person-hon-also' },
    { text: '까지', type: 'particle', rule: 'particle-until' },
    { text: '부터', type: 'particle', rule: 'particle-from' },
    { text: '으로', type: 'particle', rule: 'particle-by/towards' },
    { text: '으로서', type: 'particle', rule: 'particle-as-status' },
    { text: '으로써', type: 'particle', rule: 'particle-by-means' },
    { text: '로서', type: 'particle', rule: 'particle-as-status' },
    { text: '로써', type: 'particle', rule: 'particle-by-means' },
    { text: '보다', type: 'particle', rule: 'particle-than' },
    { text: '처럼', type: 'particle', rule: 'particle-like' },
    { text: '같이', type: 'particle', rule: 'particle-like' },
    { text: '조차', type: 'particle', rule: 'particle-even' },
    { text: '마저', type: 'particle', rule: 'particle-even/until-last' },
    { text: '밖에', type: 'particle', rule: 'particle-nothing-but' },
    { text: '이야', type: 'particle', rule: 'particle-emphasis' },
    { text: '이나', type: 'particle', rule: 'particle-or/as-many-as' },
    { text: '하고', type: 'particle', rule: 'particle-and/with' },
    { text: '이랑', type: 'particle', rule: 'particle-and/with' },
    { text: '과의', type: 'particle', rule: 'particle-and-possessive' },
    { text: '와의', type: 'particle', rule: 'particle-and-possessive' },
    { text: '마다', type: 'particle', rule: 'particle-every' },
    { text: '대로', type: 'particle', rule: 'particle-according-to' },
    { text: '만큼', type: 'particle', rule: 'particle-as-much-as' },
    { text: '따라', type: 'particle', rule: 'particle-specifically-on' },
    { text: '치고', type: 'particle', rule: 'particle-considering' },

    // Single-syllable particles
    { text: '에', type: 'particle', rule: 'locative-dative-particle-e' },
    { text: '께', type: 'particle', rule: 'dative-hon-particle-kke' },
    { text: '게', type: 'particle', rule: 'dative-particle-ge' },
    { text: '은', type: 'particle', rule: 'topic-particle-eun', requiresBatchim: true },
    { text: '는', type: 'particle', rule: 'topic-particle-neun', requiresBatchim: false },
    { text: '이', type: 'particle', rule: 'subject-particle-i', requiresBatchim: true },
    { text: '가', type: 'particle', rule: 'subject-particle-ga', requiresBatchim: false },
    { text: '을', type: 'particle', rule: 'object-particle-eul', requiresBatchim: true },
    { text: '를', type: 'particle', rule: 'object-particle-reul', requiresBatchim: false },
    { text: '의', type: 'particle', rule: 'possessive-particle-ui' },
    { text: '도', type: 'particle', rule: 'also-particle-do' },
    { text: '만', type: 'particle', rule: 'only-particle-man' },
    { text: '로', type: 'particle', rule: 'towards-particle-ro' },
    { text: '과', type: 'particle', rule: 'and-particle-gwa', requiresBatchim: true },
    { text: '와', type: 'particle', rule: 'and-particle-wa', requiresBatchim: false },
    { text: '나', type: 'particle', rule: 'or-particle-na' },
    { text: '랑', type: 'particle', rule: 'with-particle-rang' }
  ];

  const COPULAS = [
    { text: '입니다', replacement: '', rule: 'copula-formal-입니다' },
    { text: '입니까', replacement: '', rule: 'copula-formal-question-입니까' },
    { text: '이에요', replacement: '', rule: 'copula-polite-이에요' },
    { text: '예요', replacement: '', rule: 'copula-polite-예요' },
    { text: '이다', replacement: '', rule: 'copula-base-이다' },
    { text: '이고', replacement: '', rule: 'copula-connective-이고' },
    { text: '이며', replacement: '', rule: 'copula-connective-이며' },
    { text: '인', replacement: '', rule: 'copula-modifier-인' },
    { text: '일', replacement: '', rule: 'copula-future-modifier-일' }
  ];

  function stripParticles(surface) {
    const results = [];
    if (!surface || surface.length <= 1) return results;

    for (const p of PARTICLES) {
      if (surface.length > p.text.length && surface.endsWith(p.text)) {
        const stem = surface.slice(0, -p.text.length);
        const lastChar = stem[stem.length - 1];

        if (p.requiresBatchim === true && !Jamo.hasBatchim(lastChar)) {
          continue;
        }
        if (p.requiresBatchim === false && Jamo.hasBatchim(lastChar)) {
          continue;
        }

        results.push({
          stem,
          rule: p.rule,
          particle: p.text,
          score: 85 - p.text.length
        });
      }
    }

    for (const c of COPULAS) {
      if (surface.length > c.text.length && surface.endsWith(c.text)) {
        const stem = surface.slice(0, -c.text.length);
        results.push({
          stem,
          rule: c.rule,
          particle: c.text,
          score: 80
        });
      }
    }

    return results;
  }

  function deconjugateVerbAdjective(surface) {
    const candidates = [];
    const addCandidate = (lemma, rule, confidence, details = {}) => {
      if (!lemma || lemma.length < 2 || !lemma.endsWith('다')) return;
      if (!candidates.some(c => c.lemma === lemma && c.rule === rule)) {
        candidates.push({ lemma, rule, confidence, ...details });
      }
    };

    // Direct check if surface is already dictionary citation form
    if (surface.endsWith('다')) {
      addCandidate(surface, 'citation form', 100);
    }

    // 1. Regular Endings De-conjugation
    deconjugateRegularEndings(surface, addCandidate);

    // 2. Vowel Contraction De-conjugation (-아/어요, -았/었어요, informal contractions)
    deconjugateVowelContractions(surface, addCandidate);

    // 3. Irregular Conjugation Rules
    deconjugateBaeupIrregular(surface, addCandidate);      // ㅂ 불규칙
    deconjugateDigeutIrregular(surface, addCandidate);     // ㄷ 불규칙
    deconjugateRieulDrop(surface, addCandidate);           // ㄹ 탈락
    deconjugateSiotIrregular(surface, addCandidate);       // ㅅ 불규칙
    deconjugateHieutIrregular(surface, addCandidate);      // ㅎ 불규칙
    deconjugateEuDrop(surface, addCandidate);              // ㅡ 탈락
    deconjugateReuIrregular(surface, addCandidate);        // 르 불규칙

    return candidates.sort((a, b) => b.confidence - a.confidence);
  }

  function deconjugateRegularEndings(surface, addCandidate) {
    const endings = [
      // Formal polite
      { suffix: '습니다', replacement: '다', confidence: 90, rule: 'formal polite -습니다' },
      { suffix: '습니까', replacement: '다', confidence: 90, rule: 'formal polite question -습니까' },
      { suffix: '습니다만', replacement: '다', confidence: 90, rule: 'formal polite -습니다만' },
      { suffix: 'ㅂ니다', replacement: '다', removeBatchim: true, confidence: 90, rule: 'formal polite -ㅂ니다' },
      { suffix: 'ㅂ니까', replacement: '다', removeBatchim: true, confidence: 90, rule: 'formal polite question -ㅂ니까' },

      // Honorific + Past
      { suffix: '으셨습니다', replacement: '다', confidence: 88, rule: 'honorific past -으셨습니다' },
      { suffix: '셨습니다', replacement: '다', confidence: 88, rule: 'honorific past -셨습니다' },
      { suffix: '으셨어요', replacement: '다', confidence: 88, rule: 'honorific past -으셨어요' },
      { suffix: '셨어요', replacement: '다', confidence: 88, rule: 'honorific past -셨어요' },
      { suffix: '으셨다', replacement: '다', confidence: 85, rule: 'honorific past -으셨다' },
      { suffix: '셨다', replacement: '다', confidence: 85, rule: 'honorific past -셨다' },

      // Honorific present / mood
      { suffix: '으세요', replacement: '다', confidence: 85, rule: 'honorific polite -으세요' },
      { suffix: '세요', replacement: '다', confidence: 85, rule: 'honorific polite -세요' },
      { suffix: '으십니다', replacement: '다', confidence: 85, rule: 'honorific formal -으십니다' },
      { suffix: '십니다', replacement: '다', confidence: 85, rule: 'honorific formal -십니다' },
      { suffix: '으시군요', replacement: '다', confidence: 85, rule: 'honorific exclamation -으시군요' },
      { suffix: '시군요', replacement: '다', confidence: 85, rule: 'honorific exclamation -시군요' },

      // Propositive, intentional & suggestion endings
      { suffix: '을까요', replacement: '다', confidence: 88, rule: 'propositive question -을까요' },
      { suffix: 'ㄹ까요', replacement: '다', removeBatchim: true, confidence: 88, rule: 'propositive question -ㄹ까요' },
      { suffix: '까요', replacement: '다', removeBatchim: true, confidence: 82, rule: 'question -까요' },
      { suffix: '을게요', replacement: '다', confidence: 88, rule: 'intention -을게요' },
      { suffix: 'ㄹ게요', replacement: '다', removeBatchim: true, confidence: 88, rule: 'intention -ㄹ게요' },
      { suffix: '을게', replacement: '다', confidence: 85, rule: 'intention -을게' },
      { suffix: 'ㄹ게', replacement: '다', removeBatchim: true, confidence: 85, rule: 'intention -ㄹ게' },
      { suffix: '을래요', replacement: '다', confidence: 88, rule: 'intention -을래요' },
      { suffix: 'ㄹ래요', replacement: '다', removeBatchim: true, confidence: 88, rule: 'intention -ㄹ래요' },
      { suffix: '을래', replacement: '다', confidence: 85, rule: 'intention -을래' },
      { suffix: 'ㄹ래', replacement: '다', removeBatchim: true, confidence: 85, rule: 'intention -ㄹ래' },
      { suffix: '읍시다', replacement: '다', confidence: 88, rule: 'propositive -읍시다' },
      { suffix: 'ㅂ시다', replacement: '다', removeBatchim: true, confidence: 88, rule: 'propositive -ㅂ시다' },
      { suffix: '으러', replacement: '다', confidence: 80, rule: 'purpose -으러' },
      { suffix: '러', replacement: '다', confidence: 75, rule: 'purpose -러' },
      { suffix: '으려고요', replacement: '다', confidence: 85, rule: 'intent -으려고요' },
      { suffix: '려고요', replacement: '다', confidence: 85, rule: 'intent -려고요' },

      // Conversational endings & discovery/exclamation
      { suffix: '잖아요', replacement: '다', confidence: 85, rule: 'confirmation -잖아요' },
      { suffix: '잖아', replacement: '다', confidence: 82, rule: 'confirmation -잖아' },
      { suffix: '더라고요', replacement: '다', confidence: 85, rule: 'recollection -더라고요' },
      { suffix: '더라구요', replacement: '다', confidence: 85, rule: 'recollection -더라구요' },
      { suffix: '더군요', replacement: '다', confidence: 85, rule: 'recollection -더군요' },
      { suffix: '더라', replacement: '다', confidence: 82, rule: 'recollection -더라' },
      { suffix: '던데요', replacement: '다', confidence: 85, rule: 'recollection -던데요' },
      { suffix: '던데', replacement: '다', confidence: 82, rule: 'recollection -던데' },
      { suffix: '거든요', replacement: '다', confidence: 85, rule: 'explanatory -거든요' },
      { suffix: '거든', replacement: '다', confidence: 80, rule: 'explanatory -거든' },
      { suffix: '는군요', replacement: '다', confidence: 85, rule: 'exclamation -는군요' },
      { suffix: '는구나', replacement: '다', confidence: 82, rule: 'exclamation -는구나' },
      { suffix: '구나', replacement: '다', confidence: 80, rule: 'exclamation -구나' },
      { suffix: '으니까', replacement: '다', confidence: 80, rule: 'reason -으니까' },
      { suffix: '니까', replacement: '다', confidence: 78, rule: 'reason -니까' },
      { suffix: '으니', replacement: '다', confidence: 75, rule: 'connective -으니' },
      { suffix: '니', replacement: '다', confidence: 70, rule: 'interrogative/connective -니' },
      { suffix: '나요', replacement: '다', confidence: 80, rule: 'interrogative -나요' },
      { suffix: '은가요', replacement: '다', confidence: 80, rule: 'interrogative -은가요' },
      { suffix: 'ㄴ가요', replacement: '다', removeBatchim: true, confidence: 80, rule: 'interrogative -ㄴ가요' },
      { suffix: '은가', replacement: '다', confidence: 75, rule: 'interrogative -은가' },
      { suffix: 'ㄴ가', replacement: '다', removeBatchim: true, confidence: 75, rule: 'interrogative -ㄴ가' },
      { suffix: '은지', replacement: '다', confidence: 75, rule: 'clause -은지' },
      { suffix: 'ㄴ지', replacement: '다', removeBatchim: true, confidence: 75, rule: 'clause -ㄴ지' },
      { suffix: '는지', replacement: '다', confidence: 75, rule: 'clause -는지' },

      // Past tense
      { suffix: '었습니다', replacement: '다', confidence: 88, rule: 'past formal -었습니다' },
      { suffix: '았습니다', replacement: '다', confidence: 88, rule: 'past formal -았습니다' },
      { suffix: '였습니다', replacement: '다', confidence: 88, rule: 'past formal -였습니다' },
      { suffix: '었어요', replacement: '다', confidence: 85, rule: 'past polite -었어요' },
      { suffix: '았어요', replacement: '다', confidence: 85, rule: 'past polite -았어요' },
      { suffix: '였어요', replacement: '다', confidence: 85, rule: 'past polite -였어요' },
      { suffix: '었다', replacement: '다', confidence: 85, rule: 'past plain -었다' },
      { suffix: '았다', replacement: '다', confidence: 85, rule: 'past plain -았다' },
      { suffix: '였다', replacement: '다', confidence: 85, rule: 'past plain -였다' },
      { suffix: '했다', replacement: '하다', replaceLast: true, confidence: 92, rule: 'past 하다 -> 했다' },
      { suffix: '했어요', replacement: '하다', replaceLast: true, confidence: 92, rule: 'past polite 하다 -> 했어요' },
      { suffix: '했습니다', replacement: '하다', replaceLast: true, confidence: 92, rule: 'past formal 하다 -> 했습니다' },

      // Polite / Casual
      { suffix: '어요', replacement: '다', confidence: 80, rule: 'polite ending -어요' },
      { suffix: '아요', replacement: '다', confidence: 80, rule: 'polite ending -아요' },
      { suffix: '여요', replacement: '다', confidence: 80, rule: 'polite ending -여요' },
      { suffix: '어', replacement: '다', confidence: 72, rule: 'informal/connective -어' },
      { suffix: '아', replacement: '다', confidence: 72, rule: 'informal/connective -아' },
      { suffix: '여', replacement: '다', confidence: 72, rule: 'informal/connective -여' },
      { suffix: '해요', replacement: '하다', replaceLast: true, confidence: 90, rule: 'polite 하다 -> 해요' },
      { suffix: '지요', replacement: '다', confidence: 80, rule: 'polite ending -지요' },
      { suffix: '죠', replacement: '다', confidence: 80, rule: 'polite ending -죠' },
      { suffix: '네요', replacement: '다', confidence: 80, rule: 'polite ending -네요' },
      { suffix: '군요', replacement: '다', confidence: 80, rule: 'polite ending -군요' },

      // Connectives & Clausal
      { suffix: '고서', replacement: '다', confidence: 78, rule: 'sequential connective -고서' },
      { suffix: '고', replacement: '다', confidence: 80, rule: 'connective -고' },
      { suffix: '거나', replacement: '다', confidence: 75, rule: 'disjunctive -거나' },
      { suffix: '자', replacement: '다', confidence: 70, rule: 'temporal -자' },
      { suffix: '게', replacement: '다', confidence: 70, rule: 'adverbial -게' },
      { suffix: '지', replacement: '다', confidence: 70, rule: 'negation/suspective -지' },
      { suffix: '는데', replacement: '다', confidence: 75, rule: 'connective -는데' },
      { suffix: '은데', replacement: '다', confidence: 75, rule: 'connective -은데' },
      { suffix: 'ㄴ데', replacement: '다', removeBatchim: true, confidence: 75, rule: 'connective -ㄴ데' },
      { suffix: '어서', replacement: '다', confidence: 75, rule: 'cause connective -어서' },
      { suffix: '아서', replacement: '다', confidence: 75, rule: 'cause connective -아서' },
      { suffix: '여서', replacement: '다', confidence: 75, rule: 'cause connective -여서' },
      { suffix: '해서', replacement: '하다', replaceLast: true, confidence: 85, rule: 'cause 하다 -> 해서' },
      { suffix: '으면', replacement: '다', confidence: 75, rule: 'conditional -으면' },
      { suffix: '면', replacement: '다', confidence: 70, rule: 'conditional -면' },
      { suffix: '지만', replacement: '다', confidence: 75, rule: 'contrast -지만' },
      { suffix: '자마자', replacement: '다', confidence: 75, rule: 'temporal -자마자' },
      { suffix: '도록', replacement: '다', confidence: 75, rule: 'purpose -도록' },
      { suffix: '려고', replacement: '다', confidence: 75, rule: 'intent -려고' },
      { suffix: '으려고', replacement: '다', confidence: 75, rule: 'intent -으려고' },

      // Adnominal Modifiers
      { suffix: '는', replacement: '다', confidence: 70, rule: 'present modifier -는' },
      { suffix: '은', replacement: '다', confidence: 70, rule: 'past modifier -은' },
      { suffix: 'ㄴ', replacement: '다', removeBatchim: true, confidence: 70, rule: 'past modifier -ㄴ' },
      { suffix: '을', replacement: '다', confidence: 70, rule: 'future modifier -을' },
      { suffix: 'ㄹ', replacement: '다', removeBatchim: true, confidence: 70, rule: 'future modifier -ㄹ' }
    ];

    for (const e of endings) {
      if (surface.endsWith(e.suffix) && (surface.length > e.suffix.length || e.replaceLast || surface === e.suffix)) {
        if (e.replaceLast && e.suffix) {
          const replaced = surface.slice(0, -e.suffix.length) + e.replacement;
          addCandidate(replaced, e.rule, e.confidence);
          continue;
        }

        let stem = surface.slice(0, -e.suffix.length);

        if (e.removeBatchim && stem.length > 0) {
          const lastChar = stem[stem.length - 1];
          const batchim = Jamo.getBatchim(lastChar);
          if (batchim === 'ㄴ' || batchim === 'ㅂ' || batchim === 'ㄹ') {
            stem = stem.slice(0, -1) + Jamo.setBatchim(lastChar, '');
          }
        }

        addCandidate(stem + e.replacement, e.rule, e.confidence);
      }
    }
  }

  // Deconjugates Korean vowel contractions in polite present (해요체) and past tense (았/었어요, 았다)
  function deconjugateVowelContractions(surface, addCandidate) {
    if (!surface || surface.length < 1) return;

    // Guard: require at least 1 Hangul syllable in the stem before attempting vowel contraction
    // This prevents nouns like 바나나, 커피, 카페 from generating spurious *다 candidates
    const hangulSyllableCount = [...surface].filter(c => {
      const code = c.charCodeAt(0);
      return code >= 0xAC00 && code <= 0xD7A3;
    }).length;
    if (hangulSyllableCount < 2) return;

    // 1. Present tense contractions ending in '요' or standalone informal forms
    const formsToTest = [];
    if (surface.endsWith('요') && surface.length >= 2) {
      formsToTest.push({ stem: surface.slice(0, -1), isPolite: true });
    }
    if (!surface.endsWith('다') && !surface.endsWith('요')) {
      formsToTest.push({ stem: surface, isPolite: false });
    }

    for (const { stem, isPolite } of formsToTest) {
      if (!stem || stem.length === 0) continue;
      if (stem.endsWith('다') || stem.endsWith('까')) continue;
      if (stem.endsWith('었') || stem.endsWith('았') || stem.endsWith('였') || stem.endsWith('했')) continue;
      if (stem.length >= 2 && (stem.endsWith('어') || stem.endsWith('아'))) {
        const prevChar = stem[stem.length - 2];
        if (Jamo.getBatchim(prevChar) === 'ㅆ') continue;
      }

      const lastChar = stem[stem.length - 1];
      if (!Jamo.isHangulSyllable(lastChar)) continue;

      const decomp = Jamo.decomposeChar(lastChar);
      const { initial, vowel, final } = decomp;
      const prefix = stem.slice(0, -1);
      const conf = isPolite ? 88 : 78;

      if (!final) {
        // -ㅐ stem (꺼내요 -> 꺼내다, 보내요 -> 보내다, 지내요 -> 지내다, 끝내요 -> 끝내다)
        if (vowel === 'ㅐ') {
          if (lastChar === '해') {
            addCandidate(prefix + '하다', 'polite 하다 (해요 -> 하다)', 92);
          } else {
            addCandidate(prefix + lastChar + '다', 'vowel contraction (-ㅐ -> -ㅐ다)', conf);
          }
        }
        // -ㅔ stem (세요 -> 세다, 베요 -> 베다)
        else if (vowel === 'ㅔ') {
          addCandidate(prefix + lastChar + '다', 'vowel contraction (-ㅔ -> -ㅔ다)', conf);
        }
        // -ㅏ stem (가요 -> 가다, 들어가요 -> 들어가다, 나가요 -> 나가다, 만나요 -> 만나다, 자요 -> 자다, 사요 -> 사다)
        else if (vowel === 'ㅏ') {
          addCandidate(prefix + lastChar + '다', 'vowel contraction (-ㅏ -> -ㅏ다)', conf);
        }
        // -ㅓ stem (서요 -> 서다, 건너요 -> 건너다, 켜요 -> 켜다)
        else if (vowel === 'ㅓ') {
          addCandidate(prefix + lastChar + '다', 'vowel contraction (-ㅓ -> -ㅓ다)', conf);
        }
        // -ㅕ stem (ㅣ-contraction: 기다려요 -> 기다리다, 마셔요 -> 마시다, 가르쳐요 -> 가르치다, 던져요 -> 던지다, 다녀요 -> 다니다, 달려요 -> 달리다, 보여요 -> 보이다, 헤어져요 -> 헤어지다)
        else if (vowel === 'ㅕ') {
          const iChar = Jamo.composeChar(initial, 'ㅣ', '');
          if (iChar) {
            addCandidate(prefix + iChar + '다', 'ㅣ-contraction (-ㅕ -> -이다)', conf);
          }
        }
        // -ㅘ stem (ㅗ-contraction: 봐요 -> 보다, 와요 -> 오다, 돌아와요 -> 돌아오다, 돌아봐요 -> 돌아보다)
        else if (vowel === 'ㅘ') {
          const oChar = Jamo.composeChar(initial, 'ㅗ', '');
          if (oChar) {
            addCandidate(prefix + oChar + '다', 'ㅗ-contraction (-ㅘ -> -오다/-보다)', conf);
          }
        }
        // -ㅝ stem (ㅜ-contraction: 배워요 -> 배우다, 줘요 -> 주다, 바꿔요 -> 바꾸다, 키워요 -> 키우다, 세워요 -> 세우다, 도와줘요 -> 도와주다)
        else if (vowel === 'ㅝ') {
          const uChar = Jamo.composeChar(initial, 'ㅜ', '');
          if (uChar) {
            addCandidate(prefix + uChar + '다', 'ㅜ-contraction (-ㅝ -> -우다/-주다)', conf);
          }
        }
        // -ㅙ stem (ㅚ-contraction: 돼요 -> 되다, 봬요 -> 뵈다)
        else if (vowel === 'ㅙ') {
          const oeChar = Jamo.composeChar(initial, 'ㅚ', '');
          if (oeChar) {
            addCandidate(prefix + oeChar + '다', 'ㅚ-contraction (-ㅙ -> -되다)', conf + 2);
          }
        }
      }
    }

    // 2. Past tense contractions with ㅆ batchim (e.g. 갔어요/갔다, 들어갔어요/들어갔다, 꺼냈어요/꺼냈다, 기다렸어요/기다렸다, 봤어요/봤다, 배웠어요/배웠다, 줬어요/줬다, 됐어요/됐다)
    const pastMatch = surface.match(/([가-힣]*?)([가-힣])(었|았|였)?(습니다|습니까|어요|다|어|던|지요|죠|으면|자마자|지만|는데)?$/);
    if (pastMatch) {
      const ssChar = pastMatch[2];
      if (ssChar && Jamo.isHangulSyllable(ssChar) && Jamo.getBatchim(ssChar) === 'ㅆ') {
        const decomp = Jamo.decomposeChar(ssChar);
        const { initial, vowel } = decomp;
        const prefix = pastMatch[1] || '';
        const conf = 88;

        const prevChar = prefix ? prefix[prefix.length - 1] : '';
        const isReuPattern = prevChar && Jamo.getBatchim(prevChar) === 'ㄹ' && (ssChar === '랐' || ssChar === '렀');

        if (ssChar === '했') {
          addCandidate(prefix + '하다', 'past 하다 -> 했다', 92);
        } else if (vowel === 'ㅏ' && !isReuPattern) {
          const cleanChar = Jamo.composeChar(initial, 'ㅏ', '');
          if (cleanChar) addCandidate(prefix + cleanChar + '다', 'past contraction (-았- -> -다)', conf);
        } else if (vowel === 'ㅓ' && !isReuPattern) {
          const cleanChar = Jamo.composeChar(initial, 'ㅓ', '');
          if (cleanChar) addCandidate(prefix + cleanChar + '다', 'past contraction (-었- -> -다)', conf);
        } else if (vowel === 'ㅐ') {
          const cleanChar = Jamo.composeChar(initial, 'ㅐ', '');
          if (cleanChar) addCandidate(prefix + cleanChar + '다', 'past contraction (-했/-냈 -> -다)', conf);
        } else if (vowel === 'ㅔ') {
          const cleanChar = Jamo.composeChar(initial, 'ㅔ', '');
          if (cleanChar) addCandidate(prefix + cleanChar + '다', 'past contraction (-벴/-셌 -> -다)', conf);
        } else if (vowel === 'ㅕ') {
          // 기다렸어요 -> 기다리다, 마셨어요 -> 마시다, 가르쳤어요 -> 가르치다
          const iChar = Jamo.composeChar(initial, 'ㅣ', '');
          if (iChar) addCandidate(prefix + iChar + '다', 'past contraction (-였- -> -이다)', conf);
        } else if (vowel === 'ㅘ') {
          // 봤어요 -> 보다, 왔어요 -> 오다
          const oChar = Jamo.composeChar(initial, 'ㅗ', '');
          if (oChar) addCandidate(prefix + oChar + '다', 'past contraction (-왔/-봤 -> -오다/-보다)', conf);
        } else if (vowel === 'ㅝ') {
          // 배웠어요 -> 배우다, 줬어요 -> 주다
          const uChar = Jamo.composeChar(initial, 'ㅜ', '');
          if (uChar) addCandidate(prefix + uChar + '다', 'past contraction (-웠 -> -우다/-주다)', conf);
        } else if (vowel === 'ㅙ') {
          // 됐어요 -> 되다
          const oeChar = Jamo.composeChar(initial, 'ㅚ', '');
          if (oeChar) addCandidate(prefix + oeChar + '다', 'past contraction (-됐 -> -되다)', conf + 2);
        }
      }
    }
  }

  // ㅂ 불규칙 (e.g., 평화로웠던 -> 평화롭다, 반가워 -> 반갑다, 아름다워 -> 아름답다, 도와 -> 돕다)
  function deconjugateBaeupIrregular(surface, addCandidate) {
    const patterns = [
      { regex: /([가-힣]+)로웠([던가-힣]*)$/, replace: '$1롭다', rule: 'ㅂ-irregular (-로웠- -> -롭다)', conf: 88 },
      { regex: /([가-힣]+)로운$/, replace: '$1롭다', rule: 'ㅂ-irregular (-로운 -> -롭다)', conf: 88 },
      { regex: /([가-힣]+)로워([요서가-힣]*)$/, replace: '$1롭다', rule: 'ㅂ-irregular (-로워 -> -롭다)', conf: 88 },
      { regex: /([가-힣]+)웠([던가-힣]*)$/, type: 'b_past', conf: 82 },
      { regex: /([가-힣]+)워([요서가-힣]*)$/, type: 'b_present', conf: 82 },
      { regex: /([가-힣]+)운$/, type: 'b_modifier', conf: 80 }
    ];

    for (const p of patterns) {
      const match = surface.match(p.regex);
      if (match) {
        if (p.replace) {
          addCandidate(match[1] ? match[1] + p.replace.slice(2) : match[0], p.rule, p.conf);
          continue;
        }

        const prefix = match[1];
        if (prefix && prefix.length > 0) {
          const lastChar = prefix[prefix.length - 1];
          if (Jamo.isHangulSyllable(lastChar) && !Jamo.hasBatchim(lastChar)) {
            const stemWithB = prefix.slice(0, -1) + Jamo.setBatchim(lastChar, 'ㅂ');
            addCandidate(stemWithB + '다', `ㅂ-irregular (-워/-웠- -> -ㅂ다)`, p.conf);
          }
        }
      }
    }

    if (surface === '도와' || surface.startsWith('도왔') || surface.startsWith('도와서')) {
      addCandidate('돕다', 'ㅂ-irregular (도와 -> 돕다)', 90);
    }
    if (surface === '곱아' || surface.startsWith('고왔') || surface.startsWith('고와서')) {
      addCandidate('곱다', 'ㅂ-irregular (고와 -> 곱다)', 90);
    }
  }

  // ㄷ 불규칙 (e.g., 들어요 -> 듣다/들다, 걸어 -> 걷다/걸다, 물어 -> 묻다/물다)
  function deconjugateDigeutIrregular(surface, addCandidate) {
    const patterns = [
      { regex: /^(들)(어|어요|어서|었다|었어요|었|으면|으니|은|을|으려고|으러|으시면|으세요|으셨|었어|었던|었음)$/, stem: '듣', conf: 85, rule: 'ㄷ-irregular (들 -> 듣다)' },
      { regex: /^(걸)(어|어요|어서|었다|었어요|었|으면|으니|은|을|으려고|으러|으시면|으세요|으셨|었어|었던|었음)$/, stem: '걷', conf: 85, rule: 'ㄷ-irregular (걸 -> 걷다)' },
      { regex: /^(물)(어|어요|어서|었다|었어요|었|으면|으니|은|을|으려고|으러|으시면|으세요|으셨|었어|었던|었음)$/, stem: '묻', conf: 85, rule: 'ㄷ-irregular (물 -> 묻다)' },
      { regex: /^(실)(어|어요|어서|었다|었어요|었|으면|으니|은|을|으려고|으러|으시면|으세요|으셨|었어|었던|었음)$/, stem: '싣', conf: 85, rule: 'ㄷ-irregular (실 -> 싣다)' }
    ];

    for (const p of patterns) {
      if (p.regex.test(surface)) {
        addCandidate(p.stem + '다', p.rule, p.conf);
      }
    }

    // Specific prefixed ㄷ-irregulars like 깨닫다 (깨달아, 깨달아서, 깨달았어요)
    const kkaedatMatch = surface.match(/^깨달(아|아요|아서|았다|았어요|았|으면|으니|은|을|으려고|으러)$/);
    if (kkaedatMatch) {
      addCandidate('깨닫다', 'ㄷ-irregular (깨달 -> 깨닫다)', 88);
    }
  }

  // ㄹ 탈락 (e.g., 사네요 -> 살다, 아는 -> 알다, 만드세요 -> 만들다)
  function deconjugateRieulDrop(surface, addCandidate) {
    const endings = ['네요', '네요', '세요', '십니다', '습니다', 'ㄴ다', '는', 'ㄴ'];
    for (const end of endings) {
      if (surface.endsWith(end) && surface.length > end.length) {
        const stem = surface.slice(0, -end.length);
        const lastChar = stem[stem.length - 1];
        if (Jamo.isHangulSyllable(lastChar) && !Jamo.hasBatchim(lastChar)) {
          const rieulStem = stem.slice(0, -1) + Jamo.setBatchim(lastChar, 'ㄹ');
          addCandidate(rieulStem + '다', `ㄹ-drop (stem + ㄹ + 다)`, 82);
        }
      }
    }
  }

  // ㅅ 불규칙 (e.g., 지어 -> 짓다, 나아 -> 낫다, 이어 -> 잇다, 부어 -> 붓다)
  function deconjugateSiotIrregular(surface, addCandidate) {
    const patterns = [
      { regex: /^지([어아았었은으이][가-힣]*)$/, stem: '짓', conf: 85, rule: 'ㅅ-irregular (지 -> 짓다)' },
      { regex: /^나([아어았었은으이][가-힣]*)$/, stem: '낫', conf: 85, rule: 'ㅅ-irregular (나 -> 낫다)' },
      { regex: /^이([어아았었은으이][가-힣]*)$/, stem: '잇', conf: 85, rule: 'ㅅ-irregular (이 -> 잇다)' },
      { regex: /^부([어아았었은으이][가-힣]*)$/, stem: '붓', conf: 85, rule: 'ㅅ-irregular (부 -> 붓다)' }
    ];

    for (const p of patterns) {
      if (p.regex.test(surface)) {
        addCandidate(p.stem + '다', p.rule, p.conf);
      }
    }
  }

  // ㅎ 불규칙 (e.g., 그래 -> 그렇다, 빨개 -> 빨갛다, 파래 -> 파랗다, 노래 -> 노랗다)
  function deconjugateHieutIrregular(surface, addCandidate) {
    const colorAdjectives = [
      { surface: '그래', stem: '그렇다', rule: 'ㅎ-irregular (그래 -> 그렇다)' },
      { surface: '그러면', stem: '그렇다', rule: 'ㅎ-irregular (그러면 -> 그렇다)' },
      { surface: '그럴', stem: '그렇다', rule: 'ㅎ-irregular (그럴 -> 그렇다)' },
      { surface: '빨개', stem: '빨갛다', rule: 'ㅎ-irregular (빨개 -> 빨갛다)' },
      { surface: '파래', stem: '파랗다', rule: 'ㅎ-irregular (파래 -> 파랗다)' },
      { surface: '노래', stem: '노랗다', rule: 'ㅎ-irregular (노래 -> 노랗다)' },
      { surface: '까매', stem: '까맣다', rule: 'ㅎ-irregular (까매 -> 까맣다)' },
      { surface: '하얘', stem: '하얗다', rule: 'ㅎ-irregular (하얘 -> 하얗다)' }
    ];

    for (const item of colorAdjectives) {
      if (surface.startsWith(item.surface)) {
        addCandidate(item.stem, item.rule, 88);
      }
    }
  }

  // ㅡ 탈락 (e.g., 배고파요 -> 배고프다, 써 -> 쓰다, 커 -> 크다, 기뻐요 -> 기쁘다, 아파요 -> 아프다)
  function deconjugateEuDrop(surface, addCandidate) {
    if (surface === '써' || surface.startsWith('썼') || surface.startsWith('써서') || surface.startsWith('써요')) {
      addCandidate('쓰다', 'ㅡ-drop (써 -> 쓰다)', 90);
    }
    if (surface === '커' || surface.startsWith('컸') || surface.startsWith('커서') || surface.startsWith('커요')) {
      addCandidate('크다', 'ㅡ-drop (커 -> 크다)', 90);
    }
    if (surface === '꺼' || surface.startsWith('껐') || surface.startsWith('꺼서') || surface.startsWith('꺼요')) {
      addCandidate('끄다', 'ㅡ-drop (꺼 -> 끄다)', 90);
    }

    if (surface.includes('고파')) {
      const prefix = surface.replace(/고파.*$/, '');
      addCandidate(prefix + '고프다', 'ㅡ-drop (-고파 -> -고프다)', 92);
    }

    const euMatch = surface.match(/([가-힣]*)([파뻐퍼프])([요서도면지라았었ㄴㄹ]*)$/);
    if (euMatch) {
      const prefix = euMatch[1] || '';
      const v = euMatch[2];
      if (v === '파' || v === '퍼') addCandidate(prefix + '프다', 'ㅡ-drop (-파/-퍼 -> -프다)', 88);
      if (v === '뻐') addCandidate(prefix + '쁘다', 'ㅡ-drop (-뻐 -> -쁘다)', 88);
    }
  }

  // 르 불규칙 (e.g., 빨라/빨랐어요 -> 빠르다, 불러/불렀어요 -> 부르다, 몰라/몰랐어요 -> 모르다, 골라/골랐어요 -> 고르다, 달라/달랐어요 -> 다르다)
  function deconjugateReuIrregular(surface, addCandidate) {
    const match = surface.match(/([가-힣]+)([라러랐렀])([서요었다던지면가-힣]*)$/);
    if (match) {
      const prefix = match[1];
      const lastChar = prefix[prefix.length - 1];

      if (Jamo.getBatchim(lastChar) === 'ㄹ') {
        const cleanChar = Jamo.setBatchim(lastChar, '');
        const stem = prefix.slice(0, -1) + cleanChar + '르';
        addCandidate(stem + '다', '르-irregular (-ㄹ라/-ㄹ러/-ㄹ랐- -> -르다)', 90);
      }
    }
  }

  function deconjugate(surface) {
    const candidates = [];
    const push = (text, reason, score = 80) => {
      if (text && !candidates.some(c => c.text === text)) {
        candidates.push({ text, reason, score });
      }
    };

    push(surface, 'surface form', 100);

    const stripped = stripParticles(surface) || [];
    stripped.forEach((item) => {
      if (item && item.stem) push(item.stem, item.rule || 'particle-stripped', 80);
    });

    const deconj = deconjugateVerbAdjective(surface) || [];
    deconj.forEach((item) => {
      if (item && (item.lemma || item.baseForm || item.stem)) {
        push(item.lemma || item.baseForm || item.stem, item.rule || 'deconjugated', item.confidence || item.score || 80);
      }
    });

    return candidates;
  }

  const KoreanLemmatizer = {
    stripParticles,
    deconjugateVerbAdjective,
    deconjugate
  };

  const targetGlobal = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : global);
  targetGlobal.KoreanLemmatizer = KoreanLemmatizer;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = KoreanLemmatizer;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
