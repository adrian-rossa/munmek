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

    tooltip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target && e.target.classList && e.target.classList.contains('munmek-followup-input')) {
        e.preventDefault();
        const btn = e.target.closest('.munmek-followup-box')?.querySelector('.munmek-followup-btn');
        if (btn) btn.click();
      }
    });

    document.body.appendChild(tooltip);
    return tooltip;
  }

  function getGeminiAnalysisForState(state, cache) {
    if (!state) return null;
    if (state.currentAnalysis) return state.currentAnalysis;
    if (!cache) return null;
    const sentenceKey = state.sentenceKey || '';
    const wordKey = cleanKoreanWord(state.word || '');
    const matchKey = cleanKoreanWord(state.dictionaryMatch || '');

    const dictGroups = (Array.isArray(state.dictionaryEntries)) ? groupEntriesByDictTitle(state.dictionaryEntries) : [];
    const activeGroup = dictGroups[state.selectedGroupIndex || 0];
    const activeLang = getDictionaryLanguage(activeGroup);
    const langKey = `${sentenceKey}__${activeLang}`;

    if (wordKey && cache.has(`${wordKey}__${langKey}`)) {
      return cache.get(`${wordKey}__${langKey}`);
    }
    if (matchKey && cache.has(`${matchKey}__${langKey}`)) {
      return cache.get(`${matchKey}__${langKey}`);
    }

    if (wordKey && cache.has(`${wordKey}__${sentenceKey}`)) {
      return cache.get(`${wordKey}__${sentenceKey}`);
    }
    if (matchKey && cache.has(`${matchKey}__${sentenceKey}`)) {
      return cache.get(`${matchKey}__${sentenceKey}`);
    }

    return null;
  }

  function findCompoundPair(candidates, targetWord) {
    if (!candidates || !Array.isArray(candidates) || !targetWord) return null;
    const cleanTarget = cleanKoreanLemma(targetWord);
    if (cleanTarget.length < 2) return null;

    for (let i = 0; i < candidates.length; i++) {
      const c1Text = cleanKoreanLemma(candidates[i].text || '');
      if (!c1Text || c1Text === cleanTarget || c1Text.length >= cleanTarget.length) continue;
      if (cleanTarget.startsWith(c1Text)) {
        const remainder = cleanTarget.slice(c1Text.length);
        const match2 = candidates.find((c, idx) => idx !== i && cleanKoreanLemma(c.text || '') === remainder);
        if (match2) {
          return {
            part1: candidates[i],
            part2: match2,
            target: cleanTarget
          };
        }
      }
    }
    return null;
  }

  function renderTooltip(state, sentenceAnalysisCache, onMouseEnter, onMouseLeave, onClick) {
    ensureTooltip(onMouseEnter, onMouseLeave, onClick);

    const analysis = getGeminiAnalysisForState(state, sentenceAnalysisCache);
    if (analysis || state.quickFallback) {
      autoSelectBestDefinitionFromGemini(state, analysis || state.quickFallback);
    }
    let dictHtml = '';

    if (state.isStage2Loading) {
      dictHtml = `
        <div class="munmek-loading-card">
          <div class="munmek-spinner"></div>
          <div class="munmek-loading-text">Reranking dictionary definitions & calculating confidence scores...</div>
          <div class="munmek-loading-subtext">Calculating contextual confidence scores in background</div>
        </div>
      `;
    } else if (Array.isArray(state.dictionaryEntries) && state.dictionaryEntries.length > 0) {
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

    // Partition candidates: dictionary hits first, then fallback chips (Issue 6)
    let candidateList = Array.isArray(state.candidateList) ? [...state.candidateList] : [];
    if (state.verifiedDictionaryCandidates && state.verifiedDictionaryCandidates.size > 0) {
      const hits = [];
      const nonHits = [];
      for (const c of candidateList) {
        if (state.verifiedDictionaryCandidates.has(c.text)) {
          hits.push(c);
        } else {
          nonHits.push(c);
        }
      }
      candidateList = [...hits, ...nonHits];
    }

    const primaryCandidates = candidateList.filter(c => !c.isSubComponent);
    const subCandidates = candidateList.filter(c => Boolean(c.isSubComponent));

    const renderSingleChip = (c) => {
      const isActive = state.dictionaryMatch === c.text;
      const isLlmFallback = Boolean(c.isLlmFallback || (state.verifiedDictionaryCandidates && state.verifiedDictionaryCandidates.size > 0 && !state.verifiedDictionaryCandidates.has(c.text)));
      let badgeText = '';
      let badgeBg = 'rgba(0,0,0,0.06)';
      if (c.isSubComponent) {
        badgeText = '관련';
        badgeBg = '#e0f2fe';
      } else if (c.posHint === 'particle') {
        badgeText = '조사';
        badgeBg = '#e0e7ff';
      } else if (c.posHint === 'grammar' || c.reason?.includes('grammar') || c.reason?.includes('intent') || c.reason?.includes('conjecture')) {
        badgeText = '문법';
        badgeBg = '#fef3c7';
      } else if (c.posHint === 'verb' || c.posHint?.startsWith('verb')) {
        badgeText = '동사';
        badgeBg = '#dcfce7';
      } else if (c.posHint === 'adjective' || c.posHint?.startsWith('adjective')) {
        badgeText = '형용사';
        badgeBg = '#fce7f3';
      } else if (c.posHint === 'noun' || c.posHint === 'noun/stem' || c.reason?.includes('noun') || c.reason?.includes('removed')) {
        badgeText = '명사';
        badgeBg = '#f3f4f6';
      } else if (isLlmFallback) {
        badgeText = '✨ LLM';
        badgeBg = '#fef3c7';
      }

      const badgeHtml = badgeText
        ? `<span class="chip-badge" style="font-size: 0.7em; font-weight: 700; margin-left: 5px; padding: 1px 5px; border-radius: 4px; background: ${isActive ? 'rgba(255,255,255,0.25)' : badgeBg}; color: ${isActive ? '#fff' : '#374151'};">${badgeText}</span>`
        : (isLlmFallback ? `<span class="chip-badge" style="font-size: 0.7em; font-weight: 700; margin-left: 5px; padding: 1px 5px; border-radius: 4px; background: ${isActive ? 'rgba(255,255,255,0.25)' : '#fef3c7'}; color: ${isActive ? '#fff' : '#92400e'};">✨ LLM</span>` : '');

      let borderStyle = isActive ? '1px solid #2f5d62' : '1px solid #cbd5e1';
      let bgStyle = isActive ? '#2f5d62' : '#ffffff';
      let colorStyle = isActive ? '#ffffff' : '#17383b';

      if (isLlmFallback) {
        borderStyle = isActive ? '1px solid #b45309' : '1px dashed #d97706';
        bgStyle = isActive ? '#d97706' : '#e2e8f0';
        colorStyle = isActive ? '#ffffff' : '#78350f';
      }

      return `<button type="button" class="chip" data-candidate="${escapeHtml(c.text)}" style="cursor: pointer; border: ${borderStyle}; background: ${bgStyle}; color: ${colorStyle}; padding: 4px 10px; border-radius: 8px; font-weight: 600; font-size: 0.88em; display: inline-flex; align-items: center; transition: all 0.15s ease;" title="${isLlmFallback ? 'No local dictionary entry (Click for Quick LLM Lookup)' : 'Local Dictionary Entry Available'}">${escapeHtml(c.text)}${badgeHtml}</button>`;
    };

    const compoundPair = findCompoundPair(primaryCandidates, state.originalHoverWord || state.word);

    let candidateChipsHtml = '';
    if (primaryCandidates.length > 0) {
      if (compoundPair) {
        const p1 = compoundPair.part1;
        const p2 = compoundPair.part2;
        const groupHtml = `
          <div class="compound-pill-group" style="display: inline-flex; align-items: center; background: #f0faf7; border: 1.5px solid #2f5d62; border-radius: 9px; padding: 2px 5px; gap: 3px;" title="Compound constituents: ${escapeHtml(p1.text)} + ${escapeHtml(p2.text)}">
            <span style="font-size: 0.72em; font-weight: 800; color: #17383b; margin-right: 2px; margin-left: 2px;">🧩</span>
            ${renderSingleChip(p1)}
            <span style="font-weight: 800; color: #2f5d62; font-size: 0.9em; padding: 0 1px;">+</span>
            ${renderSingleChip(p2)}
          </div>
        `;
        const others = primaryCandidates.filter(c => c.text !== p1.text && c.text !== p2.text).slice(0, 4);
        candidateChipsHtml = `
          <div class="chips" style="margin-bottom: 8px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px;">
            ${groupHtml}
            ${others.map(renderSingleChip).join('')}
          </div>
        `;
      } else {
        candidateChipsHtml = `
          <div class="chips" style="margin-bottom: 8px; display: flex; flex-wrap: wrap; gap: 6px;">
            ${primaryCandidates.slice(0, 6).map(renderSingleChip).join('')}
          </div>
        `;
      }
      if (subCandidates.length > 0) {
        candidateChipsHtml += `
          <div class="sub-chips" style="margin-bottom: 10px; display: flex; flex-wrap: wrap; align-items: center; gap: 5px; font-size: 0.85em; opacity: 0.92;">
            <span style="font-size: 0.75em; font-weight: 700; color: #64748b; margin-right: 2px;">관련:</span>
            ${subCandidates.slice(0, 4).map(renderSingleChip).join('')}
          </div>
        `;
      }
    }

    const iconUrl = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) ? chrome.runtime.getURL('assets/icon32.png') : '';
    const iconHtml = iconUrl ? `<img src="${escapeHtml(iconUrl)}" alt="Munmek" style="width: 24px; height: 24px; margin-right: 8px; vertical-align: middle; display: inline-block; object-fit: contain;">` : '';

    const html = [
      `<div class="title" style="display: flex; align-items: center; gap: 6px;">${iconHtml}<span>${escapeHtml(state.word || '...')}</span></div>`,
      dictHtml,
      candidateChipsHtml,
      state.sentence ? `<div class="subtitle"><strong>Sentence:</strong> ${escapeHtml(truncateText(state.sentence, 180))}</div>` : '',
      renderActions(state, Boolean(analysis)),
      renderAnalysisSection(analysis, state),
      (state.feedback && !state.isAiLoading) ? `
        <div class="toast-feedback ${state.feedbackType === 'error' ? 'toast-error' : (state.feedbackType === 'success' ? 'toast-success' : 'toast-info')}" role="status" aria-live="polite" style="margin-top: 10px; padding: 10px 14px; border-radius: 8px; font-weight: 700; font-size: 0.88em; display: flex; align-items: center; gap: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.12); background: ${state.feedbackType === 'error' ? '#fee2e2' : (state.feedbackType === 'success' ? '#dcfce7' : '#f0f9ff')}; color: ${state.feedbackType === 'error' ? '#991b1b' : (state.feedbackType === 'success' ? '#166534' : '#0369a1')}; border: 1.5px solid ${state.feedbackType === 'error' ? '#ef4444' : (state.feedbackType === 'success' ? '#22c55e' : '#38bdf8')};">
          <span style="font-size: 1.2em;">${state.feedbackType === 'error' ? '⚠️' : (state.feedbackType === 'success' ? '✅' : 'ℹ️')}</span>
          <span>${escapeHtml(state.feedback)}</span>
        </div>
      ` : ''
    ].filter(Boolean).join('');

    const tooltipDictGroups = Array.isArray(state?.dictionaryEntries) ? groupEntriesByDictTitle(state.dictionaryEntries) : [];
    const isJaActive = Boolean(
      (tooltipDictGroups.length > 0 && /(?:ja|jpn|japanese|日本語|日韓)/i.test(tooltipDictGroups[state?.selectedGroupIndex || 0]?.title || '')) ||
      (tooltipDictGroups.length > 0 && /[\u3040-\u30ff]/.test((tooltipDictGroups[state?.selectedGroupIndex || 0]?.items || []).flatMap(it => it.definitions || []).join(' '))) ||
      (state?.currentAnalysisLanguage && /(?:ja|jpn|japanese|日本語)/i.test(state.currentAnalysisLanguage)) ||
      (analysis && /[\u3040-\u30ff]/.test(JSON.stringify(analysis)))
    );
    if (tooltip) {
      if (tooltip.classList && typeof tooltip.classList.add === 'function') {
        if (isJaActive) {
          tooltip.classList.add('lang-ja');
        } else if (typeof tooltip.classList.remove === 'function') {
          tooltip.classList.remove('lang-ja');
        }
      }
      if (typeof tooltip.setAttribute === 'function') {
        if (isJaActive) {
          tooltip.setAttribute('lang', 'ja');
        } else if (typeof tooltip.removeAttribute === 'function') {
          tooltip.removeAttribute('lang');
        }
      }
    }

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

  function getDictionaryLanguage(dictGroup) {
    if (!dictGroup) return 'English';
    const firstItem = (dictGroup.items && dictGroup.items[0]) || {};
    const targetLang = (firstItem.dictTargetLanguage || '').toLowerCase().trim();

    if (targetLang === 'ja' || targetLang === 'jpn' || targetLang === 'japanese') return 'Japanese';
    if (targetLang === 'en' || targetLang === 'eng' || targetLang === 'english') return 'English';
    if (targetLang === 'ko' || targetLang === 'kor' || targetLang === 'korean') return 'Korean';
    if (targetLang === 'zh' || targetLang === 'cmn' || targetLang === 'chi' || targetLang === 'chinese') return 'Chinese';
    if (targetLang === 'es' || targetLang === 'spa' || targetLang === 'spanish') return 'Spanish';
    if (targetLang === 'fr' || targetLang === 'fre' || targetLang === 'fra' || targetLang === 'french') return 'French';
    if (targetLang === 'de' || targetLang === 'ger' || targetLang === 'deu' || targetLang === 'german') return 'German';
    if (targetLang === 'vi' || targetLang === 'vie' || targetLang === 'vietnamese') return 'Vietnamese';
    if (targetLang === 'ru' || targetLang === 'rus' || targetLang === 'russian') return 'Russian';

    const title = (dictGroup.title || firstItem.dictTitle || '').toLowerCase();
    if (/(?:\b|_)(?:ja|jpn|japanese|日本語|日韓)(?:\b|_)/i.test(title)) return 'Japanese';
    if (/(?:\b|_)(?:en|eng|english|영한)(?:\b|_)/i.test(title)) return 'English';
    if (/(?:\b|_)(?:ko|kor|korean|국어|한한)(?:\b|_)/i.test(title)) return 'Korean';
    if (/(?:\b|_)(?:zh|cmn|chi|chinese|중한|漢語)(?:\b|_)/i.test(title)) return 'Chinese';
    if (/(?:\b|_)(?:es|spa|spanish|서한)(?:\b|_)/i.test(title)) return 'Spanish';
    if (/(?:\b|_)(?:fr|fre|fra|french|불한)(?:\b|_)/i.test(title)) return 'French';
    if (/(?:\b|_)(?:de|ger|deu|german|독한)(?:\b|_)/i.test(title)) return 'German';

    // Character heuristic on sample definitions
    const sampleText = (dictGroup.items || []).slice(0, 5).flatMap(it => it.definitions || []).join(' ');
    if (/[\u3040-\u30ff]/.test(sampleText)) return 'Japanese';
    if (/[\u4e00-\u9faf]/.test(sampleText) && !/[가-힣]/.test(sampleText)) return 'Chinese';
    if (/[a-zA-Z]/.test(sampleText)) return 'English';

    return 'English';
  }

  function getLlmResponseLanguage(analysisData) {
    if (!analysisData) return 'English';
    if (typeof analysisData._responseLanguage === 'string' && analysisData._responseLanguage.trim()) {
      return analysisData._responseLanguage.trim();
    }
    const norm = normalizeGeminiAnalysis(analysisData);
    const sample = [
      ...(Array.isArray(norm?.definitions) ? norm.definitions : [norm?.definition]),
      norm?.grammar_notes,
      norm?.translation
    ].filter(Boolean).join(' ');

    if (/[\u3040-\u30ff]/.test(sample)) return 'Japanese';
    if (/[\u4e00-\u9faf]/.test(sample) && !/[가-힣]/.test(sample) && !/[a-zA-Z]/.test(sample)) return 'Chinese';
    return 'English';
  }

  function renderDictionaryEntriesGrouped(entries, matchLabel, state) {
    const dictGroups = groupEntriesByDictTitle(entries);
    if (dictGroups.length === 0) return '<div class="section empty">No definitions available.</div>';

    const selectedGroupIdx = (state && typeof state.selectedGroupIndex === 'number') ? state.selectedGroupIndex : 0;
    const validGroupIdx = (selectedGroupIdx >= 0 && selectedGroupIdx < dictGroups.length) ? selectedGroupIdx : 0;
    const activeGroup = dictGroups[validGroupIdx];
    const activeDictLang = (getDictionaryLanguage(activeGroup) || '').toLowerCase();
    const isJaGroup = activeDictLang === 'ja' || activeDictLang === 'japanese' || Boolean(activeGroup?.title && /(?:ja|jpn|japanese|日本語|日韓)/i.test(activeGroup.title));
    const activeAnalysisLang = (state?.currentAnalysisLanguage || getLlmResponseLanguage(state?.currentAnalysis) || '').toLowerCase();

    let topTabsHtml = '';
    if (dictGroups.length > 1) {
      topTabsHtml = `<div class="dict-group-tabs" style="display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap;">
        ${dictGroups.map((g, idx) => {
          const isActive = idx === validGroupIdx;
          return `<button type="button" class="dict-group-tab" data-action="select-dict-group-tab" data-group-index="${idx}" style="cursor: pointer; font-size: 0.78em; font-weight: 700; padding: 4px 12px; border-radius: 8px; border: 1px solid ${isActive ? '#2f5d62' : '#ddd3c4'}; background: ${isActive ? '#2f5d62' : '#fff'}; color: ${isActive ? '#fff' : '#4f463a'};">Dict: ${escapeHtml(g.title)}</button>`;
        }).join('')}
      </div>`;
    }

    const itemsHtml = activeGroup.items.map((entry, itemIdx) => renderSingleEntryCard(entry, matchLabel, itemIdx, state, validGroupIdx, isJaGroup)).join('');

    return `
      <div class="dictionary-container ${isJaGroup ? 'munmek-ja' : ''}" ${isJaGroup ? 'lang="ja"' : ''}>
        ${topTabsHtml}
        ${itemsHtml}
      </div>
    `;
  }

  function formatDefinitionText(rawDef) {
    if (!rawDef || typeof rawDef !== 'string') return '';
    const decoded = decodeHtmlEntities(rawDef);
    return decoded.trim()
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

  function decodeHtmlEntities(str) {
    if (!str || typeof str !== 'string' || !str.includes('&')) return str || '';
    return str.replace(/&(?:quot|apos|#39|#039|lt|gt|nbsp|amp|#(\d+)|#x([0-9a-fA-F]+));/gi, (match, dec, hex) => {
      if (dec) return String.fromCharCode(parseInt(dec, 10));
      if (hex) return String.fromCharCode(parseInt(hex, 16));
      const lower = match.toLowerCase();
      switch (lower) {
        case '&quot;': return '"';
        case '&apos;':
        case '&#39;':
        case '&#039;': return "'";
        case '&lt;': return '<';
        case '&gt;': return '>';
        case '&nbsp;': return ' ';
        case '&amp;': return '&';
        default: return match;
      }
    });
  }

  function stripHtml(value) {
    return String(value || '')
      .replace(/<r[tp][^>]*>.*?<\/r[tp]>/gi, '')
      .replace(/<[^>]*>/g, '')
      .trim();
  }

  function escapeHtmlPreservingMarkup(str) {
    if (!str || typeof str !== 'string') return '';
    const decoded = decodeHtmlEntities(str);
    const safeTagRegex = /(<\/?(?:ruby|rt|rp|b|strong|i|em)\s*>|<br\s*\/?>)/gi;
    const parts = decoded.split(safeTagRegex);
    return parts.map((part) => {
      if (/^<\/?(?:ruby|rt|rp|b|strong|i|em)\s*>$/i.test(part) || /^<br\s*\/?>$/i.test(part)) {
        return part.toLowerCase();
      }
      return escapeHtml(part);
    }).join('');
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

    const rawLines = [];
    defList.forEach((item) => {
      if (!item || typeof item !== 'string') return;
      const decodedItem = decodeHtmlEntities(item);
      const subParts = decodedItem.split(/(?<=\D|^)(?=\b\d{1,2}[\.\)]\s+)/g);
      subParts.forEach((part) => {
        part.split(/\r?\n/).forEach((l) => {
          const t = l.trim();
          if (t) rawLines.push(t);
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

    rawLines.forEach((line) => {
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
        const jaHeadwordMatch = cleaned.match(/^(.*?【[^】]+】)\s*(.+)$/);
        if (jaHeadwordMatch) {
          currentSense = { title: jaHeadwordMatch[1].trim(), bodyLines: [jaHeadwordMatch[2].trim()], pattern: '' };
        } else {
          currentSense = { title: cleaned, bodyLines: [], pattern: '' };
        }
        return;
      }

      const jaHeadwordMatch = cleaned.match(/^(.*?【[^】]+】)\s*(.+)$/);
      if (jaHeadwordMatch) {
        if (currentSense) senses.push(currentSense);
        currentSense = { title: jaHeadwordMatch[1].trim(), bodyLines: [jaHeadwordMatch[2].trim()], pattern: '' };
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

      if (currentSense) {
        if (isDescriptionLine(cleaned) || !currentSense.title) {
          if (!currentSense.title) {
            currentSense.title = cleaned;
          } else {
            currentSense.bodyLines.push(cleaned);
          }
        } else {
          senses.push(currentSense);
          currentSense = { title: cleaned, bodyLines: [], pattern: '' };
        }
      } else {
        currentSense = { title: cleaned, bodyLines: [], pattern: '' };
      }
    });

    if (currentSense) senses.push(currentSense);

    if (senses.length === 0) return defList.map(formatDefinitionText).map(escapeHtmlPreservingMarkup);

    return senses.map((s) => {
      const parts = [];
      if (s.title) {
        if (!s.bodyLines || s.bodyLines.length === 0) {
          if (s.title.endsWith('。') || s.title.length > 25) {
            parts.push(escapeHtmlPreservingMarkup(s.title));
          } else {
            parts.push(`<strong>${escapeHtmlPreservingMarkup(s.title)}</strong>`);
          }
        } else {
          parts.push(`<strong>${escapeHtmlPreservingMarkup(s.title)}</strong>`);
        }
      }
      if (s.bodyLines && s.bodyLines.length > 0) {
        parts.push(escapeHtmlPreservingMarkup(s.bodyLines.join('\n')));
      }
      if (s.pattern) {
        parts.push(`<span class="muted" style="font-style: italic; font-size: 0.9em;">(Pattern: ${escapeHtmlPreservingMarkup(s.pattern)})</span>`);
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

  function renderCollapsibleDefinition(defText, itemIndex = 0) {
    if (!defText) return '';
    const lines = defText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 3) {
      const visible = lines.slice(0, 3).join('\n');
      const hidden = lines.slice(3).join('\n');
      const hiddenId = `def-hidden-${itemIndex}`;
      return `
        <div>${visible}</div>
        <div id="${hiddenId}" style="display: none; margin-top: 6px;">${hidden}</div>
        <button type="button" data-action="toggle-def" data-target="${hiddenId}" style="cursor: pointer; font-size: 0.78em; color: #2f5d62; background: none; border: none; font-weight: 700; padding: 4px 0 0 0; display: inline-flex; align-items: center; gap: 4px;">Show all ${lines.length} definitions ▾</button>
      `;
    }
    return defText;
  }

  function renderSingleEntryCard(entry, matchLabel = '', itemIndex = 0, state = {}, groupIndex = 0, isJaGroup = false) {
    const rawDefinitions = Array.isArray(entry.definitions) ? entry.definitions : [];
    const definitions = splitEmbeddedDefinitions(rawDefinitions, entry.surface || entry.word || '');
    const isJa = isJaGroup ||
      Boolean(entry?.dictTitle && /(?:ja|jpn|japanese|日本語|日韓)/i.test(entry.dictTitle)) ||
      (Array.isArray(entry?.definitions) && /[\u3040-\u30ff]/.test(entry.definitions.join(' ')));

    const activeGroupMatch = (state.geminiMatchesByGroup && typeof groupIndex === 'number')
      ? state.geminiMatchesByGroup[groupIndex]
      : null;

    const isCardMatched = activeGroupMatch
      ? Boolean(activeGroupMatch.matched && activeGroupMatch.itemIndex === itemIndex && typeof activeGroupMatch.defIndex === 'number')
      : Boolean((state.geminiMatchedGroupIndex === groupIndex || typeof state.geminiMatchedGroupIndex !== 'number') && state.geminiMatchedItemIndex === itemIndex && typeof state.geminiMatchedDefIndex === 'number');

    const matchedDefIdx = isCardMatched
      ? (activeGroupMatch ? (activeGroupMatch.matched ? activeGroupMatch.defIndex : null) : state.geminiMatchedDefIndex)
      : null;
    const hasGeminiMatch = typeof matchedDefIdx === 'number';

    const isStage2Enabled = state.isStage2Enabled !== false;
    const isKoElectraMatched = isStage2Enabled && Boolean(entry && entry._koelectraMatched);
    const rawBestIdx = (isStage2Enabled && typeof entry._bestDefIndex === 'number') ? entry._bestDefIndex : 0;
    const koelectraMatchedDefIdx = Math.min(Math.max(0, rawBestIdx), Math.max(0, definitions.length - 1));
    const defConfScores = isStage2Enabled && Array.isArray(entry._defConfidenceScores) ? entry._defConfidenceScores : [];

    const selectedIndexKey = `selectedDefIndex_${itemIndex}`;
    let selectedIndex = 0;
    if (state.userSelectedDef && typeof state[selectedIndexKey] === 'number') {
      selectedIndex = state[selectedIndexKey];
    } else if (hasGeminiMatch) {
      selectedIndex = matchedDefIdx;
    } else if (isStage2Enabled && typeof entry._bestDefIndex === 'number') {
      selectedIndex = koelectraMatchedDefIdx;
    } else if (typeof state[selectedIndexKey] === 'number') {
      selectedIndex = state[selectedIndexKey];
    }
    const validIndex = (selectedIndex >= 0 && selectedIndex < definitions.length) ? selectedIndex : 0;
    const selectedDef = definitions[validIndex] || '';

    const activeConfScore = isStage2Enabled ? (defConfScores[validIndex] || entry._confidenceScore || null) : null;
    const bestConfScore = isStage2Enabled ? (defConfScores[koelectraMatchedDefIdx] || entry._confidenceScore || null) : null;
    const hasKoElectraMatch = isStage2Enabled && Boolean(activeConfScore || bestConfScore);

    const chips = [entry.pos, entry.type, matchLabel].filter(Boolean).map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join('');

    let geminiBadgeHtml = '';
    if (hasGeminiMatch) {
      if (validIndex === matchedDefIdx) {
        geminiBadgeHtml = `<span style="background: linear-gradient(135deg, #17383b 0%, #2f5d62 100%); color: #fff; padding: 3px 10px; border-radius: 999px; font-size: 0.74em; font-weight: 800; margin-left: 6px; display: inline-flex; align-items: center; gap: 4px; box-shadow: 0 2px 6px rgba(47,93,98,0.25); border: 1px solid #17383b;">✨ LLM Matched</span>`;
      } else {
        geminiBadgeHtml = `<span style="background: #e4f0ee; color: #17383b; border: 1.5px solid #2f5d62; padding: 2px 8px; border-radius: 999px; font-size: 0.72em; font-weight: 700; margin-left: 6px; display: inline-block;">✨ LLM Matched (Def ${matchedDefIdx + 1})</span>`;
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

    const isCurrentDefLlmMatched = Boolean(hasGeminiMatch && validIndex === matchedDefIdx);
    const defBoxBg = isCurrentDefLlmMatched ? '#f0faf7' : '#faf7f2';
    const defBoxBorder = isCurrentDefLlmMatched ? '1.5px solid #99d5cb' : '1px solid #eadfce';
    const defBoxBorderLeft = isCurrentDefLlmMatched ? '5px solid #2f5d62' : '4px solid #2f5d62';
    const defBoxShadow = isCurrentDefLlmMatched ? 'box-shadow: 0 2px 10px rgba(47,93,98,0.1);' : '';

    const aiMatchedBannerHtml = isCurrentDefLlmMatched
      ? `<div style="display: inline-flex; align-items: center; gap: 5px; font-size: 0.72em; font-weight: 800; color: #17383b; background: #d7ede7; padding: 2px 8px; border-radius: 5px; margin-bottom: 6px; letter-spacing: 0.02em;">
          <span>✨</span><span>LLM Context-Matched Definition</span>
         </div>`
      : '';

    const tabsHtml = definitions.length > 1
      ? `<div class="def-tabs" style="display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; padding-bottom: 4px;">
          ${definitions.map((def, idx) => {
            const isActive = idx === validIndex;
            const isLlmTab = (isCardMatched && matchedDefIdx === idx);
            const isMatchedTab = isLlmTab || (isKoElectraMatched && koelectraMatchedDefIdx === idx);
            const shortText = truncateText(stripHtml(def), 18);
            const tabScoreStr = (isStage2Enabled && defConfScores[idx]) ? ` (${defConfScores[idx]})` : '';

            let tabBg = isActive ? '#2f5d62' : (isMatchedTab ? '#e4f0ee' : '#fff');
            let tabColor = isActive ? '#fff' : '#4f463a';
            let tabBorder = isActive ? '#2f5d62' : (isMatchedTab ? '#2f5d62' : '#ddd3c4');
            let extraStyle = '';

            if (isLlmTab) {
              if (isActive) {
                tabBg = 'linear-gradient(135deg, #17383b 0%, #2f5d62 100%)';
                tabBorder = '#17383b';
                extraStyle = 'box-shadow: 0 2px 6px rgba(47,93,98,0.3); font-weight: 800;';
              } else {
                tabBg = '#ebf7f4';
                tabColor = '#17383b';
                tabBorder = '#2f5d62';
                extraStyle = 'box-shadow: 0 0 0 1px rgba(47,93,98,0.2); font-weight: 700;';
              }
            }

            return `<button type="button" class="def-tab ${isJa ? 'munmek-ja' : ''}" ${isJa ? 'lang="ja"' : ''} data-action="select-def-tab" data-item-index="${itemIndex}" data-def-index="${idx}" style="cursor: pointer; font-size: 0.76em; padding: 4px 9px; border-radius: 6px; border: 1px solid ${tabBorder}; background: ${tabBg}; color: ${tabColor}; ${extraStyle}">Def ${idx + 1}: ${escapeHtml(shortText)}${tabScoreStr}${isMatchedTab ? ' ✨' : ''}</button>`;
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
          <div class="def-text ${isJa ? 'munmek-ja' : ''}" ${isJa ? 'lang="ja"' : ''} style="font-size: 0.94em; font-weight: 400; color: #1e1b16; background: ${defBoxBg}; border: ${defBoxBorder}; border-left: ${defBoxBorderLeft}; ${defBoxShadow} border-radius: 8px; padding: 10px 12px; line-height: 1.65; white-space: pre-line;">
            ${aiMatchedBannerHtml}
            ${renderCollapsibleDefinition(selectedDef, itemIndex)}
          </div>
         </div>`
      : '<div class="section empty">No definition text available.</div>';

    const showEntryWordHeader = Boolean(
      (entry.surface && entry.surface !== state.word) ||
      (entry.base && entry.base !== entry.surface)
    );

    return `
      <div class="section entry-box ${isJa ? 'munmek-ja' : ''}" ${isJa ? 'lang="ja"' : ''} style="${borderStyle} padding-left: 12px; border-radius: 8px; border: 1px solid #eadfce; margin-bottom: 8px;">
        ${showEntryWordHeader ? `<div class="entry-head"><div class="entry-word" style="font-weight: 700;">${escapeHtml(entry.surface || '')}${entry.base && entry.base !== entry.surface ? ` <span class="muted">(${escapeHtml(entry.base)})</span>` : ''}</div></div>` : ''}
        ${chips ? `<div class="chips" style="margin-top: 4px; margin-bottom: 6px;">${chips}</div>` : ''}
        ${definitionBoxHtml}
        ${entry.hanja ? `<div class="section"><div class="label">Hanja</div><div>${escapeHtml(entry.hanja)}</div></div>` : ''}
        ${entry.grammar_notes ? `<div class="section"><div class="label">Notes</div><div>${escapeHtml(entry.grammar_notes)}</div></div>` : ''}
      </div>
    `;
  }

  function renderGeminiFallbackEntry(rawNorm, word) {
    const norm = normalizeGeminiAnalysis(rawNorm) || rawNorm || {};
    const defText = formatDefinitionText(
      norm.translation ||
      (Array.isArray(norm.definitions) ? norm.definitions.join('; ') : norm.definition) ||
      (Array.isArray(rawNorm?.definitions) ? rawNorm.definitions.join('; ') : rawNorm?.definition) ||
      'No definition available.'
    );
    const grammarText = norm.grammar || norm.grammar_notes || rawNorm?.grammar_notes || '';
    const hanjaText = norm.hanja || rawNorm?.hanja || '';
    const posText = norm.pos || rawNorm?.pos || '';

    return `
      <div class="section entry-box" style="border-left: 4px solid #d97706; padding-left: 12px; background: #fffbeb; border-radius: 8px; border: 1px solid #fef3c7; margin-bottom: 8px;">
        <div class="entry-head">
          <div class="entry-word">${escapeHtml(word || '')} ${posText ? `<span class="muted" style="font-size:0.82em;">(${escapeHtml(posText)})</span>` : ''}</div>
        </div>
        <div class="chips"><span class="chip" style="background:#d97706; color:#fff; font-weight:700;">Quick LLM Lookup</span></div>
        <div class="section">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <div class="label" style="margin: 0;">Definition / Translation</div>
            <button type="button" class="chip" data-action="anki-llm" title="Add this Quick LLM definition card to Anki" style="cursor: pointer; font-size: 0.76em; padding: 2px 8px; border: none; background: #d97706; color: #fff; border-radius: 6px;">+ Anki</button>
          </div>
          <div class="def-text" style="font-size: 0.94em; font-weight: 400; color: #1e1b16; background: #fff; border: 1px solid #fcd34d; border-radius: 8px; padding: 10px 12px; line-height: 1.65; white-space: pre-line;">
            ${escapeHtml(defText)}
          </div>
        </div>
        ${hanjaText ? `<div class="section"><div class="label">Hanja</div><div>${escapeHtml(hanjaText)}</div></div>` : ''}
        ${grammarText ? `<div class="section"><div class="label">Grammar Notes</div><div style="font-size:0.88em; color:#451a03; background:#fff7ed; padding:6px 10px; border-radius:6px; margin-top:4px;">${escapeHtml(grammarText)}</div></div>` : ''}
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
    const dictGroups = (state && Array.isArray(state.dictionaryEntries)) ? groupEntriesByDictTitle(state.dictionaryEntries) : [];
    const selectedGroupIdx = (state && typeof state.selectedGroupIndex === 'number') ? state.selectedGroupIndex : 0;
    const validGroupIdx = (selectedGroupIdx >= 0 && selectedGroupIdx < dictGroups.length) ? selectedGroupIdx : 0;
    const activeGroup = dictGroups[validGroupIdx];
    const primaryGroup = dictGroups[0];
    const primaryDictLang = primaryGroup ? getDictionaryLanguage(primaryGroup) : 'English';
    const activeDictLang = activeGroup ? getDictionaryLanguage(activeGroup) : primaryDictLang;
    const activeAnalysisLang = state?.currentAnalysisLanguage || getLlmResponseLanguage(state?.currentAnalysis);

    const hasAnyAnalysis = Boolean(
      hasCachedAnalysis ||
      state?.currentAnalysis ||
      (state?.cachedAnalysesByLang && Object.keys(state.cachedAnalysesByLang).length > 0)
    );
    const hasActiveLangCached = state?.cachedAnalysesByLang && Boolean(state.cachedAnalysesByLang[activeDictLang]);
    const isCurrentAnalysisActiveLang = Boolean(hasCachedAnalysis && activeAnalysisLang.toLowerCase() === activeDictLang.toLowerCase());

    let aiLabel = '✨ Ask LLM';
    if (hasAnyAnalysis) {
      if (hasActiveLangCached || isCurrentAnalysisActiveLang) {
        aiLabel = '✨ Refresh LLM';
      } else {
        aiLabel = `✨ Refresh LLM (${activeDictLang})`;
      }
    }

    const ankiLlmBtn = hasCachedAnalysis
      ? `<button class="secondary-button" data-action="anki-llm" style="background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; font-weight: 700;" title="Send Ask LLM / Quick LLM definition to Anki">Send to Anki (LLM)</button>`
      : '';

    return `
      <div class="section">
        <div class="actions" style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="primary-button" data-action="analyze" data-lang="${escapeHtml(activeDictLang)}">${escapeHtml(aiLabel)}</button>
          ${ankiLlmBtn}
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

  function extractCustomFields(targetItem, rawAnalysis) {
    const reservedKeys = new Set([
      'surface', 'word', 'base', 'pos', 'definitions', 'definition',
      'meaning', 'meanings', 'translation', 'translations', 'conjugation',
      'grammar_notes', 'notes', 'grammar', 'id', 'hanja', 'reading',
      'pronunciation', 'words_analysis', 'words', 'analysis', 'raw',
      'error', 'data', 'model', 'usage', 'status', 'sentence',
      'targetword', 'target_word', 'success', 'prompt', 'response'
    ]);

    const customFields = [];
    const seenKeys = new Set();

    const addField = (key, val) => {
      if (!key || typeof key !== 'string') return;
      const cleanKey = key.trim();
      if (cleanKey.startsWith('_')) return;
      const lower = cleanKey.toLowerCase();
      if (reservedKeys.has(lower) || seenKeys.has(lower)) return;
      if (val === null || val === undefined || val === '') return;

      let displayVal = '';
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
        displayVal = String(val).trim();
      } else if (Array.isArray(val)) {
        displayVal = val
          .map(v => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v).trim()))
          .filter(Boolean)
          .join('; ');
      } else if (typeof val === 'object') {
        displayVal = JSON.stringify(val);
      }
      if (!displayVal) return;

      seenKeys.add(lower);
      const label = cleanKey
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());

      customFields.push({ key: cleanKey, label, value: displayVal });
    };

    // 1. Check targetItem (word-level custom fields)
    if (targetItem && typeof targetItem === 'object') {
      for (const [k, v] of Object.entries(targetItem)) {
        addField(k, v);
      }
    }

    // 2. Check words_analysis[0] if different from targetItem
    if (rawAnalysis && Array.isArray(rawAnalysis.words_analysis) && rawAnalysis.words_analysis[0] && rawAnalysis.words_analysis[0] !== targetItem) {
      for (const [k, v] of Object.entries(rawAnalysis.words_analysis[0])) {
        addField(k, v);
      }
    }

    // 3. Check top-level rawAnalysis (sentence-level custom fields like japanese_translation)
    if (rawAnalysis && typeof rawAnalysis === 'object') {
      for (const [k, v] of Object.entries(rawAnalysis)) {
        addField(k, v);
      }
    }

    // 4. Check rawAnalysis.data if present
    if (rawAnalysis && rawAnalysis.data && typeof rawAnalysis.data === 'object') {
      for (const [k, v] of Object.entries(rawAnalysis.data)) {
        addField(k, v);
      }
    }

    // 5. If root-level translation exists and differs from definitions, show as Sentence Translation
    if (rawAnalysis && typeof rawAnalysis.translation === 'string' && rawAnalysis.translation.trim()) {
      const sentenceTrans = rawAnalysis.translation.trim();
      const existingDefs = (targetItem && Array.isArray(targetItem.definitions))
        ? targetItem.definitions.join(' ')
        : (targetItem && targetItem.definition ? String(targetItem.definition) : '');
      if (!existingDefs.includes(sentenceTrans) && !seenKeys.has('translation') && !seenKeys.has('sentence_translation')) {
        seenKeys.add('translation');
        customFields.push({ key: 'translation', label: 'Sentence Translation', value: sentenceTrans });
      }
    }

    return customFields;
  }

  function renderAnalysisSection(rawAnalysis, currentHoverState) {
    if (currentHoverState && currentHoverState.isAiLoading) {
      return `
        <div class="munmek-loading-card" style="border: 1px solid #2f5d62; background: #f4faf9; margin-top: 10px; border-radius: 8px; padding: 14px; text-align: center;">
          <div class="munmek-spinner" style="margin: 0 auto 8px auto;"></div>
          <div class="munmek-loading-text" style="font-weight: 700; color: #17383b; font-size: 0.9em;">Analyzing context & grammar with LLM...</div>
          <div class="munmek-loading-subtext" style="font-size: 0.78em; color: #6b7280; margin-top: 4px;">Disambiguating word sense in context</div>
        </div>
      `;
    }

    if (!rawAnalysis) {
      return '<div class="section empty">Ask LLM for a richer, context-aware explanation.</div>';
    }

    if (rawAnalysis.error) {
      return `<div class="section feedback error">${escapeHtml(rawAnalysis.error)}</div>`;
    }

    const followupHtml = `
      <div class="munmek-followup-box" style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed #bce0da;">
        <div style="display: flex; gap: 6px; align-items: center;">
          <input type="text" class="munmek-followup-input" placeholder="Ask a follow-up question..." style="flex: 1; font-size: 0.84em; padding: 6px 10px; border: 1px solid #bce0da; border-radius: 6px; outline: none; background: #fff; color: #17383b;" />
          <button type="button" class="munmek-followup-btn" data-action="ask-followup" style="font-size: 0.82em; font-weight: 700; padding: 6px 12px; background: #2f5d62; color: #fff; border: none; border-radius: 6px; cursor: pointer;">Ask</button>
        </div>
        <div class="munmek-followup-response" style="font-size: 0.86em; color: #17383b; margin-top: 8px; padding: 8px 10px; background: #fff; border: 1px solid #bce0da; border-radius: 6px; line-height: 1.45; display: none;"></div>
      </div>
    `;

    const wordsAnalysis = Array.isArray(rawAnalysis.words_analysis)
      ? rawAnalysis.words_analysis
      : (Array.isArray(rawAnalysis.words) ? rawAnalysis.words : (Array.isArray(rawAnalysis.analysis) ? rawAnalysis.analysis : null));

    if (wordsAnalysis && wordsAnalysis.length > 0) {
      const currentWord = cleanKoreanWord(currentHoverState ? currentHoverState.word : '');
      const currentMatch = cleanKoreanWord(currentHoverState ? (currentHoverState.dictionaryMatch || currentHoverState.word) : '');
      let targetItem = wordsAnalysis.find((item) => {
        const s = cleanKoreanWord(item.surface || item.word || '');
        const b = cleanKoreanWord(item.base || '');
        if (!s && !b) return false;
        if (s === currentWord || b === currentWord || s === currentMatch || b === currentMatch) return true;
        if (currentWord.startsWith(s) || s.startsWith(currentWord) || currentMatch.startsWith(s) || s.startsWith(currentMatch)) return true;
        return currentWord.includes(s) || s.includes(currentWord) || currentMatch.includes(s) || s.includes(currentMatch);
      });

      if (!targetItem) {
        targetItem = wordsAnalysis[0];
      }

      const surface = targetItem.surface || targetItem.word || '';
      const base = cleanKoreanLemma(targetItem.base || '');
      const pos = targetItem.pos || '';
      const defs = Array.isArray(targetItem.definitions) ? targetItem.definitions : (targetItem.definition ? [targetItem.definition] : (targetItem.translation ? [targetItem.translation] : []));
      const conj = targetItem.conjugation;
      const notes = targetItem.grammar_notes || targetItem.notes || '';
      const hanja = targetItem.hanja ? String(targetItem.hanja).trim() : '';

      const customFields = extractCustomFields(targetItem, rawAnalysis);
      const customFieldsHtml = customFields.map(f => `
        <div class="munmek-custom-field" style="font-size: 0.84em; color: #17383b; margin-top: 6px; background: #fff; padding: 6px 10px; border-radius: 8px; border: 1px solid #bce0da; line-height: 1.45;">
          <strong style="color: #2f5d62;">${escapeHtml(f.label)}:</strong> ${escapeHtml(f.value)}
        </div>
      `).join('');

      const isJaAnalysis = Boolean(rawAnalysis?._responseLanguage && /(?:ja|jpn|japanese|日本語)/i.test(rawAnalysis._responseLanguage)) ||
                           Boolean(currentHoverState?.currentAnalysisLanguage && /(?:ja|jpn|japanese|日本語)/i.test(currentHoverState.currentAnalysisLanguage)) ||
                           /[\u3040-\u30ff]/.test(defs.join(' ') + (rawAnalysis?.grammar_notes || ''));

      return `
        <div class="section entry-box ${isJaAnalysis ? 'munmek-ja' : ''}" ${isJaAnalysis ? 'lang="ja"' : ''} style="border: 1px solid #2f5d62; background: #f4faf9; margin-top: 10px; border-radius: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 6px; margin-bottom: 6px;">
            <span style="font-weight: 700; color: #17383b; font-size: 0.96em;">
              LLM: ${escapeHtml(surface)} ${base && base !== surface ? `<span class="muted" style="font-weight:400;">(${escapeHtml(base)}${hanja ? ` / ${escapeHtml(hanja)}` : ''})</span>` : (hanja ? `<span class="muted" style="font-weight:400;">(${escapeHtml(hanja)})</span>` : '')}
            </span>
            ${pos ? `<span class="chip" style="font-size: 0.74em; background: #2f5d62; color: #fff;">${escapeHtml(pos)}</span>` : ''}
          </div>

          ${defs.length > 0
            ? `<ul class="${isJaAnalysis ? 'munmek-ja' : ''}" ${isJaAnalysis ? 'lang="ja"' : ''} style="margin: 4px 0 6px 18px; padding: 0; color: #1e1b16; font-size: 0.88em; line-height: 1.65;">
                ${defs.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}
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

          ${customFieldsHtml}

          ${followupHtml}
        </div>
      `;
    }

    const normalized = normalizeGeminiAnalysis(rawAnalysis);
    const fallbackCustomFields = extractCustomFields(null, rawAnalysis);
    if ((!normalized || (!normalized.translation && !normalized.grammar && !normalized.notes && !normalized.hanja)) && fallbackCustomFields.length === 0) {
      return '<div class="section empty">No structural breakdown returned.</div>';
    }

    const fallbackCustomFieldsHtml = fallbackCustomFields.map(f => `
      <div class="munmek-custom-field" style="font-size: 0.84em; color: #17383b; margin-top: 6px; background: #fff; padding: 6px 10px; border-radius: 8px; border: 1px solid #bce0da; line-height: 1.45;">
        <strong style="color: #2f5d62;">${escapeHtml(f.label)}:</strong> ${escapeHtml(f.value)}
      </div>
    `).join('');

    return `
      <div class="section entry-box" style="border: 1px solid #2f5d62; background: #f4faf9; margin-top: 10px; border-radius: 8px; padding: 10px 12px;">
        <div style="font-weight: 700; color: #17383b; font-size: 0.96em; margin-bottom: 6px;">
          LLM Contextual Analysis
        </div>
        ${normalized && normalized.translation ? `<div style="font-size: 0.9em; color: #1e1b16; margin-bottom: 4px;"><strong>Translation/Def:</strong> ${escapeHtml(normalized.translation)}</div>` : ''}
        ${normalized && normalized.grammar ? `<div style="font-size: 0.84em; color: #17383b; background: #e4f0ee; padding: 6px 10px; border-radius: 8px; margin-top: 4px;"><strong>Grammar:</strong> ${escapeHtml(normalized.grammar)}</div>` : ''}
        ${normalized && normalized.notes ? `<div style="font-size: 0.84em; color: #4f463a; font-style: italic; background: #fff; padding: 6px 10px; border-radius: 8px; border: 1px solid #eadfce; margin-top: 4px;"><strong>Note:</strong> ${escapeHtml(normalized.notes)}</div>` : ''}
        ${fallbackCustomFieldsHtml}
        ${followupHtml}
      </div>
    `;
  }

  function autoSelectBestDefinitionFromGemini(state, analysisData) {
    if (!state) return;
    if (!analysisData || !Array.isArray(state.dictionaryEntries) || state.dictionaryEntries.length === 0) {
      state.geminiMatchedGroupIndex = null;
      state.geminiMatchedItemIndex = null;
      state.geminiMatchedDefIndex = null;
      state.geminiMatchesByGroup = null;
      state.geminiMatchedBase = null;
      state.geminiMatchedSurface = null;
      return;
    }

    let geminiPos = '';
    let geminiBase = '';
    let geminiHanja = '';
    const definitionFragments = [];
    const grammarFragments = [];

    if (typeof analysisData === 'object') {
      if (analysisData.definition) definitionFragments.push(String(analysisData.definition));
      if (analysisData.meaning) definitionFragments.push(String(analysisData.meaning));
      if (analysisData.translation) definitionFragments.push(String(analysisData.translation));
      if (analysisData.grammar || analysisData.grammar_notes) grammarFragments.push(String(analysisData.grammar || analysisData.grammar_notes));

      const wordsAnalysis = Array.isArray(analysisData.words_analysis)
        ? analysisData.words_analysis
        : (Array.isArray(analysisData.words) ? analysisData.words : (Array.isArray(analysisData.analysis) ? analysisData.analysis : null));

      if (Array.isArray(wordsAnalysis) && wordsAnalysis.length > 0) {
        const cleanW = cleanKoreanWord(state.word || '');
        const cleanM = cleanKoreanWord(state.dictionaryMatch || '');
        const rawW = cleanKoreanLemma(state.word || '');
        const targetItem = wordsAnalysis.find((item) => {
          const s = cleanKoreanWord(item.surface || item.word || '');
          const b = cleanKoreanWord(item.base || '');
          const rawS = cleanKoreanLemma(item.surface || item.word || '');
          const rawB = cleanKoreanLemma(item.base || '');
          if (s && (s === cleanW || s === cleanM || cleanW.startsWith(s) || s.startsWith(cleanW))) return true;
          if (b && (b === cleanW || b === cleanM || cleanW.startsWith(b) || b.startsWith(cleanW))) return true;
          if (rawS && (rawS === rawW || rawW.startsWith(rawS) || rawS.startsWith(rawW))) return true;
          if (rawB && (rawB === rawW || rawW.startsWith(rawB) || rawB.startsWith(rawW))) return true;
          return false;
        }) || (wordsAnalysis.length === 1 ? wordsAnalysis[0] : null);

        if (targetItem) {
          if (targetItem.pos) geminiPos = String(targetItem.pos).toLowerCase();
          if (targetItem.base) {
            geminiBase = cleanKoreanLemma(targetItem.base);
            state.geminiMatchedBase = geminiBase;
          }
          if (targetItem.surface || targetItem.word) {
            state.geminiMatchedSurface = cleanKoreanWord(targetItem.surface || targetItem.word);
          }
          if (targetItem.hanja) geminiHanja = String(targetItem.hanja).trim();
          if (Array.isArray(targetItem.definitions)) definitionFragments.push(...targetItem.definitions.map(String));
          if (targetItem.definition) definitionFragments.push(String(targetItem.definition));
          if (targetItem.meaning) definitionFragments.push(String(targetItem.meaning));
          if (targetItem.grammar_notes) grammarFragments.push(String(targetItem.grammar_notes));
          if (targetItem.notes) grammarFragments.push(String(targetItem.notes));

          Object.keys(targetItem).forEach((k) => {
            const kl = k.toLowerCase();
            if (kl.includes('translation') || kl.includes('meaning') || kl.includes('japanese') || kl.includes('gloss')) {
              if (typeof targetItem[k] === 'string') definitionFragments.push(targetItem[k]);
            }
          });
        }
      }
    }

    const extractTokens = (str) => {
      return (String(str || '').toLowerCase().match(/[a-zA-Z0-9\u00C0-\u024F\u3040-\u30ff\u4e00-\u9faf\uac00-\ud7a3]{2,}/g) || []);
    };

    const stopWords = new Set(['to', 'a', 'an', 'the', 'and', 'or', 'of', 'in', 'is', 'attached', 'modify', 'suffix', 'verb', 'noun', 'stem', 'grammatical', 'context', 'ending']);
    const primaryMeaningText = (definitionFragments.length > 0 ? definitionFragments : grammarFragments).join(' ').toLowerCase();
    if (!primaryMeaningText.trim() && !geminiBase) {
      state.geminiMatchedGroupIndex = null;
      state.geminiMatchedItemIndex = null;
      state.geminiMatchedDefIndex = null;
      state.geminiMatchesByGroup = null;
      state.geminiMatchedBase = null;
      state.geminiMatchedSurface = null;
      return;
    }

    const geminiDefTokens = new Set(extractTokens(primaryMeaningText).filter(t => !stopWords.has(t)));
    const hasGeminiDefs = geminiDefTokens.size > 0;

    function tokenMatchesGemini(token) {
      if (!token || stopWords.has(token)) return false;
      if (geminiDefTokens.has(token)) return true;
      if (token.length >= 4) {
        for (const gt of geminiDefTokens) {
          if (gt.length >= 4) {
            if (token.startsWith(gt) || gt.startsWith(token)) return true;
            const stem1 = token.replace(/(?:ing|ed|es|s)$/, '');
            const stem2 = gt.replace(/(?:ing|ed|es|s)$/, '');
            if (stem1.length >= 3 && stem1 === stem2) return true;
          }
        }
      }
      return false;
    }

    const dictGroups = groupEntriesByDictTitle(state.dictionaryEntries);
    if (!Array.isArray(dictGroups) || dictGroups.length === 0) return;

    // Pass 1: Score each dictionary group and find candidate winners
    let primaryMatchedHanja = geminiHanja;
    const groupBestList = [];

    dictGroups.forEach((group, groupIdx) => {
      if (!group || !Array.isArray(group.items)) return;

      let bestScore = -1;
      let bestItemIdx = 0;
      let bestDefIdx = 0;
      let bestTokenScore = 0;
      let bestItem = null;

      group.items.forEach((item, itemIdx) => {
        const itemPos = String(item.pos || '').toLowerCase();
        const itemBase = cleanKoreanWord(item.base || item.surface || item.word || '');
        const rawItemBase = cleanKoreanLemma(item.base || item.surface || item.word || '');
        const rawDefs = Array.isArray(item.definitions) ? item.definitions : [];
        const splitDefs = splitEmbeddedDefinitions(rawDefs);

        // Tier 1: Evaluate definitions within this entry
        let bestItemDefIdx = 0;
        let bestItemDefScore = -1;
        let bestItemTokenCount = 0;

        splitDefs.forEach((defText, defIdx) => {
          const isStub = defText.includes('Conjugation variant:') || defText.includes('->');
          if (isStub) return;

          const tokens = extractTokens(defText);
          let tokenScore = 0;
          tokens.forEach((t) => {
            if (tokenMatchesGemini(t)) {
              tokenScore += t.length >= 4 ? 3 : 2;
            }
          });

          // Stage 2 Neural Multilingual E5 alignment bonus
          const e5DefBonus = (typeof item._bestDefIndex === 'number' && item._bestDefIndex === defIdx) ? 20 : 0;
          const defScore = (tokenScore > 0 ? (tokenScore * 20) : 0) + e5DefBonus;

          if (defScore > bestItemDefScore) {
            bestItemDefScore = defScore;
            bestItemDefIdx = defIdx;
            bestItemTokenCount = tokenScore;
          }
        });

        // Tier 2: Entry-level score (Base match + POS match + Hanja match + E5 confidence)
        const hasDefMatch = bestItemTokenCount > 0;
        let entryScore = 0;
        if (geminiBase) {
          const cleanGeminiBase = cleanKoreanWord(geminiBase);
          const isExactBase = (cleanGeminiBase === itemBase || geminiBase === rawItemBase);
          const isPrefixBase = (!isExactBase && (cleanGeminiBase.startsWith(itemBase) || itemBase.startsWith(cleanGeminiBase) ||
                                geminiBase.startsWith(rawItemBase) || rawItemBase.startsWith(geminiBase)));
          if (isExactBase) {
            entryScore += (!hasGeminiDefs || hasDefMatch) ? 80 : 10;
          } else if (isPrefixBase) {
            entryScore += (!hasGeminiDefs || hasDefMatch) ? 40 : 5;
          }
        }
        if (geminiPos && itemPos) {
          if (itemPos.includes(geminiPos) || geminiPos.includes(itemPos)) {
            entryScore += (!hasGeminiDefs || hasDefMatch) ? 30 : 5;
          }
        }
        if (geminiHanja && item.hanja) {
          const h = String(item.hanja).trim();
          if (h === geminiHanja || geminiHanja.includes(h) || h.includes(geminiHanja)) {
            entryScore += 60;
          }
        }
        const e5ConfBonus = item._confidenceScore ? (parseInt(item._confidenceScore, 10) / 4) : 0;
        entryScore += e5ConfBonus;

        const totalCardScore = entryScore + (bestItemDefScore > 0 ? bestItemDefScore : 0);
        if (totalCardScore > bestScore) {
          bestScore = totalCardScore;
          bestItemIdx = itemIdx;
          bestDefIdx = bestItemDefIdx;
          bestTokenScore = bestItemTokenCount;
          bestItem = item;
        }
      });

      groupBestList.push({
        groupIdx,
        bestItemIdx,
        bestDefIdx,
        bestScore,
        tokenScore: bestTokenScore,
        bestItem
      });
    });

    // If any group had strong token matches (e.g. English group), inherit its Hanja to anchor CJK dictionaries
    const strongGroup = groupBestList.find(g => (g.tokenScore >= 2 || (g.bestItem && (g.bestItem.dictTargetLanguage === 'en' || g.bestItem.dictTargetLanguage === 'eng') && g.bestScore >= 40)) && g.bestItem && g.bestItem.hanja);
    if (strongGroup && !primaryMatchedHanja) {
      primaryMatchedHanja = String(strongGroup.bestItem.hanja).trim();
    }

    const analysisLang = getLlmResponseLanguage(analysisData);
    state.currentAnalysisLanguage = analysisLang;

    // Pass 2: Re-evaluate secondary groups (especially non-English like Japanese) with Hanja anchor
    state.geminiMatchesByGroup = {};
    let overallBestScore = -1;
    let overallBestGroupIdx = (state && typeof state.selectedGroupIndex === 'number') ? state.selectedGroupIndex : 0;
    let overallBestItemIdx = 0;
    let overallBestDefIdx = 0;
    let overallMatched = false;

    groupBestList.forEach((g) => {
      const group = dictGroups[g.groupIdx];
      if (!group || !Array.isArray(group.items)) return;

      const groupLang = getDictionaryLanguage(group);
      const isLangMatch = (groupLang.toLowerCase() === analysisLang.toLowerCase());

      if (!isLangMatch) {
        state.geminiMatchesByGroup[g.groupIdx] = {
          itemIndex: g.bestItemIdx,
          defIndex: g.bestDefIdx,
          score: 0,
          matched: false
        };
        return;
      }

      let groupBestScore = g.bestScore;
      let groupBestItemIdx = g.bestItemIdx;
      let groupBestDefIdx = g.bestDefIdx;
      let groupMatched = false;

      if (primaryMatchedHanja && group.items.length > 1) {
        // Look for Hanja alignment across homonyms in this group
        group.items.forEach((item, itemIdx) => {
          const itemHanja = String(item.hanja || '').trim();
          if (itemHanja && (itemHanja === primaryMatchedHanja || primaryMatchedHanja.includes(itemHanja) || itemHanja.includes(primaryMatchedHanja))) {
            const rawDefs = Array.isArray(item.definitions) ? item.definitions : [];
            const splitDefs = splitEmbeddedDefinitions(rawDefs);
            const targetDefIdx = (typeof item._bestDefIndex === 'number' && item._bestDefIndex < splitDefs.length) ? item._bestDefIndex : 0;
            const hanjaScore = 60 + (item._confidenceScore ? (parseInt(item._confidenceScore, 10) / 4) : 0);
            if (hanjaScore > groupBestScore || g.tokenScore === 0) {
              groupBestScore = hanjaScore;
              groupBestItemIdx = itemIdx;
              groupBestDefIdx = targetDefIdx;
              groupMatched = true;
            }
          }
        });
      } else if (g.tokenScore === 0 && group.items.length > 1) {
        // If no Hanja match, check if Multilingual E5 identified a clear winning homonym
        let highestConf = -1;
        let highestConfIdx = -1;
        group.items.forEach((item, itemIdx) => {
          const conf = parseInt(item._confidenceScore || '0', 10);
          if (conf > highestConf) {
            highestConf = conf;
            highestConfIdx = itemIdx;
          }
        });
        if (highestConf >= 75 && highestConfIdx >= 0) {
          groupBestItemIdx = highestConfIdx;
          const targetItem = group.items[highestConfIdx];
          const rawDefs = Array.isArray(targetItem.definitions) ? targetItem.definitions : [];
          const splitDefs = splitEmbeddedDefinitions(rawDefs);
          groupBestDefIdx = (typeof targetItem._bestDefIndex === 'number' && targetItem._bestDefIndex < splitDefs.length) ? targetItem._bestDefIndex : 0;
          groupMatched = true;
        }
      }

      if (!groupMatched) {
        if (hasGeminiDefs) {
          // Strict requirement: Definition token must match when LLM provided explicit definitions/meanings
          groupMatched = (g.tokenScore > 0);
        } else {
          // Fallback when LLM only provided base/POS without definition text
          groupMatched = (g.bestScore >= 40) || (group.items.length === 1);
        }
      }

      state.geminiMatchesByGroup[g.groupIdx] = {
        itemIndex: groupBestItemIdx,
        defIndex: groupBestDefIdx,
        score: groupBestScore,
        matched: groupMatched
      };

      if (isLangMatch && groupMatched && groupBestScore > overallBestScore) {
        overallBestScore = groupBestScore;
        overallBestGroupIdx = g.groupIdx;
        overallBestItemIdx = groupBestItemIdx;
        overallBestDefIdx = groupBestDefIdx;
        overallMatched = true;
      }
    });

    if (overallBestScore >= 0 && overallMatched) {
      state.geminiMatchedGroupIndex = overallBestGroupIdx;
      state.geminiMatchedItemIndex = overallBestItemIdx;
      state.geminiMatchedDefIndex = overallBestDefIdx;

      if (!state.userSelectedDef) {
        state[`selectedDefIndex_${overallBestItemIdx}`] = overallBestDefIdx;
        state.selectedDefinitionIndex = overallBestDefIdx;
      }
    } else {
      state.geminiMatchedGroupIndex = null;
      state.geminiMatchedItemIndex = null;
      state.geminiMatchedDefIndex = null;
    }
  }

  function cleanKoreanLemma(lemma) {
    if (!lemma) return '';
    let str = String(lemma).normalize().trim();
    // Strip parenthesized annotations: e.g. "부르다 (to call, to name)" -> "부르다", "가다[verb]" -> "가다"
    str = str.replace(/\s*[\(\[（【][^\)\]）】]*[\)\]）】]/g, '').trim();
    // Strip trailing glosses or explanations: e.g. "부르다: to call", "부르다 - to name", "부르다 / to call"
    str = str.replace(/\s*[:\-–—/].*$/, '').trim();
    // If it starts with Korean followed by Latin/English characters: e.g. "부르다 to call"
    const koreanMatch = str.match(/^[\uac00-\ud7a3\u1100-\u11ff\u3130-\u318f]+/);
    if (koreanMatch && /[a-zA-Z]/.test(str)) {
      str = koreanMatch[0];
    }
    return str.trim();
  }

  function cleanKoreanWord(word) {
    const cleaned = cleanKoreanLemma(word);
    if (!cleaned) return '';
    // Verb and adjective citation forms ending in -다 (length >= 2) shouldn't strip trailing syllable
    if (cleaned.endsWith('다') && cleaned.length >= 2) {
      return cleaned;
    }
    return cleaned.replace(/(이나마|에게서|에서는|이라도|이든지|만큼|대로|같이|처럼|밖에|이나|이란|이라|이야|까지|부터|보다|마다|조차|커녕|에서|에게|은|는|이|가|을|를|의|에|와|과|도|만|으로|로)$/, '') || cleaned;
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
    getGeminiAnalysisForState,
    autoSelectBestDefinitionFromGemini,
    extractCustomFields,
    renderAnalysisSection,
    cleanKoreanLemma,
    cleanKoreanWord,
    truncateText,
    escapeHtml,
    escapeHtmlPreservingMarkup,
    stripHtml,
    decodeHtmlEntities,
    getDictionaryLanguage,
    getLlmResponseLanguage,
    renderActions,
    renderDictionaryEntriesGrouped,
    findCompoundPair
  };

  const targetGlobal = typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : global);
  targetGlobal.MunmekUI = MunmekUI;
})(typeof globalThis !== 'undefined' ? globalThis : this);
