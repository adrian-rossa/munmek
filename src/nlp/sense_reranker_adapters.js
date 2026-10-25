/**
 * Munmek Sense Reranker Adapters
 * Modular disambiguation adapters for dictionary definition senses:
 * - Option C: Direct LLM Chat / Logprob Classification (via standard /v1/chat/completions)
 * - Option A & B: System One Decision Protocol (Verdict, thecodacus parallel-decision, or TypeSafe Jev via /v1/systemone)
 */
(function (global) {
  'use strict';

  const MAX_CANDIDATE_SENSES = 12; // Letters A-L (guaranteed single-token across all tokenizers)
  const MAX_DEF_LENGTH = 130;      // Keeps individual definitions concise to minimize pre-fill latency
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  function cleanDefinitionForPrompt(text, maxLen = MAX_DEF_LENGTH) {
    if (!text || typeof text !== 'string') return '';
    let cleaned = text
      .replace(/<r[tp][^>]*>.*?<\/r[tp]>/gi, '') // Remove ruby pronunciation tags
      .replace(/<[^>]*>/g, '')                  // Remove general HTML tags
      .replace(/\s*\(\s*(?:Sentence|Grammar|Pattern|문형|구문|문법|참고|文형|文型)\s*:.*?[\)\r\n$]/gi, '') // Strip parenthesized patterns
      .replace(/\s*(?:Sentence|Grammar|Pattern|문형|구문|문법|참고|文형|文型)\s*:.*$/gi, '') // Strip grammar patterns
      .replace(/\s*(?:예문?|예|e\.?g\.?|ex\.?|例[文]?)\s*[:：].*$/gi, '') // Strip trailing example sentences
      .replace(/\s+/g, ' ')
      .replace(/[\s\(]+$/g, '')
      .trim();

    if (cleaned.length > maxLen) {
      const cutIdx = cleaned.lastIndexOf(';', maxLen);
      const periodIdx = cleaned.lastIndexOf('.', maxLen);
      const commaIdx = cleaned.lastIndexOf(',', maxLen);
      const bestCut = Math.max(cutIdx, periodIdx, commaIdx);
      if (bestCut > 40) {
        cleaned = cleaned.substring(0, bestCut + 1).trim();
      } else {
        cleaned = cleaned.substring(0, maxLen - 3).trim() + '...';
      }
    }
    return cleaned;
  }

  function isGrammarUsageNote(text) {
    if (!text || typeof text !== 'string') return false;
    const t = text.trim();
    if (/^'[^']+'로도\s*(?:쓴다|쓰인다)/i.test(t)) return true;
    if (/^'(?:에|을|를|으로|로|과|와)?\s*대하여'로도\s*(?:쓴다|쓰인다)/i.test(t)) return true;
    if (/^'[^']+'의\s*형태로\s*(?:쓴다|쓰인다)/i.test(t)) return true;
    if (/^Conjugation variant:/i.test(t)) return true;
    if (/^->\s*/.test(t)) return true;
    if (/^(?:문형|구문|문법|참고)\s*[:：]/i.test(t)) return true;
    return false;
  }

  /**
   * Splits definition strings into individual discrete senses.
   * Handles both Yomitan arrays (where each item is already a sense)
   * and concatenated strings with embedded numbers (e.g. "1. call 2. sing").
   */
  function splitEmbeddedDefinitions(defList, surfaceWord = '') {
    if (!Array.isArray(defList) || defList.length === 0) return [];

    const senses = [];
    defList.forEach((item) => {
      if (!item || typeof item !== 'string') return;
      const cleanItem = item
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");

      const hasNumberedParts = /(?<=\D|^)(?=\b\d{1,2}[\.\)]\s+)/.test(cleanItem);
      if (hasNumberedParts) {
        const subParts = cleanItem.split(/(?<=\D|^)(?=\b\d{1,2}[\.\)]\s+)/g);
        subParts.forEach((part) => {
          const cleaned = part.replace(/^\d{1,2}[\.\)]\s*/, '').trim();
          if (cleaned && !isGrammarUsageNote(cleaned)) {
            senses.push(cleaned);
          }
        });
      } else {
        const trimmed = cleanItem.trim();
        if (trimmed && !isGrammarUsageNote(trimmed)) {
          senses.push(trimmed);
        }
      }
    });

    if (senses.length === 0) return defList.map((d) => cleanDefinitionForPrompt(d));
    return senses.map((s) => cleanDefinitionForPrompt(s));
  }

  /**
   * Groups dictionary entries by their dictionary title (e.g. "KRDICT EN", "KRDICT JA").
   * Preserves user-configured dictionary priority order.
   */
  function groupEntriesByDict(entries) {
    const map = new Map();
    if (!Array.isArray(entries)) return map;
    entries.forEach((e, idx) => {
      const title = e.dictTitle || 'Default';
      if (!map.has(title)) map.set(title, []);
      map.get(title).push({ entry: e, originalIndex: idx });
    });
    return map;
  }

  function formatPosLabel(posStr) {
    if (!posStr) return '';
    const s = String(posStr).toLowerCase();
    if (s.includes('동사') || s.includes('verb')) return '[Verb / 동사] ';
    if (s.includes('형용사') || s.includes('adj')) return '[Adjective / 형용사] ';
    if (s.includes('명사') || s.includes('noun')) return '[Noun / 명사] ';
    return `[${String(posStr).replace(/[\(\)]/g, '').trim()}] `;
  }

  /**
   * Builds an array of discrete candidate senses for a single dictionary group.
   * Assigns both letter labels (A, B, C...) and 1-based numeric indices.
   */
  function buildSenseCandidates(entries, targetWord = '', maxCandidates = MAX_CANDIDATE_SENSES) {
    if (!Array.isArray(entries) || entries.length === 0) return [];

    const perEntrySenses = entries.map((entry, entryIndex) => {
      const surface = entry.surface || entry.word || targetWord;
      const pos = entry.pos ? ` (${entry.pos})` : '';
      const rawDefs = Array.isArray(entry.definitions) ? entry.definitions : [];
      const senses = splitEmbeddedDefinitions(rawDefs, surface);
      return { entry, entryIndex, surface, pos, senses };
    });

    const selected = [];
    let senseDepth = 0;
    let hasRemaining = true;

    while (selected.length < maxCandidates && hasRemaining) {
      hasRemaining = false;
      for (const item of perEntrySenses) {
        if (senseDepth < item.senses.length) {
          const senseText = item.senses[senseDepth];
          const cleaned = cleanDefinitionForPrompt(senseText);
          if (cleaned) {
            selected.push({
              entryIndex: item.entryIndex,
              defIndex: senseDepth,
              surface: item.surface,
              pos: item.pos,
              cleanText: cleaned
            });
            if (selected.length >= maxCandidates) break;
          }
          if (senseDepth + 1 < item.senses.length) {
            hasRemaining = true;
          }
        }
      }
      senseDepth++;
    }

    selected.sort((a, b) => {
      if (a.entryIndex !== b.entryIndex) return a.entryIndex - b.entryIndex;
      return a.defIndex - b.defIndex;
    });

    return selected.map((item, idx) => {
      const candidateIndex = idx + 1;
      const letter = LETTERS[idx] || `${candidateIndex}`;
      const posTag = formatPosLabel(item.pos);
      return {
        ...item,
        candidateIndex,
        letter,
        key: `def_${candidateIndex}`,
        displayText: `${posTag}${item.surface}${item.pos}: ${item.cleanText}`
      };
    });
  }

  /**
   * Applies rerank scoring and calibration onto entries within a dictionary group.
   * Guarantees every sub-definition tab has a valid confidence percentage score.
   */
  function applyCandidateScoresToEntries(entries, candidates, candidateProbMap, winningCandidateIndex, useDirectProbabilities = false) {
    if (!Array.isArray(entries) || entries.length === 0) return entries;
    const clonedEntries = entries.map((e) => ({ ...e }));

    // Find winning candidate
    const winningCand =
      candidates.find((c) => c.candidateIndex === winningCandidateIndex) ||
      candidates[0] ||
      null;
    const winningEntryIndex = winningCand ? winningCand.entryIndex : 0;

    // Initialize all definition confidence scores for all entries
    clonedEntries.forEach((entry, eIdx) => {
      const rawDefs = Array.isArray(entry.definitions) ? entry.definitions : [];
      const senses = splitEmbeddedDefinitions(rawDefs, entry.surface || entry.word || '');
      const defCount = Math.max(1, senses.length || rawDefs.length);

      entry._bestDefIndex = 0;
      entry._koelectraMatched = false;

      // Fill baseline scores (direct mode uses low background baseline; legacy mode uses 60/52)
      const baseScore = useDirectProbabilities
        ? (eIdx === winningEntryIndex ? Math.max(1, Math.round(15 / defCount)) : Math.max(1, Math.round(5 / defCount)))
        : (eIdx === winningEntryIndex ? 60 : 52);
      entry._defConfidenceScores = new Array(defCount).fill(`${baseScore}%`);
      entry._confidenceScore = `${baseScore}%`;
    });

    // Populate calculated probabilities for all evaluated senses
    candidates.forEach((cand) => {
      const entry = clonedEntries[cand.entryIndex];
      if (!entry) return;
      const prob = candidateProbMap[cand.candidateIndex] || 0;

      let confPct;
      if (useDirectProbabilities) {
        confPct = Math.min(99, Math.max(1, Math.round(prob * 100)));
      } else {
        if (cand.candidateIndex === winningCandidateIndex) {
          confPct = Math.min(92, Math.max(82, Math.round(78 + 14 * Math.min(1.0, prob))));
        } else {
          confPct = Math.min(78, Math.max(52, Math.round(52 + 25 * prob)));
        }
      }
      const confStr = `${confPct}%`;

      if (Array.isArray(entry._defConfidenceScores) && cand.defIndex < entry._defConfidenceScores.length) {
        entry._defConfidenceScores[cand.defIndex] = confStr;
      }
    });

    // For EVERY entry, assign its best definition index and entry-level confidence score
    // to the candidate with the highest probability belonging to that entry.
    clonedEntries.forEach((entry, eIdx) => {
      const entryCands = candidates.filter((c) => c.entryIndex === eIdx);
      if (entryCands.length > 0) {
        let maxP = -1;
        let bestCand = entryCands[0];
        for (const cand of entryCands) {
          const p = candidateProbMap[cand.candidateIndex] || 0;
          if (p > maxP) {
            maxP = p;
            bestCand = cand;
          }
        }
        entry._bestDefIndex = bestCand.defIndex;
        if (Array.isArray(entry._defConfidenceScores) && bestCand.defIndex < entry._defConfidenceScores.length) {
          entry._confidenceScore = entry._defConfidenceScores[bestCand.defIndex];
        }
      }
    });

    // Sort entries within this dictionary group so winner is index 0
    let sortedEntries = clonedEntries;
    if (winningEntryIndex > 0 && winningEntryIndex < clonedEntries.length) {
      const winner = clonedEntries[winningEntryIndex];
      const remainder = clonedEntries.filter((_, idx) => idx !== winningEntryIndex);
      sortedEntries = [winner, ...remainder];
    }

    if (sortedEntries[0]) {
      sortedEntries[0]._koelectraMatched = true;
      if (winningCand) {
        sortedEntries[0]._bestDefIndex = winningCand.defIndex;
        if (Array.isArray(sortedEntries[0]._defConfidenceScores) && winningCand.defIndex < sortedEntries[0]._defConfidenceScores.length) {
          sortedEntries[0]._confidenceScore = sortedEntries[0]._defConfidenceScores[winningCand.defIndex];
        }
      }
    }

    // Ensure secondary entries do not carry _koelectraMatched flag
    for (let i = 1; i < sortedEntries.length; i++) {
      sortedEntries[i]._koelectraMatched = false;
    }

    return sortedEntries;
  }

  /**
   * Helper to parse model choice content into a candidate index.
   * Prioritizes numeric options and explicit labels over raw single letters.
   */
  function parseChoiceIndex(content, candidates) {
    if (!content || typeof content !== 'string') return 1;
    const clean = content.trim();

    // 1. Explicit option patterns with number (e.g. "Option 2", "Def 1", "#1", "[1]", "1.", "1")
    const explicitDigitMatch = clean.match(/(?:option|choice|def|sense|#|\b)\s*\[?([1-9]\d*)\]?(?:[\.\)\:\s]|$)/i);
    if (explicitDigitMatch && explicitDigitMatch[1]) {
      const num = parseInt(explicitDigitMatch[1], 10);
      if (num >= 1 && num <= candidates.length) return num;
    }

    // 2. Exact single number
    const exactNum = clean.match(/^([1-9]\d*)$/);
    if (exactNum && exactNum[1]) {
      const num = parseInt(exactNum[1], 10);
      if (num >= 1 && num <= candidates.length) return num;
    }

    // 3. Standalone number anywhere in text
    const anyDigit = clean.match(/\b([1-9]\d*)\b/);
    if (anyDigit && anyDigit[1]) {
      const num = parseInt(anyDigit[1], 10);
      if (num >= 1 && num <= candidates.length) return num;
    }

    // 4. Explicit option letter (e.g. "Option A", "Choice B")
    const explicitLetterMatch = clean.match(/(?:option|choice|def|sense)\s*[:=]?\s*([A-Z])\b/i);
    if (explicitLetterMatch && explicitLetterMatch[1]) {
      const char = explicitLetterMatch[1].toUpperCase();
      const matchedCand = candidates.find((c) => c.letter === char);
      if (matchedCand) return matchedCand.candidateIndex;
    }

    // 5. Isolated single letter, strictly avoiding English pronouns/articles 'I' and 'A'
    const isolatedLetterMatch = clean.match(/^\(?([B-HJ-Z])\)?[\.\:\s]?$/i);
    if (isolatedLetterMatch && isolatedLetterMatch[1]) {
      const char = isolatedLetterMatch[1].toUpperCase();
      const matchedCand = candidates.find((c) => c.letter === char);
      if (matchedCand) return matchedCand.candidateIndex;
    }

    return 1;
  }

  /**
   * Option C: Direct LLM Chat / Logprob Sense Disambiguation
   * Disambiguates within each dictionary group independently to preserve dictionary priority order.
   */
  async function rerankWithLocalLlmChat(entries, sentenceContext, targetWord, config = {}, fetchImpl = null) {
    if (!Array.isArray(entries) || entries.length === 0) return entries || [];
    const sentence = (sentenceContext || '').trim();
    if (!sentence) return entries;

    const fetchFn = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (typeof fetchFn !== 'function') {
      throw new Error('SenseReranker: No fetch implementation available.');
    }

    let endpointUrl = (config.customEndpointUrl || config.endpointUrl || 'http://localhost:1234/v1').trim();
    if (!/^https?:\/\//i.test(endpointUrl)) {
      endpointUrl = 'http://' + endpointUrl;
    }
    endpointUrl = endpointUrl.replace(/\/+$/, '');
    if (!endpointUrl.endsWith('/chat/completions')) {
      if (endpointUrl.endsWith('/v1')) {
        endpointUrl += '/chat/completions';
      } else {
        endpointUrl += '/v1/chat/completions';
      }
    }

    const modelId = (config.customModelId || config.modelId || 'local-model').trim();
    const headers = { 'Content-Type': 'application/json' };
    const apiKey = (config.customApiKey || config.apiKey || '').trim();
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    // Group entries by dictionary to preserve user dictionary order
    const groupedMap = groupEntriesByDict(entries);
    const rerankedAll = [];
    let isFirstGroup = true;

    for (const [dictTitle, groupItems] of groupedMap.entries()) {
      const groupEntries = groupItems.map((item) => item.entry);
      const candidates = buildSenseCandidates(groupEntries, targetWord);

      if (candidates.length <= 1) {
        const scored = applyCandidateScoresToEntries(groupEntries, candidates, { 1: 0.90 }, 1, true);
        if (!isFirstGroup && scored[0]) scored[0]._koelectraMatched = false;
        rerankedAll.push(...scored);
        isFirstGroup = false;
        continue;
      }

      const baseWord = targetWord || (groupEntries[0] && (groupEntries[0].surface || groupEntries[0].word)) || '';
      const surface = (config.surfaceWord || baseWord).trim();
      const targetLabel = (surface && surface !== baseWord)
        ? `"${baseWord}" (inflected as "${surface}" in context)`
        : `"${baseWord}"`;

      // Format options prompt with numbered indices and part-of-speech tags
      const optionsPrompt = candidates
        .map((c) => `${c.candidateIndex}. ${c.displayText}`)
        .join('\n');

      const systemPrompt =
        'You are an expert Korean dictionary sense disambiguator. Given a Korean sentence context, target word (and its inflected form), and numbered candidate definitions, select the number of the single definition that best matches how the word is used in the context.\n\n' +
        'Syntactic rules:\n' +
        '- Pay strict attention to attached particles (e.g. quotative -(이)라고, accusative -을/를, dative -에/-에게), syntactic role, and part of speech: [Verb / 동사] vs [Adjective / 형용사] vs [Noun / 명사].\n' +
        '- In Korean, quotative -(이)라고 attaches to speech, naming, and thinking verbs. Adjectives (fullness, pregnancy) CANNOT take quotative -(이)라고.\n' +
        '- Reply with ONLY the single number of the winning definition (e.g. 1). Do not output any words or explanation.';

      const userPrompt = `Context Sentence: "${sentence}"
Target Word: ${targetLabel}

Candidate Senses:
${optionsPrompt}

Which definition matches the context best? Reply with ONLY the winning number (1-${candidates.length}):`;

      const payload = {
        model: modelId,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.0,
        max_tokens: 5,
        logprobs: true,
        top_logprobs: 10
      };

      let response;
      try {
        response = await fetchFn(endpointUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
      } catch (fetchErr) {
        throw new Error(`SenseReranker: Failed to connect to local LLM at ${endpointUrl}: ${fetchErr.message}`);
      }

      if (!response.ok && response.status === 400) {
        const retryPayload = { ...payload };
        delete retryPayload.logprobs;
        delete retryPayload.top_logprobs;
        try {
          response = await fetchFn(endpointUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(retryPayload)
          });
        } catch (retryErr) {}
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`SenseReranker: LLM endpoint returned HTTP ${response.status}: ${errText}`);
      }

      const resJson = await response.json();
      const choice = resJson.choices?.[0];
      const content = (choice?.message?.content || choice?.text || '').trim();

      const winnerIndex = parseChoiceIndex(content, candidates);

      // Parse logprobs strictly anchored to the decision token
      const candidateProbMap = {};
      let logprobsFound = false;

      const logprobItems = choice?.logprobs?.content || choice?.logprobs?.top_logprobs || [];
      if (Array.isArray(logprobItems) && logprobItems.length > 0) {
        let decisionItem = null;
        // Find exact match for winnerIndex token (e.g. '1', ' 1', '1.', '[1]')
        for (const item of logprobItems) {
          const tok = (item.token || '').trim();
          const m = tok.match(/^(?:#|\[|\()?([1-9]\d*)(?:[\.\)\]])?$/);
          if (m && parseInt(m[1], 10) === winnerIndex) {
            decisionItem = item;
            break;
          }
        }

        // Extract probabilities at the verified decision token
        if (decisionItem) {
          const topLogprobs = decisionItem.top_logprobs || [decisionItem];

          // Seed the winning token's own logprob
          if (typeof decisionItem.logprob === 'number') {
            candidateProbMap[winnerIndex] = Math.exp(decisionItem.logprob);
          }

          topLogprobs.forEach((lp) => {
            const tokenStr = (lp.token || '').trim();
            const m = tokenStr.match(/^(?:#|\[|\()?([1-9]\d*)(?:[\.\)\]])?$/);
            if (m) {
              const num = parseInt(m[1], 10);
              const cand = candidates.find((c) => c.candidateIndex === num);
              if (cand) {
                const logp = typeof lp.logprob === 'number' ? lp.logprob : -20;
                candidateProbMap[cand.candidateIndex] = Math.exp(logp);
              }
            }
          });

          if (Object.keys(candidateProbMap).length > 0) {
            logprobsFound = true;
          }
        }
      }

      let winningCandidateIndex = winnerIndex;
      if (logprobsFound) {
        // Ensure winner has a probability entry
        if (!candidateProbMap[winnerIndex]) {
          candidateProbMap[winnerIndex] = 0.90;
        }

        const sumProb = Object.values(candidateProbMap).reduce((a, b) => a + b, 0);
        if (sumProb > 0) {
          candidates.forEach((c) => {
            candidateProbMap[c.candidateIndex] = (candidateProbMap[c.candidateIndex] || 0) / sumProb;
          });

          // Only allow logprobs to pick an alternate winner if another candidate had higher probability at the decision point
          let maxProb = -1;
          for (const c of candidates) {
            const prob = candidateProbMap[c.candidateIndex] || 0;
            if (prob > maxProb) {
              maxProb = prob;
              winningCandidateIndex = c.candidateIndex;
            }
          }
        }
      } else {
        candidates.forEach((c) => {
          candidateProbMap[c.candidateIndex] =
            c.candidateIndex === winnerIndex ? 0.90 : 0.10 / Math.max(1, candidates.length - 1);
        });
      }

      console.log(`[Munmek Stage 2 Option C] Word: '${baseWord}' (inflected: '${surface}') | Model choice: '${content}' -> Candidate ${winningCandidateIndex} (Conf: ${Math.round((candidateProbMap[winningCandidateIndex] || 0.9) * 100)}%)`);

      const scored = applyCandidateScoresToEntries(groupEntries, candidates, candidateProbMap, winningCandidateIndex, true);
      if (!isFirstGroup && scored[0]) scored[0]._koelectraMatched = false;
      rerankedAll.push(...scored);
      isFirstGroup = false;
    }

    return rerankedAll;
  }

  /**
   * Option A & B: System One Protocol Disambiguation
   * Also operates per dictionary group to preserve dictionary priority.
   */
  async function rerankWithSystemOne(entries, sentenceContext, targetWord, config = {}, fetchImpl = null) {
    if (!Array.isArray(entries) || entries.length === 0) return entries || [];
    const sentence = (sentenceContext || '').trim();
    if (!sentence) return entries;

    const fetchFn = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (typeof fetchFn !== 'function') {
      throw new Error('SenseReranker: No fetch implementation available.');
    }

    let endpointUrl = (config.systemOneEndpointUrl || config.endpointUrl || 'http://localhost:8090/v1/systemone').trim();
    if (!/^https?:\/\//i.test(endpointUrl)) {
      endpointUrl = 'http://' + endpointUrl;
    }

    const headers = { 'Content-Type': 'application/json' };
    const apiKey = (config.systemOneApiKey || config.apiKey || '').trim();
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const groupedMap = groupEntriesByDict(entries);
    const rerankedAll = [];
    let isFirstGroup = true;

    for (const [dictTitle, groupItems] of groupedMap.entries()) {
      const groupEntries = groupItems.map((item) => item.entry);
      const candidates = buildSenseCandidates(groupEntries, targetWord);

      if (candidates.length <= 1) {
        const scored = applyCandidateScoresToEntries(groupEntries, candidates, { 1: 0.9 }, 1);
        if (!isFirstGroup && scored[0]) scored[0]._koelectraMatched = false;
        rerankedAll.push(...scored);
        isFirstGroup = false;
        continue;
      }

      const optionsMap = {};
      candidates.forEach((c) => {
        optionsMap[c.key] = c.displayText;
      });

      const payload = {
        state: `Context: "${sentence}"\nTarget Word: "${targetWord || (groupEntries[0] && (groupEntries[0].surface || groupEntries[0].word)) || ''}"`,
        questions: {
          best_definition: {
            type: 'choice',
            prompt: 'Which definition sense fits how the target word is used in this context?',
            options: optionsMap
          }
        }
      };

      let response;
      try {
        response = await fetchFn(endpointUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
      } catch (fetchErr) {
        throw new Error(`SenseReranker: Failed to connect to System One endpoint at ${endpointUrl}: ${fetchErr.message}`);
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`SenseReranker: System One endpoint returned HTTP ${response.status}: ${errText}`);
      }

      const resJson = await response.json();
      const answer = resJson?.answers?.best_definition || resJson?.best_definition || {};
      const chosenKey = answer.choice || Object.keys(optionsMap)[0];
      const distribution = answer.distribution || {};

      let winnerIndex = 1;
      const matchedCandidate = candidates.find((c) => c.key === chosenKey);
      if (matchedCandidate) {
        winnerIndex = matchedCandidate.candidateIndex;
      }

      const candidateProbMap = {};
      candidates.forEach((c) => {
        const prob =
          typeof distribution[c.key] === 'number'
            ? distribution[c.key]
            : c.candidateIndex === winnerIndex
            ? answer.confidence || 0.85
            : 0.05;
        candidateProbMap[c.candidateIndex] = prob;
      });

      let winningCandidateIndex = winnerIndex;
      if (distribution && Object.keys(distribution).length > 0) {
        let maxProb = -1;
        for (const c of candidates) {
          const prob = candidateProbMap[c.candidateIndex] || 0;
          if (prob > maxProb) {
            maxProb = prob;
            winningCandidateIndex = c.candidateIndex;
          }
        }
      }

      const scored = applyCandidateScoresToEntries(groupEntries, candidates, candidateProbMap, winningCandidateIndex, true);
      if (!isFirstGroup && scored[0]) scored[0]._koelectraMatched = false;
      rerankedAll.push(...scored);
      isFirstGroup = false;
    }

    return rerankedAll;
  }

  const SenseRerankerAdapters = {
    cleanDefinitionForPrompt,
    splitEmbeddedDefinitions,
    buildSenseCandidates,
    applyCandidateScoresToEntries,
    parseChoiceIndex,
    rerankWithLocalLlmChat,
    rerankWithSystemOne
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SenseRerankerAdapters;
  } else {
    global.SenseRerankerAdapters = SenseRerankerAdapters;
  }
})(typeof self !== 'undefined' ? self : (typeof globalThis !== 'undefined' ? globalThis : this));
