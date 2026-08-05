/**
 * Munmek Content Script
 * Handles hover detection, DOM text range scanning, sentence context extraction, and background messaging.
 */
(function () {
  'use strict';

  const HIDE_DELAY_MS = 450;
  const sentenceAnalysisCache = new Map();
  const pendingAnalysisRequests = new Map();
  const pendingQuickFallbacks = new Map();

  let hideTimer = null;
  let currentHoverState = null;
  let lastHoverSignature = '';
  let lastTooltipPosition = { x: 0, y: 0 };
  let isMouseOverTooltip = false;
  let currentModifierKey = 'Shift';
  let currentSelectedDictionaryId = 'all';
  let currentTooltipFontSize = 15;

  function init() {
    attachHoverListeners(document);
    observeShadowRoots();

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['modifierKey', 'selectedDictionaryId', 'tooltipFontSize'], (res) => {
        if (res.modifierKey !== undefined) currentModifierKey = res.modifierKey;
        if (res.selectedDictionaryId) currentSelectedDictionaryId = res.selectedDictionaryId;
        if (res.tooltipFontSize) currentTooltipFontSize = Number(res.tooltipFontSize) || 15;
      });

      if (chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
          if (areaName === 'local') {
            if (changes.modifierKey) currentModifierKey = changes.modifierKey.newValue || 'Shift';
            if (changes.selectedDictionaryId) currentSelectedDictionaryId = changes.selectedDictionaryId.newValue || 'all';
            if (changes.tooltipFontSize) {
              currentTooltipFontSize = Number(changes.tooltipFontSize.newValue) || 15;
              if (currentHoverState) {
                currentHoverState.tooltipFontSize = currentTooltipFontSize;
                rerenderCurrentTooltip();
              }
            }
          }
        });
      }
    }

    window.addEventListener('keydown', handleGlobalKeyDown);
    window.addEventListener('keyup', handleGlobalKeyUp);

    window.addEventListener('munmekWasmAnalysisReady', (e) => {
      if (currentHoverState && e.detail && e.detail.surfaceText === currentHoverState.word) {
        currentHoverState = buildHoverState(
          {
            word: currentHoverState.word,
            sentence: currentHoverState.sentence,
            prevSentence: currentHoverState.prevSentence,
            nextSentence: currentHoverState.nextSentence
          },
          lastTooltipPosition.x,
          lastTooltipPosition.y
        );
        rerenderCurrentTooltip();
      }
    });
  }

  function isModifierPressed(event) {
    if (!currentModifierKey || currentModifierKey === 'None') return true;
    if (!event) return false;
    if (currentModifierKey === 'Shift') return Boolean(event.shiftKey);
    if (currentModifierKey === 'Alt') return Boolean(event.altKey);
    if (currentModifierKey === 'Control') return Boolean(event.ctrlKey);
    if (currentModifierKey === 'Meta') return Boolean(event.metaKey);
    return false;
  }

  function handleGlobalKeyDown(event) {
    if (isKeyMatch(event.key) && lastMouseEvent && !isMouseOverTooltip) {
      processMouseMove(lastMouseEvent);
    }
  }

  function handleGlobalKeyUp(event) {
    if (isKeyMatch(event.key) && !isMouseOverTooltip) {
      scheduleHideTooltip();
    }
  }

  function isKeyMatch(key) {
    if (currentModifierKey === 'Shift' && key === 'Shift') return true;
    if (currentModifierKey === 'Alt' && key === 'Alt') return true;
    if (currentModifierKey === 'Control' && key === 'Control') return true;
    if (currentModifierKey === 'Meta' && key === 'Meta') return true;
    return false;
  }

  function attachHoverListeners(root) {
    if (!root || root._munmekHoverAttached) return;
    root.addEventListener('mousemove', handleMouseMove);
    root._munmekHoverAttached = true;
  }

  function observeShadowRoots() {
    scanForShadowRoots();
    const observer = new MutationObserver(scanForShadowRoots);
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  function scanForShadowRoots() {
    document.querySelectorAll('*').forEach((el) => {
      if (el.shadowRoot) attachHoverListeners(el.shadowRoot);
    });
  }

  let mouseMoveScheduled = false;
  let lastMouseEvent = null;

  function handleMouseMove(event) {
    lastMouseEvent = event;
    if (isMouseOverTooltip) return;

    if (!isModifierPressed(event)) {
      scheduleHideTooltip();
      return;
    }

    if (!mouseMoveScheduled) {
      mouseMoveScheduled = true;
      requestAnimationFrame(() => {
        mouseMoveScheduled = false;
        if (lastMouseEvent) processMouseMove(lastMouseEvent);
      });
    }
  }

  function processMouseMove(event) {
    if (isMouseOverTooltip) return;

    const range = getRangeFromPoint(event.view?.document || document, event.clientX, event.clientY);
    const hoverContext = extractHoverContext(range);

    if (!hoverContext) {
      scheduleHideTooltip();
      return;
    }

    const hoverState = buildHoverState(hoverContext, event.clientX, event.clientY);
    const signature = `${hoverState.word}|${hoverState.sentenceKey}`;

    if (signature === lastHoverSignature) {
      cancelHideTooltip();
      lastTooltipPosition = { x: event.clientX, y: event.clientY };
      if (window.MunmekUI) window.MunmekUI.positionTooltip(event.clientX, event.clientY, currentTooltipFontSize);
      currentHoverState = hoverState;
      triggerIndexedDbLookup(hoverState);
      return;
    }

    cancelHideTooltip();
    lastHoverSignature = signature;
    currentHoverState = hoverState;
    lastTooltipPosition = { x: event.clientX, y: event.clientY };

    rerenderCurrentTooltip();
    triggerIndexedDbLookup(hoverState);
    triggerProgressiveReranking(hoverState);
  }

  function getRangeFromPoint(doc, x, y) {
    try {
      if (doc.caretRangeFromPoint) return doc.caretRangeFromPoint(x, y);
      if (doc.caretPositionFromPoint) {
        const pos = doc.caretPositionFromPoint(x, y);
        if (pos && pos.offsetNode) {
          const range = doc.createRange();
          range.setStart(pos.offsetNode, pos.offset);
          range.setEnd(pos.offsetNode, pos.offset);
          return range;
        }
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  function extractHoverContext(range) {
    if (!range) return null;
    const node = range.startContainer;
    if (!node || node.nodeType !== Node.TEXT_NODE) return null;

    const textContent = node.textContent || '';
    if (!textContent.trim()) return null;

    const offset = Math.min(range.startOffset || 0, textContent.length);
    const wordChar = /[\p{L}\p{N}\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/u;

    let start = offset;
    while (start > 0 && wordChar.test(textContent[start - 1])) start--;

    let end = offset;
    while (end < textContent.length && wordChar.test(textContent[end])) end++;

    const word = textContent.slice(start, end).trim();
    if (!word) return null;

    let containerEl = node.parentElement;
    let asbplayerContainer = null;
    const blockTags = new Set(['P', 'DIV', 'LI', 'SECTION', 'ARTICLE', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'MAIN']);

    while (containerEl && containerEl !== document.body) {
      if (containerEl.classList && Array.from(containerEl.classList).some((cls) => cls.includes('asbplayer-subtitles') || cls.includes('asbplayer-subtitle'))) {
        asbplayerContainer = containerEl;
        break;
      }
      if (blockTags.has(containerEl.tagName)) break;
      containerEl = containerEl.parentElement;
    }

    const paragraphText = normalizeText((asbplayerContainer || containerEl || node.parentElement)?.textContent || textContent);
    let sentenceWindow = getSentenceWindow(paragraphText, word);

    if (window._munmekTabContextText) {
      const tabWindow = getSentenceWindow(window._munmekTabContextText, word);
      if (tabWindow && tabWindow.currentSentence && tabWindow.currentSentence !== word) {
        sentenceWindow = {
          currentSentence: sentenceWindow.currentSentence || tabWindow.currentSentence,
          prevSentence: tabWindow.prevSentence || sentenceWindow.prevSentence,
          nextSentence: tabWindow.nextSentence || sentenceWindow.nextSentence
        };
      }
    }

    return {
      word,
      sentence: sentenceWindow.currentSentence,
      prevSentence: sentenceWindow.prevSentence,
      nextSentence: sentenceWindow.nextSentence,
      paragraphText,
      isAsbplayerSubtitle: Boolean(asbplayerContainer)
    };
  }

  function getSentenceWindow(text, sentenceFragment) {
    const normalized = normalizeText(text);
    if (!normalized) return { currentSentence: sentenceFragment, prevSentence: '', nextSentence: '' };

    const sentences = normalized.split(/(?<=[.!?。？！])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
    if (sentences.length === 0) return { currentSentence: normalized, prevSentence: '', nextSentence: '' };

    const fragment = normalizeText(sentenceFragment);
    let index = sentences.findIndex((candidate) => candidate.includes(fragment) || fragment.includes(candidate));
    if (index === -1) {
      const containingLine = sentences.find((candidate) => candidate.includes(fragment)) || sentences[0];
      index = sentences.indexOf(containingLine);
    }

    return {
      currentSentence: sentences[index] || normalized,
      prevSentence: index > 0 ? sentences[index - 1] : '',
      nextSentence: index >= 0 && index < sentences.length - 1 ? sentences[index + 1] : ''
    };
  }

  function buildHoverState(context, x, y) {
    const word = normalizeText(context.word);
    const sentence = normalizeText(context.sentence);
    const candidateList = generateCandidates(word, sentence);

    return {
      word,
      sentence,
      sentenceKey: normalizeText(sentence || word),
      prevSentence: normalizeText(context.prevSentence),
      nextSentence: normalizeText(context.nextSentence),
      dictionaryEntry: null,
      dictionaryMatch: '',
      candidateList,
      lookupReason: 'Looking up in IndexedDB...',
      x,
      y,
      tooltipFontSize: currentTooltipFontSize,
      feedback: '',
      feedbackType: 'info'
    };
  }

  function generateCandidates(surface, sentenceContext = '') {
    if (typeof window !== 'undefined' && window.KoreanPipeline) {
      const results = window.KoreanPipeline.analyzeKoreanWord(surface, sentenceContext);
      if (results && results.length > 0) return results;
    }
    return [{ text: normalizeText(surface), reason: 'surface form', score: 100 }];
  }

  async function triggerIndexedDbLookup(state) {
    if (!state || !state.word) return;

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      try {
        const candidates = state.candidateList || generateCandidates(state.word, state.sentence);
        for (const candidate of candidates) {
          let res = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
              type: 'dictionaryLookup',
              method: 'lookupSurface',
              text: candidate.text,
              dictId: currentSelectedDictionaryId
            }, resolve);
          });

          if (res && res.hits && res.hits.length > 0) {
            if (currentHoverState && currentHoverState.word === state.word) {
              const sortedHits = sortHitsByBaseForm(res.hits);
              currentHoverState.dictionaryEntries = sortedHits;
              currentHoverState.dictionaryEntry = sortedHits[0];
              currentHoverState.dictionaryMatch = candidate.text;
              currentHoverState.selectedGroupIndex = 0;
              currentHoverState.lookupReason = `IndexedDB Surface Match (${sortedHits[0].dictTitle || 'Local'})`;
              rerenderCurrentTooltip();
            }
            return;
          }

          res = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
              type: 'dictionaryLookup',
              method: 'lookupBase',
              text: candidate.text,
              dictId: currentSelectedDictionaryId
            }, resolve);
          });

          if (res && res.hits && res.hits.length > 0) {
            if (currentHoverState && currentHoverState.word === state.word) {
              const sortedHits = sortHitsByBaseForm(res.hits);
              currentHoverState.dictionaryEntries = sortedHits;
              currentHoverState.dictionaryEntry = sortedHits[0];
              currentHoverState.dictionaryMatch = candidate.text;
              currentHoverState.selectedGroupIndex = 0;
              currentHoverState.lookupReason = `IndexedDB Base Match (${sortedHits[0].dictTitle || 'Local'})`;
              rerenderCurrentTooltip();
            }
            return;
          }
        }

        if (currentHoverState && currentHoverState.word === state.word && (!currentHoverState.dictionaryEntries || currentHoverState.dictionaryEntries.length === 0)) {
          currentHoverState.lookupReason = 'No offline dictionary match found. Click a candidate chip above for Quick LLM Lookup.';
        }
      } catch (err) {
        console.warn('[Munmek] IndexedDB lookup notice:', err);
      }
    }
  }

  function triggerProgressiveReranking(state) {
    if (!state || !state.candidateList || state.candidateList.length <= 1 || !state.sentence) return;

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage(
        {
          type: 'rerankKoreanCandidates',
          candidates: state.candidateList,
          sentenceContext: state.sentence
        },
        (response) => {
          if (response && response.ok && Array.isArray(response.candidates) && response.candidates.length > 0 && !response.disabled) {
            if (currentHoverState && currentHoverState.word === state.word) {
              currentHoverState.candidateList = response.candidates;
              rerenderCurrentTooltip();
            }
          }
        }
      );
    }
  }

  function sortHitsByBaseForm(hits) {
    if (!Array.isArray(hits) || hits.length <= 1) return hits;
    return [...hits].sort((a, b) => {
      const isBaseA = (a.surface || a.base || '').endsWith('다');
      const isBaseB = (b.surface || b.base || '').endsWith('다');
      if (isBaseA && !isBaseB) return -1;
      if (!isBaseA && isBaseB) return 1;
      return 0;
    });
  }

  function handleTooltipClick(event) {
    const target = event.target;
    if (!(target instanceof Element) || !currentHoverState) return;

    const selectedCandidate = target.getAttribute('data-candidate');
    if (selectedCandidate) {
      currentHoverState.dictionaryMatch = selectedCandidate;
      currentHoverState.word = selectedCandidate;
      currentHoverState.selectedDefinitionIndex = 0;
      currentHoverState.selectedGroupIndex = 0;

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'dictionaryLookup',
          method: 'lookupSurface',
          text: selectedCandidate,
          dictId: currentSelectedDictionaryId
        }, (res) => {
          if (res && res.hits && res.hits.length > 0 && currentHoverState) {
            currentHoverState.dictionaryEntries = res.hits;
            currentHoverState.dictionaryEntry = res.hits[0];
            currentHoverState.lookupReason = `Selected Candidate (${res.hits[0].dictTitle || 'Local'})`;
            rerenderCurrentTooltip();
          } else {
            chrome.runtime.sendMessage({
              type: 'dictionaryLookup',
              method: 'lookupBase',
              text: selectedCandidate,
              dictId: currentSelectedDictionaryId
            }, (resBase) => {
              if (resBase && resBase.hits && resBase.hits.length > 0 && currentHoverState) {
                currentHoverState.dictionaryEntries = resBase.hits;
                currentHoverState.dictionaryEntry = resBase.hits[0];
                currentHoverState.lookupReason = `Selected Candidate (${resBase.hits[0].dictTitle || 'Local'})`;
                rerenderCurrentTooltip();
              } else if (currentHoverState) {
                currentHoverState.dictionaryEntries = [];
                currentHoverState.dictionaryEntry = null;
                currentHoverState.lookupReason = `Selected candidate "${selectedCandidate}" (Running Quick LLM Lookup...)`;
                rerenderCurrentTooltip();
                triggerQuickGeminiFallback(currentHoverState);
              }
            });
          }
        });
      }
      return;
    }

    const action = target.getAttribute('data-action');
    if (!action) return;

    if (action === 'select-dict-group-tab') {
      const idx = parseInt(target.getAttribute('data-group-index'), 10);
      currentHoverState.selectedGroupIndex = idx;
      const dictGroups = window.MunmekUI ? window.MunmekUI.groupEntriesByDictTitle(currentHoverState.dictionaryEntries || []) : [];
      if (dictGroups[idx] && dictGroups[idx].items[0]) {
        currentHoverState.dictionaryEntry = dictGroups[idx].items[0];
      }
      rerenderCurrentTooltip();
      return;
    }

    if (action === 'select-def-tab') {
      const idxStr = target.getAttribute('data-def-index');
      const itemIdxStr = target.getAttribute('data-item-index') || '0';
      if (idxStr !== null) {
        const itemIdx = Number(itemIdxStr);
        const defIdx = Number(idxStr);
        currentHoverState[`selectedDefIndex_${itemIdx}`] = defIdx;

        const dictGroups = window.MunmekUI ? window.MunmekUI.groupEntriesByDictTitle(currentHoverState.dictionaryEntries || []) : [];
        const selectedGroupIdx = currentHoverState.selectedGroupIndex || 0;
        const activeGroup = dictGroups[selectedGroupIdx];
        if (activeGroup && activeGroup.items[itemIdx]) {
          currentHoverState.dictionaryEntry = activeGroup.items[itemIdx];
          currentHoverState.selectedDefinitionIndex = defIdx;
        }
        rerenderCurrentTooltip();
      }
      return;
    }

    if (action === 'analyze') {
      requestSentenceAnalysis(currentHoverState);
    }

    if (action === 'anki' || action === 'anki-dict') {
      const definitions = currentHoverState.dictionaryEntry?.definitions || [];
      const idx = currentHoverState.selectedDefinitionIndex || 0;
      const rawDefs = Array.isArray(definitions) ? definitions : [];
      const splitDefs = window.MunmekUI ? window.MunmekUI.splitEmbeddedDefinitions(rawDefs) : rawDefs;
      const selectedDef = splitDefs[idx] || (rawDefs[idx] || null);
      sendCardToAnki(currentHoverState, selectedDef, 'dict');
    }

    if (action === 'anki-llm') {
      const cachedAnalysis = sentenceAnalysisCache.get(currentHoverState.sentenceKey);
      if (cachedAnalysis || currentHoverState.quickFallback) {
        sendCardToAnki(currentHoverState, null, 'llm');
      } else {
        currentHoverState.feedback = 'Fetching Gemini LLM analysis for Anki card...';
        currentHoverState.feedbackType = 'info';
        rerenderCurrentTooltip();
        requestSentenceAnalysis(currentHoverState, () => {
          sendCardToAnki(currentHoverState, null, 'llm');
        });
      }
    }

    if (action === 'anki-def') {
      const defIndexStr = target.getAttribute('data-def-index');
      const itemIdxStr = target.getAttribute('data-item-index') || '0';
      const itemIdx = Number(itemIdxStr);
      const defIndex = defIndexStr !== null ? Number(defIndexStr) : 0;

      const dictGroups = window.MunmekUI ? window.MunmekUI.groupEntriesByDictTitle(currentHoverState.dictionaryEntries || []) : [];
      const selectedGroupIdx = currentHoverState.selectedGroupIndex || 0;
      const activeGroup = dictGroups[selectedGroupIdx];
      const targetEntry = (activeGroup && activeGroup.items[itemIdx]) || currentHoverState.dictionaryEntry;

      const rawDefs = Array.isArray(targetEntry?.definitions) ? targetEntry.definitions : [];
      const splitDefs = window.MunmekUI ? window.MunmekUI.splitEmbeddedDefinitions(rawDefs) : rawDefs;
      const selectedDef = splitDefs[defIndex] || (rawDefs[defIndex] || null);

      currentHoverState.dictionaryEntry = targetEntry;
      sendCardToAnki(currentHoverState, selectedDef, 'dict');
    }
  }

  function triggerQuickGeminiFallback(state) {
    if (!state || !state.word || pendingQuickFallbacks.has(state.word)) return;
    const bestCandidate = (state.candidateList && state.candidateList[0]) ? state.candidateList[0].text : state.word;
    pendingQuickFallbacks.set(state.word, true);

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage(
        {
          type: 'quickGeminiFallback',
          data: { word: bestCandidate, sentence: state.sentence }
        },
        (res) => {
          pendingQuickFallbacks.delete(state.word);
          if (res && res.data && currentHoverState && currentHoverState.word === state.word) {
            currentHoverState.quickFallback = res.data;
            rerenderCurrentTooltip();
          }
        }
      );
    }
  }

  function requestSentenceAnalysis(state, onSuccess = null) {
    if (sentenceAnalysisCache.has(state.sentenceKey) && !pendingAnalysisRequests.has(state.sentenceKey)) {
      const cached = sentenceAnalysisCache.get(state.sentenceKey);
      autoSelectBestDefinitionFromGemini(state, cached);
      currentHoverState.feedback = 'Using cached Gemini analysis for this sentence.';
      currentHoverState.feedbackType = 'info';
      rerenderCurrentTooltip();
      if (typeof onSuccess === 'function') onSuccess();
      return;
    }

    if (pendingAnalysisRequests.has(state.sentenceKey)) {
      currentHoverState.feedback = 'Gemini analysis is already in progress.';
      currentHoverState.feedbackType = 'info';
      rerenderCurrentTooltip();
      return;
    }

    currentHoverState.feedback = 'Loading Gemini analysis...';
    currentHoverState.feedbackType = 'info';
    rerenderCurrentTooltip();

    pendingAnalysisRequests.set(state.sentenceKey, true);

    chrome.runtime.sendMessage(
      {
        type: 'analyzeSentence',
        data: {
          word: state.word,
          sentence: state.sentence,
          prevSentence: state.prevSentence,
          nextSentence: state.nextSentence,
          dictionaryEntry: state.dictionaryEntry,
          candidate: state.dictionaryMatch
        }
      },
      (response) => {
        pendingAnalysisRequests.delete(state.sentenceKey);

        if (chrome.runtime.lastError || !response || response.error) {
          currentHoverState.feedback = response?.error || chrome.runtime.lastError?.message || 'Gemini request failed.';
          currentHoverState.feedbackType = 'error';
          rerenderCurrentTooltip();
          return;
        }

        sentenceAnalysisCache.set(state.sentenceKey, response.data);
        autoSelectBestDefinitionFromGemini(state, response.data);
        currentHoverState.feedback = 'Gemini analysis ready.';
        currentHoverState.feedbackType = 'info';
        rerenderCurrentTooltip();
        if (typeof onSuccess === 'function') onSuccess();
      }
    );
  }

  function autoSelectBestDefinitionFromGemini(state, analysisData) {
    if (window.MunmekUI && typeof window.MunmekUI.autoSelectBestDefinitionFromGemini === 'function') {
      window.MunmekUI.autoSelectBestDefinitionFromGemini(state, analysisData);
    }
  }

  function sendCardToAnki(state, selectedDefinition = null, mode = 'dict') {
    const cachedAnalysis = sentenceAnalysisCache.get(state.sentenceKey) || null;

    currentHoverState.feedback = 'Sending card to Anki...';
    currentHoverState.feedbackType = 'info';
    rerenderCurrentTooltip();

    chrome.runtime.sendMessage(
      {
        type: 'createAnkiCard',
        data: {
          word: state.word,
          sentence: state.sentence,
          prevSentence: state.prevSentence,
          nextSentence: state.nextSentence,
          dictionaryEntry: mode === 'llm' ? {} : state.dictionaryEntry,
          candidate: state.dictionaryMatch,
          analysis: cachedAnalysis,
          quickFallback: state.quickFallback || null,
          selectedDefinition: mode === 'llm' ? null : selectedDefinition
        }
      },
      (response) => {
        if (chrome.runtime.lastError || !response || response.error) {
          currentHoverState.feedback = response?.error || chrome.runtime.lastError?.message || 'AnkiConnect request failed.';
          currentHoverState.feedbackType = 'error';
          rerenderCurrentTooltip();
          return;
        }

        currentHoverState.feedback = response.data?.updated ? 'Updated the last Anki card.' : 'Created a new Anki card.';
        currentHoverState.feedbackType = 'info';
        rerenderCurrentTooltip();
      }
    );
  }

  function rerenderCurrentTooltip() {
    if (currentHoverState && window.MunmekUI) {
      window.MunmekUI.renderTooltip(
        currentHoverState,
        sentenceAnalysisCache,
        () => { isMouseOverTooltip = true; cancelHideTooltip(); },
        () => { isMouseOverTooltip = false; scheduleHideTooltip(); },
        handleTooltipClick
      );
    }
  }

  function scheduleHideTooltip() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (window.MunmekUI) window.MunmekUI.hideTooltip();
    }, HIDE_DELAY_MS);
  }

  function cancelHideTooltip() {
    clearTimeout(hideTimer);
  }

  function normalizeText(value) {
    return String(value || '').normalize().replace(/\s+/g, ' ').trim();
  }

  // Active tab context extractor messaging
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.type === 'extractPageContext') {
        const parts = [];
        const subtitleElements = document.querySelectorAll('.asbplayer-subtitle, [class*="subtitle"], [id*="subtitle"], track');
        subtitleElements.forEach((el) => {
          const t = (el.textContent || '').trim();
          if (t && !parts.includes(t)) parts.push(t);
        });

        const contentArea = document.querySelector('#bodyContent, article, main') || document.body;
        const paragraphs = contentArea.querySelectorAll('p, h1, h2, h3');
        paragraphs.forEach((p) => {
          const t = (p.textContent || '').trim();
          if (t && t.length > 15 && !parts.includes(t)) parts.push(t);
        });

        sendResponse({ text: parts.join('\n\n').slice(0, 20000), name: document.title || 'Webpage Content' });
        return true;
      }
    });
  }

  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  }
})();
