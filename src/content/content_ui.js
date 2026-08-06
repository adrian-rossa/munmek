/**
 * Munmek Tooltip UI Renderer & Interaction Engine
 * Manages hover popup DOM creation, template rendering, and interactive click handling.
 */
(function (global) {
  'use strict';

  const TOOLTIP_ID = 'munmek-tooltip';
  let tooltip = null;
  let isMouseOverTooltip = false;

  function ensureTooltip(onMouseEnter, onMouseLeave, onClick) {
    if (tooltip) return tooltip;

    tooltip = document.createElement('div');
    tooltip.id = TOOLTIP_ID;
    tooltip.className = 'munmek-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.setAttribute('aria-label', 'Munmek Korean Context Lookup Tooltip');

    if (typeof onMouseEnter === 'function') tooltip.addEventListener('mouseenter', onMouseEnter);
    if (typeof onMouseLeave === 'function') tooltip.addEventListener('mouseleave', onMouseLeave);
    if (typeof onClick === 'function') tooltip.addEventListener('click', onClick);

    document.body.appendChild(tooltip);
    return tooltip;
  }

  function renderTooltip(state, sentenceAnalysisCache, onMouseEnter, onMouseLeave, onClick) {
    ensureTooltip(onMouseEnter, onMouseLeave, onClick);

    const analysis = sentenceAnalysisCache.get(state.sentenceKey) || null;
    if (analysis || state.quickFallback) {
      autoSelectBestDefinitionFromGemini(state, analysis || state.quickFallback);
    }
    let dictHtml = '';

    if (Array.isArray(state.dictionaryEntries) && state.dictionaryEntries.length > 0) {
      dictHtml = renderDictionaryEntriesGrouped(state.dictionaryEntries, state.dictionaryMatch || state.lookupReason, state);
    } else if (state.quickFallback) {
      dictHtml = renderGeminiFallbackEntry(state.quickFallback, state.word || state.dictionaryMatch);
    } else if (analysis) {
      const norm = normalizeGeminiAnalysis(analysis);
      if (norm && (norm.translation || norm.hanja)) {
        dictHtml = renderGeminiFallbackEntry(norm, state.word || state.dictionaryMatch);
      } else {
        dictHtml = renderDictionaryCandidates(state.candidateList, state.lookupReason);
      }
    } else {
      dictHtml = renderDictionaryCandidates(state.candidateList, state.lookupReason);
    }

    const candidateChipsHtml = Array.isArray(state.candidateList) && state.candidateList.length > 0
      ? `<div class="chips" style="margin-bottom: 10px;">
          ${state.candidateList.slice(0, 4).map((c) => {
            const isActive = state.dictionaryMatch === c.text;
            return `<button type="button" class="chip" data-candidate="${escapeHtml(c.text)}" style="cursor: pointer; border: 1px solid ${isActive ? '#2f5d62' : 'transparent'}; background: ${isActive ? '#2f5d62' : '#e4f0ee'}; color: ${isActive ? '#fff' : '#17383b'}; padding: 4px 10px;">${escapeHtml(c.text)}</button>`;
          }).join('')}
         </div>`
      : '';

    const html = [
      `<div class="title">${escapeHtml(state.word || '...')}</div>`,
      dictHtml,
      candidateChipsHtml,
      state.sentence ? `<div class="subtitle">${escapeHtml(truncateText(state.sentence, 180))}</div>` : '',
      renderActions(state, Boolean(analysis)),
      renderAnalysisSection(analysis, state),
      state.feedback ? `<div class="feedback ${state.feedbackType === 'error' ? 'error' : ''}" role="status" aria-live="polite">${escapeHtml(state.feedback)}</div>` : ''
    ].filter(Boolean).join('');

    tooltip.innerHTML = html;
    tooltip.style.display = 'block';
    positionTooltip(state.x, state.y, state.tooltipFontSize || 15);
  }

  function groupEntriesByDictTitle(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return [];
    const groups = [];
    const map = new Map();

    entries.forEach((entry) => {
      const title = entry.dictTitle || 'Imported Dictionary';
      if (!map.has(title)) {
        const g = { title, items: [] };
        map.set(title, g);
        groups.push(g);
      }
      map.get(title).items.push(entry);
    });

    return groups;
  }

  function renderDictionaryEntriesGrouped(entries, matchLabel, state) {
    const dictGroups = groupEntriesByDictTitle(entries);
    if (dictGroups.length === 0) return '<div class="section empty">No definitions available.</div>';

    const selectedGroupIdx = (state && typeof state.selectedGroupIndex === 'number') ? state.selectedGroupIndex : 0;
    const validGroupIdx = (selectedGroupIdx >= 0 && selectedGroupIdx < dictGroups.length) ? selectedGroupIdx : 0;
    const activeGroup = dictGroups[validGroupIdx];

    let topTabsHtml = '';
    if (dictGroups.length > 1) {
      topTabsHtml = `<div class="dict-group-tabs" style="display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap;">
        ${dictGroups.map((g, idx) => {
          const isActive = idx === validGroupIdx;
          return `<button type="button" class="dict-group-tab" data-action="select-dict-group-tab" data-group-index="${idx}" style="cursor: pointer; font-size: 0.78em; font-weight: 700; padding: 4px 12px; border-radius: 8px; border: 1px solid ${isActive ? '#2f5d62' : '#ddd3c4'}; background: ${isActive ? '#2f5d62' : '#fff'}; color: ${isActive ? '#fff' : '#4f463a'};">Dict: ${escapeHtml(g.title)}</button>`;
        }).join('')}
      </div>`;
    }

    const itemsHtml = activeGroup.items.map((entry, itemIdx) => renderSingleEntryCard(entry, matchLabel, itemIdx, state)).join('');

    return `
      <div class="dictionary-container">
        ${topTabsHtml}
        ${itemsHtml}
      </div>
    `;
  }

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

  function stripHtml(value) {
    return String(value || '').replace(/<[^>]*>/g, '').trim();
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

      if (/^\([^)]+\)\s*→\s*.+/.test(cleaned)) {
        cleaned = `Conjugation variant: ${cleaned}`;
      } else if (/^\([^)]*(어|아|어서|아서|으니|으면|은)[^)]*\)/.test(cleaned)) {
        cleaned = `Conjugations: ${cleaned}`;
      }

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
        parts.push(`<strong>${escapeHtml(s.title)}</strong>`);
      }
      if (s.body) {
        parts.push(escapeHtml(s.body));
      }
      if (s.pattern) {
        parts.push(`<span class="muted" style="font-style: italic; font-size: 0.9em;">(Pattern: ${escapeHtml(s.pattern)})</span>`);
      }
      return parts.join('\n');
    });
  }

  function getConfidenceBadgeColors(confStr, isActiveTab) {
    const num = parseInt(confStr || '85', 10);
    if (num >= 85) {
      return isActiveTab
        ? { bg: '#2f5d62', color: '#ffffff', border: '#1e3e42' }
        : { bg: '#e4f0ee', color: '#17383b', border: '#2f5d62' };
    } else if (num >= 70) {
      return isActiveTab
        ? { bg: '#d97706', color: '#ffffff', border: '#b45309' }
        : { bg: '#fef3c7', color: '#92400e', border: '#d97706' };
    } else {
      return isActiveTab
        ? { bg: '#6b7280', color: '#ffffff', border: '#4b5563' }
        : { bg: '#f3f4f6', color: '#374151', border: '#9ca3af' };
    }
  }

  function renderSingleEntryCard(entry, matchLabel = '', itemIndex = 0, state = {}) {
    const rawDefinitions = Array.isArray(entry.definitions) ? entry.definitions : [];
    const definitions = splitEmbeddedDefinitions(rawDefinitions, entry.surface || entry.word || '');

    const isCardMatched = Boolean(state.geminiMatchedItemIndex === itemIndex);
    const matchedDefIdx = isCardMatched ? state.geminiMatchedDefIndex : null;
    const hasGeminiMatch = typeof matchedDefIdx === 'number';

    const isKoElectraMatched = Boolean(entry && entry._koelectraMatched);
    const hasKoElectraMatch = isKoElectraMatched || (entry && Array.isArray(entry._defConfidenceScores) && entry._defConfidenceScores.length > 0);
    const koelectraMatchedDefIdx = isKoElectraMatched ? (typeof entry._bestDefIndex === 'number' ? entry._bestDefIndex : 0) : 0;

    const defConfScores = Array.isArray(entry._defConfidenceScores) ? entry._defConfidenceScores : [];

    const selectedIndexKey = `selectedDefIndex_${itemIndex}`;
    let selectedIndex = 0;
    if (state && typeof state[selectedIndexKey] === 'number') {
      selectedIndex = state[selectedIndexKey];
    } else if (hasGeminiMatch) {
      selectedIndex = matchedDefIdx;
    } else if (isKoElectraMatched) {
      selectedIndex = koelectraMatchedDefIdx;
    }
    const validIndex = (selectedIndex >= 0 && selectedIndex < definitions.length) ? selectedIndex : 0;
    const selectedDef = definitions[validIndex] || '';

    const activeConfScore = defConfScores[validIndex] || entry._confidenceScore || '75%';
    const bestConfScore = defConfScores[koelectraMatchedDefIdx] || entry._confidenceScore || '75%';

    const chips = [entry.pos, entry.type, matchLabel].filter(Boolean).map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join('');

    let geminiBadgeHtml = '';
    if (hasGeminiMatch) {
      if (validIndex === matchedDefIdx) {
        geminiBadgeHtml = `<span style="background: #2f5d62; color: #fff; padding: 2px 8px; border-radius: 999px; font-size: 0.72em; font-weight: 700; margin-left: 6px; display: inline-block;">✨ Gemini Matched</span>`;
      } else {
        geminiBadgeHtml = `<span style="background: #e4f0ee; color: #17383b; border: 1px solid #2f5d62; padding: 2px 8px; border-radius: 999px; font-size: 0.72em; font-weight: 700; margin-left: 6px; display: inline-block;">✨ Gemini Matched (Def ${matchedDefIdx + 1})</span>`;
      }
    } else if (hasKoElectraMatch) {
      const isTopMatchedTab = validIndex === koelectraMatchedDefIdx;
      const themeColors = getConfidenceBadgeColors(activeConfScore, isKoElectraMatched && isTopMatchedTab);
      const prefix = isKoElectraMatched ? '✨ Context Matched' : '✨ Score';
      if (isTopMatchedTab) {
        geminiBadgeHtml = `<span style="background: ${themeColors.bg}; color: ${themeColors.color}; border: 1px solid ${themeColors.border}; padding: 2px 8px; border-radius: 999px; font-size: 0.72em; font-weight: 700; margin-left: 6px; display: inline-block;">${prefix} · ${activeConfScore}</span>`;
      } else {
        geminiBadgeHtml = `<span style="background: ${themeColors.bg}; color: ${themeColors.color}; border: 1px solid ${themeColors.border}; padding: 2px 8px; border-radius: 999px; font-size: 0.72em; font-weight: 700; margin-left: 6px; display: inline-block;">${prefix} (Def ${koelectraMatchedDefIdx + 1} · ${bestConfScore})</span>`;
      }
    }

    const tabsHtml = definitions.length > 1
      ? `<div class="def-tabs" style="display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; padding-bottom: 4px;">
          ${definitions.map((def, idx) => {
            const isActive = idx === validIndex;
            const isMatchedTab = (isCardMatched && state.geminiMatchedDefIndex === idx) || (isKoElectraMatched && koelectraMatchedDefIdx === idx);
            const shortText = truncateText(stripHtml(def), 18);
            const tabScoreStr = defConfScores[idx] ? ` (${defConfScores[idx]})` : '';
            return `<button type="button" class="def-tab" data-action="select-def-tab" data-item-index="${itemIndex}" data-def-index="${idx}" style="cursor: pointer; font-size: 0.76em; font-weight: 700; padding: 4px 8px; border-radius: 6px; border: 1px solid ${isActive ? '#2f5d62' : (isMatchedTab ? '#2f5d62' : '#ddd3c4')}; background: ${isActive ? '#2f5d62' : (isMatchedTab ? '#e4f0ee' : '#fff')}; color: ${isActive ? '#fff' : '#4f463a'};">Def ${idx + 1}: ${escapeHtml(shortText)}${tabScoreStr}${isMatchedTab ? ' ✨' : ''}</button>`;
          }).join('')}
         </div>`
      : '';

    const borderStyle = (isCardMatched || isKoElectraMatched)
      ? 'border-left: 6px solid #2f5d62; background: #f2faf8; border-color: #2f5d62;'
      : 'border-left: 4px solid #2f5d62; background: #faf7f2;';

    const definitionBoxHtml = definitions.length > 0
      ? `<div class="section">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <div class="label" style="margin: 0;">Definition ${definitions.length > 1 ? `(${validIndex + 1} of ${definitions.length})` : ''}${geminiBadgeHtml}</div>
            <button type="button" class="chip" data-action="anki-def" data-item-index="${itemIndex}" data-def-index="${validIndex}" title="Add or update this specific definition in Anki" style="cursor: pointer; font-size: 0.76em; padding: 2px 8px; border: none; background: #2f5d62; color: #fff; border-radius: 6px;">+ Anki</button>
          </div>
          ${tabsHtml}
          <div style="font-size: 0.94em; font-weight: 500; color: #1e1b16; background: #faf7f2; border: 1px solid #eadfce; border-left: 4px solid #2f5d62; border-radius: 8px; padding: 10px 12px; line-height: 1.5; white-space: pre-line;">
            ${selectedDef}
          </div>
         </div>`
      : '<div class="section empty">No definition text available.</div>';

    const showEntryWordHeader = Boolean(
      (entry.surface && entry.surface !== state.word) ||
      (entry.base && entry.base !== entry.surface)
    );

    return `
      <div class="section entry-box" style="${borderStyle} padding-left: 12px; border-radius: 8px; border: 1px solid #eadfce; margin-bottom: 8px;">
        ${showEntryWordHeader ? `<div class="entry-head"><div class="entry-word" style="font-weight: 700;">${escapeHtml(entry.surface || '')}${entry.base && entry.base !== entry.surface ? ` <span class="muted">(${escapeHtml(entry.base)})</span>` : ''}</div></div>` : ''}
        ${chips ? `<div class="chips" style="margin-top: 4px; margin-bottom: 6px;">${chips}</div>` : ''}
        ${definitionBoxHtml}
        ${entry.hanja ? `<div class="section"><div class="label">Hanja</div><div>${escapeHtml(entry.hanja)}</div></div>` : ''}
        ${entry.grammar_notes ? `<div class="section"><div class="label">Notes</div><div>${escapeHtml(entry.grammar_notes)}</div></div>` : ''}
      </div>
    `;
  }

  function renderGeminiFallbackEntry(norm, word) {
    return `
      <div class="section entry-box" style="border-left: 4px solid #d97706; padding-left: 12px; background: #fffbeb; border-radius: 8px; border: 1px solid #fef3c7; margin-bottom: 8px;">
        <div class="entry-head">
          <div class="entry-word">${escapeHtml(word || '')}</div>
        </div>
        <div class="chips"><span class="chip" style="background:#d97706; color:#fff; font-weight:700;">Quick LLM Lookup</span></div>
        <div class="section">
          <div class="label">Definition / Translation</div>
          <div style="font-size: 0.94em; font-weight: 500; color: #1e1b16; background: #fff; border: 1px solid #fcd34d; border-radius: 8px; padding: 10px 12px; line-height: 1.5; white-space: pre-line;">
            ${escapeHtml(formatDefinitionText(norm.translation || 'No definition available.'))}
          </div>
        </div>
        ${norm.hanja ? `<div class="section"><div class="label">Hanja</div><div>${escapeHtml(norm.hanja)}</div></div>` : ''}
        ${norm.grammar ? `<div class="section"><div class="label">Grammar Notes</div><div>${escapeHtml(norm.grammar)}</div></div>` : ''}
      </div>
    `;
  }

  function renderDictionaryCandidates(candidates, reason) {
    const limited = (candidates || []).slice(0, 4);
    return `
      <div class="section entry-box">
        <div class="label">Termbank Search</div>
        <div class="empty">${escapeHtml(reason || 'No exact dictionary match found.')}</div>
        <div class="chips" style="margin-top: 6px;">
          ${limited.map((candidate) => `<span class="chip">${escapeHtml(candidate.text)}</span>`).join('')}
        </div>
      </div>
    `;
  }

  function renderActions(state, hasCachedAnalysis) {
    const aiLabel = hasCachedAnalysis ? '✨ Refresh Gemini' : '✨ Ask Gemini';
    return `
      <div class="section">
        <div class="actions" style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="primary-button" data-action="analyze">${escapeHtml(aiLabel)}</button>
          <button class="secondary-button" data-action="anki-llm" style="background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; font-weight: 700;" title="Send Ask Gemini / Quick LLM definition to Anki">Send to Anki (LLM)</button>
        </div>
      </div>
    `;
  }

  function normalizeGeminiAnalysis(rawAnalysis) {
    if (!rawAnalysis || typeof rawAnalysis !== 'object') return null;

    let target = rawAnalysis;
    if (Array.isArray(target.words_analysis) && target.words_analysis.length > 0) {
      target = target.words_analysis[0];
    } else if (Array.isArray(target.analysis) && target.analysis.length > 0) {
      target = target.analysis[0];
    } else if (target.analysis && typeof target.analysis === 'object') {
      target = target.analysis;
    } else if (target.data && typeof target.data === 'object') {
      target = target.data;
    } else if (target.results && typeof target.results === 'object') {
      target = Array.isArray(target.results) ? target.results[0] : target.results;
    }

    if (!target || typeof target !== 'object') return null;

    let translationStr = typeof target.translation === 'string' ? target.translation : (typeof target.definition === 'string' ? target.definition : (Array.isArray(target.definitions) ? target.definitions.join('; ') : ''));
    let grammarStr = typeof target.grammar === 'string' ? target.grammar : (typeof target.grammar_notes === 'string' ? target.grammar_notes : (target.conjugation && typeof target.conjugation === 'object' ? `${target.conjugation.ending ? 'Ending ' + target.conjugation.ending + ': ' : ''}${target.conjugation.explanation || ''}`.trim() : ''));
    let notesStr = typeof target.notes === 'string' ? target.notes : '';
    let hanjaStr = typeof target.hanja === 'string' ? target.hanja : '';

    return {
      translation: translationStr,
      grammar: grammarStr,
      notes: notesStr,
      hanja: hanjaStr
    };
  }

  function renderAnalysisSection(rawAnalysis, currentHoverState) {
    if (!rawAnalysis) {
      return '<div class="section empty">Ask Gemini for a richer, context-aware explanation.</div>';
    }

    if (rawAnalysis.error) {
      return `<div class="section feedback error">${escapeHtml(rawAnalysis.error)}</div>`;
    }

    const wordsAnalysis = Array.isArray(rawAnalysis.words_analysis)
      ? rawAnalysis.words_analysis
      : (Array.isArray(rawAnalysis.words) ? rawAnalysis.words : (Array.isArray(rawAnalysis.analysis) ? rawAnalysis.analysis : null));

    if (wordsAnalysis && wordsAnalysis.length > 0) {
      const currentWord = cleanKoreanWord(currentHoverState ? currentHoverState.word : '');
      let targetItem = wordsAnalysis.find((item) => {
        const s = cleanKoreanWord(item.surface || item.word || '');
        const b = cleanKoreanWord(item.base || '');
        if (!s && !b) return false;
        if (s === currentWord || b === currentWord) return true;
        if (currentWord.startsWith(s) || s.startsWith(currentWord)) return true;
        return currentWord.includes(s) || s.includes(currentWord);
      });

      if (!targetItem) {
        return `<div class="section empty" style="font-size:0.86em;">Sentence breakdown cached (${wordsAnalysis.length} words), but no entry matching "${escapeHtml(currentWord)}" was returned.</div>`;
      }

      const surface = targetItem.surface || targetItem.word || '';
      const base = targetItem.base || '';
      const pos = targetItem.pos || '';
      const defs = Array.isArray(targetItem.definitions) ? targetItem.definitions : (targetItem.definition ? [targetItem.definition] : []);
      const conj = targetItem.conjugation;
      const notes = targetItem.grammar_notes || targetItem.notes || '';

      return `
        <div class="section entry-box" style="border: 1px solid #2f5d62; background: #f4faf9; margin-top: 10px; border-radius: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 6px; margin-bottom: 6px;">
            <span style="font-weight: 700; color: #17383b; font-size: 0.96em;">
              Gemini: ${escapeHtml(surface)} ${base && base !== surface ? `<span class="muted" style="font-weight:400;">(${escapeHtml(base)})</span>` : ''}
            </span>
            ${pos ? `<span class="chip" style="font-size: 0.74em; background: #2f5d62; color: #fff;">${escapeHtml(pos)}</span>` : ''}
          </div>

          ${defs.length > 0
            ? `<ul style="margin: 4px 0 6px 18px; padding: 0; color: #1e1b16; font-size: 0.88em; line-height: 1.4;">
                ${defs.map((d) => `<li><strong>${escapeHtml(d)}</strong></li>`).join('')}
               </ul>`
            : ''}

          ${conj && typeof conj === 'object' && (conj.ending || conj.explanation)
            ? `<div style="font-size: 0.82em; color: #17383b; margin-top: 6px; background: #e4f0ee; padding: 6px 10px; border-radius: 8px;">
                <strong>Grammar:</strong> ${conj.ending ? `Ending <code>${escapeHtml(conj.ending)}</code> — ` : ''}${escapeHtml(conj.explanation || '')}
               </div>`
            : ''}

          ${notes
            ? `<div style="font-size: 0.82em; color: #4f463a; margin-top: 6px; font-style: italic; background: #fff; padding: 6px 10px; border-radius: 8px; border: 1px solid #eadfce;">
                <strong>Context Note:</strong> ${escapeHtml(notes)}
               </div>`
            : ''}

          ${(() => {
            const reservedKeys = new Set([
              'words_analysis', 'words', 'analysis', 'surface', 'word', 'base', 'pos',
              'definitions', 'definition', 'conjugation', 'notes', 'grammar_notes', 'id',
              'sentence', 'prevSentence', 'prevSentence2', 'candidate'
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
                  customCards.push(`
                    <div style="font-size: 0.84em; color: #17383b; margin-top: 6px; background: #e8f3f1; padding: 6px 10px; border-radius: 8px; border: 1px solid #bce0da;">
                      <strong>${escapeHtml(title)}:</strong> ${escapeHtml(valStr)}
                    </div>
                  `);
                }
              }
            };

            scanObj(rawAnalysis);
            scanObj(targetItem);
            return customCards.join('');
          })()}
        </div>
      `;
    }

    const normalized = normalizeGeminiAnalysis(rawAnalysis);
    if (!normalized) {
      return '<div class="section empty">No structural breakdown returned.</div>';
    }
  }

  function autoSelectBestDefinitionFromGemini(state, analysisData) {
    if (!state || !analysisData || !Array.isArray(state.dictionaryEntries) || state.dictionaryEntries.length === 0) return;

    const textFragments = [];
    let geminiPos = '';
    let geminiBase = '';

    if (typeof analysisData === 'object') {
      if (analysisData.translation) textFragments.push(String(analysisData.translation));
      if (analysisData.definition) textFragments.push(String(analysisData.definition));
      if (analysisData.notes) textFragments.push(String(analysisData.notes));
      if (analysisData.grammar) textFragments.push(String(analysisData.grammar));

      Object.keys(analysisData).forEach((k) => {
        const v = analysisData[k];
        if (v && typeof v === 'string') textFragments.push(v);
      });

      const wordsAnalysis = Array.isArray(analysisData.words_analysis)
        ? analysisData.words_analysis
        : (Array.isArray(analysisData.words) ? analysisData.words : (Array.isArray(analysisData.analysis) ? analysisData.analysis : null));

      if (Array.isArray(wordsAnalysis) && wordsAnalysis.length > 0) {
        const cleanW = cleanKoreanWord(state.word || '');
        const targetItem = wordsAnalysis.find((item) => {
          const s = cleanKoreanWord(item.surface || item.word || '');
          const b = cleanKoreanWord(item.base || '');
          return (s && (s === cleanW || cleanW.startsWith(s))) || (b && b === cleanW);
        }) || wordsAnalysis[0];

        if (targetItem) {
          if (targetItem.pos) geminiPos = String(targetItem.pos).toLowerCase();
          if (targetItem.base) geminiBase = cleanKoreanWord(targetItem.base);
          if (Array.isArray(targetItem.definitions)) textFragments.push(...targetItem.definitions.map(String));
          if (targetItem.definition) textFragments.push(String(targetItem.definition));
          if (targetItem.notes) textFragments.push(String(targetItem.notes));
          if (targetItem.grammar_notes) textFragments.push(String(targetItem.grammar_notes));
          Object.keys(targetItem).forEach((k) => {
            const v = targetItem[k];
            if (v && typeof v === 'string') textFragments.push(v);
          });
        }
      }
    }

    const geminiFullText = textFragments.join(' ').toLowerCase();
    if (!geminiFullText.trim()) return;

    const dictGroups = groupEntriesByDictTitle(state.dictionaryEntries);
    const selectedGroupIdx = typeof state.selectedGroupIndex === 'number' ? state.selectedGroupIndex : 0;
    const activeGroup = dictGroups[selectedGroupIdx] || dictGroups[0];
    if (!activeGroup || !Array.isArray(activeGroup.items) || activeGroup.items.length === 0) return;

    const extractTokens = (str) => {
      return (String(str || '').toLowerCase().match(/[a-zA-Z0-9\u00C0-\u024F\u3040-\u30ff\u4e00-\u9faf\uac00-\ud7a3]{2,}/g) || []);
    };

    const geminiTokens = new Set(extractTokens(geminiFullText));

    let bestScore = -1;
    let bestItemIndex = 0;
    let bestDefIndex = 0;

    activeGroup.items.forEach((item, itemIdx) => {
      const itemPos = String(item.pos || '').toLowerCase();
      const itemBase = cleanKoreanWord(item.base || item.surface || '');
      const rawDefs = Array.isArray(item.definitions) ? item.definitions : [];
      const splitDefs = splitEmbeddedDefinitions(rawDefs);

      let posBonus = 0;
      if (geminiPos && itemPos) {
        if (itemPos.includes(geminiPos) || geminiPos.includes(itemPos)) posBonus += 4;
      }

      let baseBonus = 0;
      if (geminiBase && itemBase) {
        if (geminiBase === itemBase) baseBonus += 5;
      }

      splitDefs.forEach((defText, defIdx) => {
        const tokens = extractTokens(defText);
        let tokenScore = 0;
        tokens.forEach((t) => {
          if (geminiTokens.has(t) || geminiFullText.includes(t)) tokenScore += t.length >= 4 ? 2 : 1;
        });

        const totalScore = tokenScore + posBonus + baseBonus;
        if (totalScore > bestScore) {
          bestScore = totalScore;
          bestItemIndex = itemIdx;
          bestDefIndex = defIdx;
        }
      });
    });

    if (bestScore > 0) {
      state.geminiMatchedItemIndex = bestItemIndex;
      state.geminiMatchedDefIndex = bestDefIndex;
      if (!state.userSelectedDef) {
        state[`selectedDefIndex_${bestItemIndex}`] = bestDefIndex;
        state.selectedDefinitionIndex = bestDefIndex;
      }
    }
  }

  function cleanKoreanWord(word) {
    return String(word || '').normalize().trim().replace(/(은|는|이|가|을|를|의|에|에서|와|과|도|만|으로|로)$/, '');
  }

  function positionTooltip(x, y, fontSize = 15) {
    if (!tooltip) return;

    const pxSize = Number(fontSize) || 15;
    const widthPx = Math.round(460 * (pxSize / 15));
    tooltip.style.setProperty('--munmek-font-size', `${pxSize}px`);
    tooltip.style.setProperty('--munmek-tooltip-width', `${widthPx}px`);

    tooltip.style.visibility = 'hidden';
    tooltip.style.display = 'block';

    const rect = tooltip.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    let left = Math.max(8, x + 18 + width > window.innerWidth - 8 ? x - width - 18 : x + 18);
    let top = Math.max(8, y + 18 + height > window.innerHeight - 8 ? y - height - 18 : y + 18);

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.visibility = 'visible';
  }

  function hideTooltip() {
    if (tooltip) tooltip.style.display = 'none';
  }

  function truncateText(value, maxLength) {
    const text = String(value || '').normalize().replace(/\s+/g, ' ').trim();
    return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const MunmekUI = {
    ensureTooltip,
    renderTooltip,
    positionTooltip,
    hideTooltip,
    splitEmbeddedDefinitions,
    groupEntriesByDictTitle,
    autoSelectBestDefinitionFromGemini,
    truncateText,
    escapeHtml
  };

  const targetGlobal = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : global);
  targetGlobal.MunmekUI = MunmekUI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
