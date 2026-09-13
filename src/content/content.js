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
  const quickLlmLookupCache = new Map();

  function boundedMapSet(map, key, value, maxSize = 300) {
    if (map.size >= maxSize) {
      const firstKey = map.keys().next().value;
      map.delete(firstKey);
    }
    map.set(key, value);
  }

  let hideTimer = null;
  let currentHoverState = null;
  let lastHoverSignature = '';
  let lastTooltipPosition = { x: 0, y: 0 };
  let isMouseOverTooltip = false;
  let currentModifierKey = 'Shift';
  let currentSelectedDictionaryId = 'all';
  let currentTooltipFontSize = 15;
  let enableStage2Reranker = true;
  let autoTriggerAiOnHover = false;
  let autoAiDebounceTimer = null;
  const subtitleHistoryBuffer = [];
  let _asbObserver = null;
  let _asbContainerEl = null;
  let _asbScanInterval = null;

  function recordSubtitleLine(text) {
    const cleaned = normalizeText(text);
    if (!cleaned || cleaned.length < 2 || cleaned.length > 200) return;
    if (subtitleHistoryBuffer.length === 0 || subtitleHistoryBuffer[subtitleHistoryBuffer.length - 1] !== cleaned) {
      subtitleHistoryBuffer.push(cleaned);
      if (subtitleHistoryBuffer.length > 500) subtitleHistoryBuffer.shift();
    }
  }

  let _asbScanAttempts = 0;
  const MAX_ASB_SCAN_ATTEMPTS = 30;

  function findAndObserveAsbPlayer() {
    // Already observing a live container
    if (_asbContainerEl && document.contains(_asbContainerEl)) return;

    const container = document.querySelector('[class*="asbplayer-subtitles-container"]');
    if (!container) {
      _asbScanAttempts++;
      if (_asbScanAttempts >= MAX_ASB_SCAN_ATTEMPTS && _asbScanInterval) {
        clearInterval(_asbScanInterval);
        _asbScanInterval = null;
      }
      return;
    }

    _asbScanAttempts = 0;
    // Clean up previous observer
    if (_asbObserver) { _asbObserver.disconnect(); _asbObserver = null; }

    _asbContainerEl = container;

    let debounceTimer = null;
    _asbObserver = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        // Record only innermost .asbplayer-subtitle cue text (not parent containers)
        const cues = container.querySelectorAll('[class*="asbplayer-subtitle"]:not([class*="asbplayer-subtitles-container"])');
        cues.forEach((cue) => {
          // Skip containers that have subtitle children — only record leaf cues
          if (cue.querySelector('[class*="asbplayer-subtitle"]')) return;
          recordSubtitleLine(cue.textContent);
        });
      }, 80);
    });

    _asbObserver.observe(container, { childList: true, subtree: true, characterData: true });

    // Stop scanning once we've found the container
    if (_asbScanInterval) { clearInterval(_asbScanInterval); _asbScanInterval = null; }
  }

  let extensionEnabled = false;

  function init() {
    attachHoverListeners(document);
    observeShadowRoots();

    // Lazily discover ASBPlayer container (it's injected dynamically when playback starts)
    findAndObserveAsbPlayer();

    _asbScanInterval = setInterval(findAndObserveAsbPlayer, 3000);

    // Query per-tab session status from background service worker
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'getTabSessionStatus' }, (res) => {
        if (res && typeof res.isActive === 'boolean') {
          extensionEnabled = res.isActive;
        }
      });
    }

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['modifierKey', 'selectedDictionaryId', 'tooltipFontSize', 'enableOnnxReranker', 'autoTriggerAiOnHover'], (res) => {
        if (res.modifierKey !== undefined) currentModifierKey = res.modifierKey;
        if (res.selectedDictionaryId) currentSelectedDictionaryId = res.selectedDictionaryId;
        if (res.tooltipFontSize) currentTooltipFontSize = Number(res.tooltipFontSize) || 15;
        if (res.enableOnnxReranker !== undefined) enableStage2Reranker = Boolean(res.enableOnnxReranker);
        if (res.autoTriggerAiOnHover !== undefined) autoTriggerAiOnHover = Boolean(res.autoTriggerAiOnHover);
      });

      if (chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
          if (areaName === 'local') {
            if (changes.enableOnnxReranker !== undefined) {
              enableStage2Reranker = Boolean(changes.enableOnnxReranker.newValue);
            }
            if (changes.autoTriggerAiOnHover !== undefined) {
              autoTriggerAiOnHover = Boolean(changes.autoTriggerAiOnHover.newValue);
            }
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
            prevSentence2: currentHoverState.prevSentence2
          },
          lastTooltipPosition.x,
          lastTooltipPosition.y
        );
        rerenderCurrentTooltip();
        triggerIndexedDbLookup(currentHoverState);
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
    if (!extensionEnabled) return;
    if (isKeyMatch(event.key) && lastMouseEvent && !isMouseOverTooltip) {
      processMouseMove(lastMouseEvent);
    }
  }

  function handleGlobalKeyUp(event) {
    if (!extensionEnabled) return;
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

  let _shadowScanDebounceTimer = null;

  function observeShadowRoots() {
    scanForShadowRoots(document.body);
    const observer = new MutationObserver((mutations) => {
      let hasAddedElements = false;
      for (let i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes && mutations[i].addedNodes.length > 0) {
          hasAddedElements = true;
          break;
        }
      }
      if (hasAddedElements) {
        clearTimeout(_shadowScanDebounceTimer);
        _shadowScanDebounceTimer = setTimeout(() => {
          scanForShadowRoots(document.body);
        }, 1000);
      }
    });
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }

  function scanForShadowRoots(root) {
    if (!root) return;
    if (root.shadowRoot) attachHoverListeners(root.shadowRoot);
    if (root.querySelectorAll) {
      const elements = root.querySelectorAll('*');
      for (let i = 0; i < elements.length; i++) {
        if (elements[i].shadowRoot) attachHoverListeners(elements[i].shadowRoot);
      }
    }
  }

  let mouseMoveScheduled = false;
  let lastMouseEvent = null;

  function handleMouseMove(event) {
    lastMouseEvent = event;
    if (isMouseOverTooltip) return;

    if (!extensionEnabled || !isModifierPressed(event)) {
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
    if (!extensionEnabled) {
      scheduleHideTooltip();
      return;
    }
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
    scheduleAutoAiAnalysis(hoverState);
  }

  function scheduleAutoAiAnalysis(hoverState) {
    if (!autoTriggerAiOnHover || !hoverState || !hoverState.sentence) return;
    if (autoAiDebounceTimer) {
      clearTimeout(autoAiDebounceTimer);
      autoAiDebounceTimer = null;
    }
    const targetState = hoverState;
    autoAiDebounceTimer = setTimeout(() => {
      if (currentHoverState && currentHoverState.word === targetState.word && currentHoverState.sentenceKey === targetState.sentenceKey) {
        requestSentenceAnalysis(currentHoverState);
      }
    }, 250);
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

    const KOREAN_CHAR_REGEX = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]/u;
    if (!KOREAN_CHAR_REGEX.test(word)) return null;

    // Detect ASBPlayer subtitle context via closest() — simple and reliable
    const asbplayerContainer = node.parentElement
      ? node.parentElement.closest('[class*="asbplayer-subtitles"]')
      : null;
    const isSubtitleContext = Boolean(asbplayerContainer);

    // For subtitle context, get text from the innermost subtitle cue element.
    // For normal text, use the immediate parent element's text.
    let paragraphText;
    if (asbplayerContainer) {
      // Find the innermost .asbplayer-subtitle(s) that contains our text
      const cueEl = node.parentElement.closest('[class*="asbplayer-subtitle"]:not([class*="asbplayer-subtitles-container"])');
      paragraphText = normalizeText((cueEl || asbplayerContainer).textContent || textContent);
      recordSubtitleLine(paragraphText);
    } else {
      let blockContainer = node.parentElement;
      while (blockContainer && blockContainer !== document.body && blockContainer !== document.documentElement) {
        const tagName = blockContainer.tagName ? blockContainer.tagName.toLowerCase() : '';
        if (['p', 'li', 'td', 'th', 'article', 'section', 'div', 'blockquote', 'dd', 'dt'].includes(tagName)) {
          break;
        }
        blockContainer = blockContainer.parentElement;
      }
      paragraphText = normalizeText((blockContainer || node.parentElement)?.textContent || textContent);
    }

    let sentenceWindow = getSentenceWindow(paragraphText, word);

    // For subtitles, override currentSentence to be the full cue line
    if (isSubtitleContext && paragraphText) {
      sentenceWindow.currentSentence = paragraphText;
    }

    // Look up prev sentences from subtitle history buffer (two lines back for richer context)
    if (subtitleHistoryBuffer.length > 0 && isSubtitleContext) {
      const cur = sentenceWindow.currentSentence || paragraphText;
      const idx = subtitleHistoryBuffer.lastIndexOf(cur);
      if (idx !== -1) {
        sentenceWindow.prevSentence = idx > 0 ? subtitleHistoryBuffer[idx - 1] : '';
        sentenceWindow.prevSentence2 = idx > 1 ? subtitleHistoryBuffer[idx - 2] : '';
      }
    }

    // Merge with tab-level context (e.g. article text around the word)
    if (window._munmekTabContextText && !isSubtitleContext) {
      const tabWindow = getSentenceWindow(window._munmekTabContextText, word);
      if (tabWindow && tabWindow.currentSentence && tabWindow.currentSentence !== word) {
        sentenceWindow = {
          currentSentence: sentenceWindow.currentSentence || tabWindow.currentSentence,
          prevSentence: tabWindow.prevSentence || sentenceWindow.prevSentence,
          prevSentence2: sentenceWindow.prevSentence2 || ''
        };
      }
    }

    return {
      word,
      sentence: sentenceWindow.currentSentence,
      prevSentence: sentenceWindow.prevSentence,
      prevSentence2: sentenceWindow.prevSentence2 || '',
      paragraphText,
      isAsbplayerSubtitle: isSubtitleContext
    };
  }

  function getSentenceWindow(text, sentenceFragment) {
    const normalized = normalizeText(text);
    if (!normalized) return { currentSentence: sentenceFragment, prevSentence: '', prevSentence2: '' };

    const sentences = normalized.split(/(?<=[.!?。？！])\s+|\n+/).map((part) => part.trim()).filter(Boolean);
    if (sentences.length === 0) return { currentSentence: normalized, prevSentence: '', prevSentence2: '' };

    const fragment = normalizeText(sentenceFragment);
    let index = sentences.findIndex((candidate) => candidate.includes(fragment) || fragment.includes(candidate));
    if (index === -1) {
      const containingLine = sentences.find((candidate) => candidate.includes(fragment)) || sentences[0];
      index = sentences.indexOf(containingLine);
    }

    return {
      currentSentence: sentences[index] || normalized,
      prevSentence: index > 0 ? sentences[index - 1] : '',
      prevSentence2: index > 1 ? sentences[index - 2] : ''
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
      prevSentence2: normalizeText(context.prevSentence2),
      isAsbplayerSubtitle: Boolean(context.isAsbplayerSubtitle),
      dictionaryEntry: null,
      dictionaryMatch: '',
      candidateList,
      lookupReason: 'Looking up in IndexedDB...',
      x,
      y,
      tooltipFontSize: currentTooltipFontSize,
      quickFallback: null,
      userSelectedDef: false,
      isStage2Enabled: enableStage2Reranker,
      isStage2Loading: false,
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

  const stage2RerankCache = new Map();
  const dictPresenceCache = new Map();

  async function checkCandidateDictionaryStatus(state) {
    if (!state || !Array.isArray(state.candidateList) || state.candidateList.length === 0) return;
    if (!state.verifiedDictionaryCandidates) {
      state.verifiedDictionaryCandidates = new Set();
    }
    const topCandidates = state.candidateList.slice(0, 6);
    let hasChanges = false;

    for (const c of topCandidates) {
      if (dictPresenceCache.has(c.text)) {
        const hasDict = dictPresenceCache.get(c.text);
        if (hasDict) {
          state.verifiedDictionaryCandidates.add(c.text);
        }
        c.isLlmFallback = !hasDict;
        continue;
      }

      try {
        let res = await new Promise((resolve) => {
          chrome.runtime.sendMessage({
            type: 'dictionaryLookup',
            method: 'lookupSurface',
            text: c.text,
            dictId: currentSelectedDictionaryId
          }, resolve);
        });

        let hasHits = res && Array.isArray(res.hits) && res.hits.length > 0;
        if (!hasHits) {
          let resBase = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
              type: 'dictionaryLookup',
              method: 'lookupBase',
              text: c.text,
              dictId: currentSelectedDictionaryId
            }, resolve);
          });
          hasHits = resBase && Array.isArray(resBase.hits) && resBase.hits.length > 0;
        }

        dictPresenceCache.set(c.text, Boolean(hasHits));
        if (hasHits) {
          state.verifiedDictionaryCandidates.add(c.text);
        }
        c.isLlmFallback = !hasHits;
        hasChanges = true;
      } catch (err) {}
    }

    if (hasChanges && currentHoverState && currentHoverState.word === state.word) {
      rerenderCurrentTooltip();
    }
  }

  async function triggerIndexedDbLookup(state) {
    if (!state || !state.word) return;
    checkCandidateDictionaryStatus(state).catch(() => {});

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
              let sortedHits = sortHitsByBaseForm(res.hits);

              currentHoverState.dictionaryEntries = sortedHits;
              currentHoverState.dictionaryEntry = sortedHits[0];
              currentHoverState.dictionaryMatch = candidate.text;
              currentHoverState.selectedGroupIndex = 0;
              currentHoverState.quickFallback = null;
              currentHoverState.koelectraMatchedItemIndex = null;
              currentHoverState.koelectraMatchedDefIndex = null;
              currentHoverState.geminiMatchedItemIndex = null;
              currentHoverState.geminiMatchedDefIndex = null;
              currentHoverState.lookupReason = `IndexedDB Surface Match (${sortedHits[0].dictTitle || 'Local'})`;

              if (enableStage2Reranker) {
                const cacheKey = `${candidate.text}__${state.sentenceKey}`;
                const cachedRes = stage2RerankCache.get(cacheKey);
                if (cachedRes && Array.isArray(cachedRes.entries) && cachedRes.entries.length > 0) {
                  currentHoverState.isStage2Enabled = true;
                  currentHoverState.isStage2Loading = false;
                  currentHoverState.dictionaryEntries = cachedRes.entries;
                  currentHoverState.dictionaryEntry = cachedRes.entries[0];
                  if (typeof cachedRes.koelectraMatchedItemIndex === 'number') {
                    currentHoverState.koelectraMatchedItemIndex = cachedRes.koelectraMatchedItemIndex;
                    currentHoverState.koelectraMatchedDefIndex = cachedRes.koelectraMatchedDefIndex;
                    currentHoverState[`selectedDefIndex_${cachedRes.koelectraMatchedItemIndex}`] = cachedRes.koelectraMatchedDefIndex;
                    currentHoverState.selectedDefinitionIndex = cachedRes.koelectraMatchedDefIndex;
                  }
                  rerenderCurrentTooltip();
                } else {
                  currentHoverState.isStage2Enabled = true;
                  currentHoverState.isStage2Loading = true;
                  rerenderCurrentTooltip();
                  triggerDictionaryEntryReranking(state, sortedHits, candidate.text);
                }
              } else {
                currentHoverState.isStage2Enabled = false;
                currentHoverState.isStage2Loading = false;
                sortedHits.forEach((e) => {
                  if (e) {
                    delete e._confidenceScore;
                    delete e._defConfidenceScores;
                    delete e._koelectraMatched;
                    delete e._bestDefIndex;
                  }
                });
                rerenderCurrentTooltip();
              }
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
              let sortedHits = sortHitsByBaseForm(res.hits);

              currentHoverState.dictionaryEntries = sortedHits;
              currentHoverState.dictionaryEntry = sortedHits[0];
              currentHoverState.dictionaryMatch = candidate.text;
              currentHoverState.selectedGroupIndex = 0;
              currentHoverState.quickFallback = null;
              currentHoverState.koelectraMatchedItemIndex = null;
              currentHoverState.koelectraMatchedDefIndex = null;
              currentHoverState.geminiMatchedItemIndex = null;
              currentHoverState.geminiMatchedDefIndex = null;
              currentHoverState.lookupReason = `IndexedDB Base Match (${sortedHits[0].dictTitle || 'Local'})`;

              if (enableStage2Reranker) {
                const cacheKey = `${candidate.text}__${state.sentenceKey}`;
                const cachedRes = stage2RerankCache.get(cacheKey);
                if (cachedRes && Array.isArray(cachedRes.entries) && cachedRes.entries.length > 0) {
                  currentHoverState.isStage2Enabled = true;
                  currentHoverState.isStage2Loading = false;
                  currentHoverState.dictionaryEntries = cachedRes.entries;
                  currentHoverState.dictionaryEntry = cachedRes.entries[0];
                  if (typeof cachedRes.koelectraMatchedItemIndex === 'number') {
                    currentHoverState.koelectraMatchedItemIndex = cachedRes.koelectraMatchedItemIndex;
                    currentHoverState.koelectraMatchedDefIndex = cachedRes.koelectraMatchedDefIndex;
                    currentHoverState[`selectedDefIndex_${cachedRes.koelectraMatchedItemIndex}`] = cachedRes.koelectraMatchedDefIndex;
                    currentHoverState.selectedDefinitionIndex = cachedRes.koelectraMatchedDefIndex;
                  }
                  rerenderCurrentTooltip();
                } else {
                  currentHoverState.isStage2Enabled = true;
                  currentHoverState.isStage2Loading = true;
                  rerenderCurrentTooltip();
                  triggerDictionaryEntryReranking(state, sortedHits, candidate.text);
                }
              } else {
                currentHoverState.isStage2Enabled = false;
                currentHoverState.isStage2Loading = false;
                sortedHits.forEach((e) => {
                  if (e) {
                    delete e._confidenceScore;
                    delete e._defConfidenceScores;
                    delete e._koelectraMatched;
                    delete e._bestDefIndex;
                  }
                });
                rerenderCurrentTooltip();
              }
            }
            return;
          }
        }

        if (currentHoverState && currentHoverState.word === state.word && (!currentHoverState.dictionaryEntries || currentHoverState.dictionaryEntries.length === 0)) {
          currentHoverState.isStage2Loading = false;
          currentHoverState.lookupReason = 'No offline dictionary match found. Running Quick LLM Lookup...';
          rerenderCurrentTooltip();
          triggerQuickGeminiFallback(currentHoverState);
        }
      } catch (err) {
        console.warn('[Munmek] IndexedDB lookup notice:', err);
      }
    }
  }

  let rerankDebounceTimer = null;

  function triggerDictionaryEntryReranking(state, entries, candidateWord) {
    if (!state || !entries || entries.length === 0 || !state.sentence) {
      if (currentHoverState) {
        currentHoverState.isStage2Loading = false;
        rerenderCurrentTooltip();
      }
      return;
    }

    let totalDefs = 0;
    for (const e of entries) {
      const defs = Array.isArray(e?.definitions) ? e.definitions : [];
      totalDefs += defs.length || 1;
    }
    if (totalDefs <= 1) {
      if (currentHoverState) {
        currentHoverState.isStage2Loading = false;
        rerenderCurrentTooltip();
      }
      return;
    }

    if (state.geminiMatchedItemIndex !== null || (typeof sentenceAnalysisCache !== 'undefined' && sentenceAnalysisCache.has(state.sentenceKey))) {
      if (currentHoverState) {
        currentHoverState.isStage2Loading = false;
        rerenderCurrentTooltip();
      }
      return;
    }

    if (rerankDebounceTimer) {
      clearTimeout(rerankDebounceTimer);
    }

    const hoverId = Date.now();
    state._hoverReqId = hoverId;
    if (currentHoverState) {
      currentHoverState._hoverReqId = hoverId;
    }

    rerankDebounceTimer = setTimeout(() => {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        const tSent = Date.now();
        const tPerfStart = performance.now();

        chrome.runtime.sendMessage(
          {
            type: 'rerankDictionaryEntries',
            entries: entries,
            sentenceContext: state.sentence,
            word: candidateWord || state.word,
            t_sent: tSent
          },
          (response) => {
            const tPerfEnd = performance.now();
            const totalRoundtripMs = (tPerfEnd - tPerfStart).toFixed(2);

            if (currentHoverState && (currentHoverState._hoverReqId === hoverId || currentHoverState.word === state.word)) {
              currentHoverState.isStage2Loading = false;
              if (response && response.ok && Array.isArray(response.entries) && response.entries.length > 0 && !response.disabled) {
                const rerankedEntries = response.entries;
                console.log(`[Munmek Content Timer] Stage 2 Neural Rerank completed in ${totalRoundtripMs} ms (Offscreen: ${response.offscreenMs || '?'} ms, Query: ${response.queryMs || '?'} ms, Passages: ${response.passageCount || 0} passages [${response.precomputedHits || 0} precomputed] in ${response.passageMs || '?'} ms). Top entry: ${rerankedEntries[0]?.surface}, Def Tab: ${(rerankedEntries[0]?._bestDefIndex ?? 0) + 1}, Score: ${rerankedEntries[0]?._confidenceScore}`);
                currentHoverState.dictionaryEntries = rerankedEntries;
                currentHoverState.dictionaryEntry = rerankedEntries[0];

                let koelectraMatchedItemIndex = 0;
                let koelectraMatchedDefIndex = rerankedEntries[0]?._bestDefIndex || 0;

                const topEntry = rerankedEntries[0];
                if (topEntry && typeof topEntry._bestDefIndex === 'number') {
                  currentHoverState.koelectraMatchedItemIndex = 0;
                  currentHoverState.koelectraMatchedDefIndex = topEntry._bestDefIndex;
                  if (!currentHoverState.userSelectedDef) {
                    currentHoverState[`selectedDefIndex_0`] = topEntry._bestDefIndex;
                    currentHoverState.selectedDefinitionIndex = topEntry._bestDefIndex;
                  }
                }

                const cacheKey = `${candidateWord || state.word}__${state.sentenceKey}`;
                boundedMapSet(stage2RerankCache, cacheKey, {
                  entries: rerankedEntries,
                  koelectraMatchedItemIndex,
                  koelectraMatchedDefIndex
                }, 300);
              }
              rerenderCurrentTooltip();
            }
          }
        );
      } else if (currentHoverState) {
        currentHoverState.isStage2Loading = false;
        rerenderCurrentTooltip();
      }
    }, 80);
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
    const rawTarget = event.target;
    if (!(rawTarget instanceof Element) || !currentHoverState) return;

    const candidateEl = rawTarget.closest('[data-candidate]');
    if (candidateEl) {
      const selectedCandidate = candidateEl.getAttribute('data-candidate');
      currentHoverState.dictionaryMatch = selectedCandidate;
      currentHoverState.word = selectedCandidate;
      currentHoverState.selectedDefinitionIndex = 0;
      currentHoverState.selectedGroupIndex = 0;
      currentHoverState.userSelectedDef = false;
      delete currentHoverState.selectedDefIndex_0;

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({
          type: 'dictionaryLookup',
          method: 'lookupSurface',
          text: selectedCandidate,
          dictId: currentSelectedDictionaryId
        }, (res) => {
          if (res && res.hits && res.hits.length > 0 && currentHoverState) {
            let sortedHits = sortHitsByBaseForm(res.hits);
            currentHoverState.dictionaryEntries = sortedHits;
            currentHoverState.dictionaryEntry = sortedHits[0];
            currentHoverState.lookupReason = `Selected Candidate (${res.hits[0].dictTitle || 'Local'})`;

            if (enableStage2Reranker) {
              currentHoverState.isStage2Enabled = true;
              currentHoverState.isStage2Loading = true;
              rerenderCurrentTooltip();
              triggerDictionaryEntryReranking(currentHoverState, sortedHits, selectedCandidate);
            } else {
              currentHoverState.isStage2Enabled = false;
              currentHoverState.isStage2Loading = false;
              sortedHits.forEach((e) => {
                if (e) {
                  delete e._confidenceScore;
                  delete e._defConfidenceScores;
                  delete e._koelectraMatched;
                  delete e._bestDefIndex;
                }
              });
              rerenderCurrentTooltip();
            }
          } else {
            chrome.runtime.sendMessage({
              type: 'dictionaryLookup',
              method: 'lookupBase',
              text: selectedCandidate,
              dictId: currentSelectedDictionaryId
            }, (resBase) => {
              if (resBase && resBase.hits && resBase.hits.length > 0 && currentHoverState) {
                let sortedHits = sortHitsByBaseForm(resBase.hits);
                currentHoverState.dictionaryEntries = sortedHits;
                currentHoverState.dictionaryEntry = sortedHits[0];
                currentHoverState.lookupReason = `Selected Candidate (${resBase.hits[0].dictTitle || 'Local'})`;

                if (enableStage2Reranker) {
                  currentHoverState.isStage2Enabled = true;
                  currentHoverState.isStage2Loading = true;
                  rerenderCurrentTooltip();
                  triggerDictionaryEntryReranking(currentHoverState, sortedHits, selectedCandidate);
                } else {
                  currentHoverState.isStage2Enabled = false;
                  currentHoverState.isStage2Loading = false;
                  sortedHits.forEach((e) => {
                    if (e) {
                      delete e._confidenceScore;
                      delete e._defConfidenceScores;
                      delete e._koelectraMatched;
                      delete e._bestDefIndex;
                    }
                  });
                  rerenderCurrentTooltip();
                }
              } else if (currentHoverState) {
                currentHoverState.isStage2Loading = false;
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

    const actionEl = rawTarget.closest('[data-action]');
    if (!actionEl) return;
    const action = actionEl.getAttribute('data-action');

    if (action === 'select-dict-group-tab') {
      const idx = parseInt(actionEl.getAttribute('data-group-index'), 10);
      currentHoverState.selectedGroupIndex = idx;
      const dictGroups = window.MunmekUI ? window.MunmekUI.groupEntriesByDictTitle(currentHoverState.dictionaryEntries || []) : [];
      const activeGroup = dictGroups[idx];
      const targetLang = (window.MunmekUI && typeof window.MunmekUI.getDictionaryLanguage === 'function')
        ? window.MunmekUI.getDictionaryLanguage(activeGroup)
        : 'English';

      // Check if we have cached analysis for this target language!
      const langKey = `${currentHoverState.sentenceKey}__${targetLang}`;
      if (sentenceAnalysisCache.has(langKey)) {
        const cached = sentenceAnalysisCache.get(langKey);
        currentHoverState.currentAnalysis = cached;
        currentHoverState.currentAnalysisLanguage = targetLang;
        if (window.MunmekUI) window.MunmekUI.autoSelectBestDefinitionFromGemini(currentHoverState, cached);
      } else if (targetLang === 'English' && sentenceAnalysisCache.has(currentHoverState.sentenceKey)) {
        const cached = sentenceAnalysisCache.get(currentHoverState.sentenceKey);
        currentHoverState.currentAnalysis = cached;
        currentHoverState.currentAnalysisLanguage = 'English';
        if (window.MunmekUI) window.MunmekUI.autoSelectBestDefinitionFromGemini(currentHoverState, cached);
      } else {
        // If no analysis for this language yet, re-evaluate so no badge is placed for non-matching language
        if (currentHoverState.currentAnalysis && window.MunmekUI) {
          window.MunmekUI.autoSelectBestDefinitionFromGemini(currentHoverState, currentHoverState.currentAnalysis);
        }
      }

      if (activeGroup && activeGroup.items.length > 0) {
        const groupMatch = currentHoverState.geminiMatchesByGroup && currentHoverState.geminiMatchesByGroup[idx];
        const targetItemIdx = (groupMatch && groupMatch.matched && typeof groupMatch.itemIndex === 'number' && activeGroup.items[groupMatch.itemIndex])
          ? groupMatch.itemIndex
          : 0;
        currentHoverState.dictionaryEntry = activeGroup.items[targetItemIdx];
      }
      rerenderCurrentTooltip();
      return;
    }

    if (action === 'select-def-tab') {
      const idxStr = actionEl.getAttribute('data-def-index');
      const itemIdxStr = actionEl.getAttribute('data-item-index') || '0';
      if (idxStr !== null) {
        const itemIdx = Number(itemIdxStr);
        const defIdx = Number(idxStr);
        currentHoverState.userSelectedDef = true;
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

    if (action === 'toggle-def') {
      const targetId = actionEl.getAttribute('data-target');
      if (targetId) {
        const hiddenEl = document.getElementById(targetId);
        if (hiddenEl) {
          const isHidden = hiddenEl.style.display === 'none';
          hiddenEl.style.display = isHidden ? 'block' : 'none';
          actionEl.textContent = isHidden ? 'Show fewer definitions ▴' : actionEl.getAttribute('data-show-text') || 'Show all definitions ▾';
        }
      }
      return;
    }

    if (action === 'analyze-lang') {
      const requestedLang = actionEl.getAttribute('data-lang') || 'English';
      requestSentenceAnalysis(currentHoverState, null, true, requestedLang);
      return;
    }

    if (action === 'analyze') {
      const requestedLang = actionEl.getAttribute('data-lang') || null;
      requestSentenceAnalysis(currentHoverState, null, true, requestedLang);
      return;
    }

    if (action === 'ask-followup') {
      const box = rawTarget.closest('.munmek-followup-box');
      const inputEl = box?.querySelector('.munmek-followup-input');
      const respEl = box?.querySelector('.munmek-followup-response');
      const question = inputEl?.value?.trim();
      if (!question || !respEl) return;

      respEl.style.display = 'block';
      respEl.textContent = 'Thinking...';

      const cachedAnalysis = sentenceAnalysisCache.get(currentHoverState.sentenceKey);

      chrome.runtime.sendMessage({
        type: 'askGeminiFollowup',
        data: {
          question,
          word: currentHoverState.word,
          sentence: currentHoverState.sentence,
          previousAnalysis: cachedAnalysis || currentHoverState.quickFallback || null
        }
      }, (res) => {
        if (res && res.data && res.data.answer) {
          respEl.textContent = res.data.answer;
          if (inputEl) inputEl.value = '';
        } else {
          respEl.textContent = res?.error || 'Failed to get follow-up answer.';
        }
      });
      return;
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
      const defIndexStr = actionEl.getAttribute('data-def-index');
      const itemIdxStr = actionEl.getAttribute('data-item-index') || '0';
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
    if (!state || !state.word) return;
    const targetWord = state.word;
    const cacheKey = `${targetWord}__${state.sentenceKey || state.sentence || ''}`;

    if (quickLlmLookupCache.has(cacheKey)) {
      const cached = quickLlmLookupCache.get(cacheKey);
      if (currentHoverState && currentHoverState.word === targetWord) {
        currentHoverState.quickFallback = cached;
        currentHoverState.lookupReason = `Quick LLM Lookup (${cached.pos || 'LLM'})`;
        currentHoverState.isStage2Loading = false;
        rerenderCurrentTooltip();
      }
      return;
    }

    if (pendingQuickFallbacks.has(cacheKey)) return;
    pendingQuickFallbacks.set(cacheKey, true);

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage(
        {
          type: 'quickGeminiFallback',
          data: {
            word: targetWord,
            sentence: state.sentence,
            prevSentence: state.prevSentence,
            prevSentence2: state.prevSentence2
          }
        },
        (res) => {
          pendingQuickFallbacks.delete(cacheKey);
          if (chrome.runtime.lastError || !res || res.error) {
            if (currentHoverState && currentHoverState.word === state.word) {
              let errMsg = res?.error || chrome.runtime.lastError?.message || 'Quick LLM Lookup failed.';
              if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED')) {
                errMsg = 'Gemini API Rate Limit Reached (HTTP 429). Please wait a few seconds.';
              }
              currentHoverState.lookupReason = 'Quick LLM Lookup Failed';
              currentHoverState.feedback = errMsg;
              currentHoverState.feedbackType = 'error';
              rerenderCurrentTooltip();
            }
            return;
          }
          if (res && res.data) {
            boundedMapSet(quickLlmLookupCache, cacheKey, res.data, 200);
            if (currentHoverState && currentHoverState.word === state.word) {
              currentHoverState.quickFallback = res.data;
              currentHoverState.lookupReason = `Quick LLM Lookup (${res.data.pos || 'LLM'})`;
              rerenderCurrentTooltip();
            }
          }
        }
      );
    }
  }

  function requestSentenceAnalysis(state, onSuccess = null, forceRefresh = false, requestedLang = null) {
    if (!state) return;

    const dictGroups = (window.MunmekUI && Array.isArray(state.dictionaryEntries))
      ? window.MunmekUI.groupEntriesByDictTitle(state.dictionaryEntries)
      : [];
    const activeGroup = dictGroups[state.selectedGroupIndex || 0];
    const resolvedLang = requestedLang || ((window.MunmekUI && typeof window.MunmekUI.getDictionaryLanguage === 'function')
      ? window.MunmekUI.getDictionaryLanguage(activeGroup)
      : 'English');

    const cacheLangKey = `${state.sentenceKey}__${resolvedLang}`;

    if (forceRefresh && state.sentenceKey) {
      sentenceAnalysisCache.delete(cacheLangKey);
      if (resolvedLang === 'English') {
        sentenceAnalysisCache.delete(state.sentenceKey);
      }
    }

    if (!forceRefresh && sentenceAnalysisCache.has(cacheLangKey) && !pendingAnalysisRequests.has(cacheLangKey)) {
      const cached = sentenceAnalysisCache.get(cacheLangKey);
      state.currentAnalysis = cached;
      state.currentAnalysisLanguage = resolvedLang;
      autoSelectBestDefinitionFromGemini(state, cached);
      currentHoverState.feedback = '';
      rerenderCurrentTooltip();
      if (typeof onSuccess === 'function') onSuccess();
      return;
    } else if (!forceRefresh && resolvedLang === 'English' && sentenceAnalysisCache.has(state.sentenceKey) && !pendingAnalysisRequests.has(state.sentenceKey)) {
      const cached = sentenceAnalysisCache.get(state.sentenceKey);
      state.currentAnalysis = cached;
      state.currentAnalysisLanguage = 'English';
      autoSelectBestDefinitionFromGemini(state, cached);
      currentHoverState.feedback = '';
      rerenderCurrentTooltip();
      if (typeof onSuccess === 'function') onSuccess();
      return;
    }

    if (pendingAnalysisRequests.has(cacheLangKey) || pendingAnalysisRequests.has(state.sentenceKey)) {
      currentHoverState.feedback = `LLM analysis (${resolvedLang}) is already in progress.`;
      currentHoverState.feedbackType = 'info';
      rerenderCurrentTooltip();
      return;
    }

    pendingAnalysisRequests.set(cacheLangKey, true);

    console.log('[Munmek SubtitleContextSent]', {
      word: state.word,
      sentence: state.sentence,
      prevSentence: state.prevSentence || '(none)',
      prevSentence2: state.prevSentence2 || '(none)',
      isAsbplayerSubtitle: Boolean(state.isAsbplayerSubtitle),
      responseLanguage: resolvedLang
    });

    currentHoverState.isAiLoading = true;
    currentHoverState.feedback = '';
    rerenderCurrentTooltip();

    chrome.runtime.sendMessage(
      {
        type: 'analyzeSentence',
        data: {
          word: state.word,
          sentence: state.sentence,
          prevSentence: state.prevSentence,
          prevSentence2: state.prevSentence2,
          dictionaryEntry: state.dictionaryEntry,
          candidate: state.dictionaryMatch,
          responseLanguage: resolvedLang
        }
      },
      (response) => {
        pendingAnalysisRequests.delete(cacheLangKey);
        if (currentHoverState) currentHoverState.isAiLoading = false;

        if (chrome.runtime.lastError || !response || response.error) {
          let errMsg = response?.error || chrome.runtime.lastError?.message || 'LLM request failed.';
          if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED')) {
            errMsg = 'API Rate Limit Reached (HTTP 429). Please wait a few seconds before requesting LLM again.';
          }
          currentHoverState.feedback = errMsg;
          currentHoverState.feedbackType = 'error';
          rerenderCurrentTooltip();
          return;
        }

        const resData = response.data;
        if (resData && typeof resData === 'object' && !resData._responseLanguage) {
          try {
            Object.defineProperty(resData, '_responseLanguage', {
              value: resolvedLang,
              enumerable: false,
              writable: true,
              configurable: true
            });
          } catch (_) {
            resData._responseLanguage = resolvedLang;
          }
        }

        boundedMapSet(sentenceAnalysisCache, cacheLangKey, resData, 200);
        if (resolvedLang === 'English') {
          boundedMapSet(sentenceAnalysisCache, state.sentenceKey, resData, 200);
        }
        const wordKey = normalizeText(state.word || '');
        if (wordKey) {
          boundedMapSet(sentenceAnalysisCache, `${wordKey}__${cacheLangKey}`, resData, 200);
          if (resolvedLang === 'English') {
            boundedMapSet(sentenceAnalysisCache, `${wordKey}__${state.sentenceKey}`, resData, 200);
          }
        }

        if (!state.cachedAnalysesByLang) state.cachedAnalysesByLang = {};
        state.cachedAnalysesByLang[resolvedLang] = resData;
        state.currentAnalysis = resData;
        state.currentAnalysisLanguage = resolvedLang;

        autoSelectBestDefinitionFromGemini(state, resData);
        currentHoverState.feedback = '';
        rerenderCurrentTooltip();
        if (typeof onSuccess === 'function') onSuccess();
      }
    );
  }

  function autoSelectBestDefinitionFromGemini(state, analysisData) {
    if (window.MunmekUI && typeof window.MunmekUI.autoSelectBestDefinitionFromGemini === 'function') {
      window.MunmekUI.autoSelectBestDefinitionFromGemini(state, analysisData);
      state.isStage2Loading = false;
      if (rerankDebounceTimer) {
        clearTimeout(rerankDebounceTimer);
        rerankDebounceTimer = null;
      }

      if (state.geminiMatchedBase) {
        const cleanHelper = (window.MunmekUI && window.MunmekUI.cleanKoreanLemma) ||
                            (window.MunmekUI && window.MunmekUI.cleanKoreanWord) ||
                            (w => String(w || '').trim());
        const cleanTarget = cleanHelper(state.geminiMatchedBase);
        const cleanCurrentMatch = cleanHelper(state.dictionaryMatch);

        if (cleanTarget && cleanTarget !== cleanCurrentMatch) {
          let matchingCand = (state.candidateList || []).find(c => {
            const cText = c.text || '';
            const cStem = c.stem || '';
            return cText === cleanTarget || cStem === cleanTarget ||
                   cleanHelper(cText) === cleanTarget || cleanHelper(cStem) === cleanTarget;
          });

          if (!matchingCand) {
            matchingCand = { text: cleanTarget, score: 96, posHint: 'verb/noun', reason: 'LLM Matched Base' };
            if (!Array.isArray(state.candidateList)) state.candidateList = [];
            state.candidateList.unshift(matchingCand);
          }
          switchCandidateForm(state, matchingCand.text);
        }
      }
    }
  }

  function switchCandidateForm(state, selectedCandidate) {
    if (!state || state.dictionaryMatch === selectedCandidate) return;
    state.dictionaryMatch = selectedCandidate;
    state.word = selectedCandidate;
    state.selectedDefinitionIndex = 0;
    state.selectedGroupIndex = 0;
    state.userSelectedDef = false;
    delete state.selectedDefIndex_0;

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({
        type: 'dictionaryLookup',
        method: 'lookupSurface',
        text: selectedCandidate,
        dictId: currentSelectedDictionaryId
      }, (res) => {
        if (res && res.hits && res.hits.length > 0 && state) {
          let sortedHits = sortHitsByBaseForm(res.hits);
          state.dictionaryEntries = sortedHits;
          state.dictionaryEntry = sortedHits[0];
          state.lookupReason = `LLM Matched (${res.hits[0].dictTitle || 'Local'})`;
          const cachedAnalysis = sentenceAnalysisCache.get(state.sentenceKey);
          if (cachedAnalysis && window.MunmekUI) {
            window.MunmekUI.autoSelectBestDefinitionFromGemini(state, cachedAnalysis);
          }
          rerenderCurrentTooltip();
        } else if (state) {
          chrome.runtime.sendMessage({
            type: 'dictionaryLookup',
            method: 'lookupBase',
            text: selectedCandidate,
            dictId: currentSelectedDictionaryId
          }, (resBase) => {
            if (resBase && resBase.hits && resBase.hits.length > 0 && state) {
              let sortedHits = sortHitsByBaseForm(resBase.hits);
              state.dictionaryEntries = sortedHits;
              state.dictionaryEntry = sortedHits[0];
              state.lookupReason = `LLM Matched (${resBase.hits[0].dictTitle || 'Local'})`;
              const cachedAnalysis = sentenceAnalysisCache.get(state.sentenceKey);
              if (cachedAnalysis && window.MunmekUI) {
                window.MunmekUI.autoSelectBestDefinitionFromGemini(state, cachedAnalysis);
              }
              rerenderCurrentTooltip();
            } else if (state) {
              state.dictionaryEntries = [];
              state.dictionaryEntry = null;
              state.lookupReason = 'No dictionary match found.';
              rerenderCurrentTooltip();
            }
          });
        }
      });
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
          surface: state.word,
          base: state.dictionaryEntry?.base || state.dictionaryMatch || state.word,
          sentence: state.sentence,
          prevSentence: state.prevSentence,
          prevSentence2: state.prevSentence2,
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
        currentHoverState.feedbackType = 'success';
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
    if (autoAiDebounceTimer) {
      clearTimeout(autoAiDebounceTimer);
      autoAiDebounceTimer = null;
    }
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (window.MunmekUI) window.MunmekUI.hideTooltip();
      lastHoverSignature = '';
    }, HIDE_DELAY_MS);
  }

  function cancelHideTooltip() {
    clearTimeout(hideTimer);
  }

  function normalizeText(value) {
    return String(value || '').normalize().replace(/\s+/g, ' ').trim();
  }

  let lastKnownNetflixMeta = {
    title: '',
    seasonNumber: null,
    episodeNumber: null,
    episodeTitle: '',
    synopsis: '',
    netflixId: ''
  };

  function parseNetflixTitleString(rawTitle) {
    let cleanDoc = String(rawTitle || '')
      .replace(/\s*[\|\-·]\s*(Netflix|넷플릭스).*$/i, '')
      .replace(/^(Watch|시청하기)\s+/i, '')
      .trim();

    const isGeneric = !cleanDoc ||
      /^netflix$/i.test(cleanDoc) ||
      /^netflix video$/i.test(cleanDoc) ||
      /^netflix\s*[:\-·]/i.test(cleanDoc) ||
      /watch tv shows online/i.test(cleanDoc) ||
      /watch movies online/i.test(cleanDoc);

    if (isGeneric) {
      return { showTitle: '', seasonNumber: null, episodeNumber: null };
    }

    let seasonNumber = null;
    let episodeNumber = null;
    let showTitle = cleanDoc;

    const seMatch = cleanDoc.match(/(?:Season|시즌|S)\s*(\d+)[\s,:\-·]*(?:(?:Episode|E|Ep)\s*(\d+)|(\d+)\s*(?:화|회))/i);
    if (seMatch) {
      seasonNumber = parseInt(seMatch[1], 10);
      episodeNumber = parseInt(seMatch[2] || seMatch[3], 10);
      showTitle = cleanDoc.split(/[:\-·]\s*(?:Season|시즌|S\s*\d)/i)[0].trim();
    } else {
      const epOnlyMatch = cleanDoc.match(/(?:(?:Episode|E|Ep)\s*(\d+)|(\d+)\s*(?:화|회))/i);
      if (epOnlyMatch) {
        episodeNumber = parseInt(epOnlyMatch[1] || epOnlyMatch[2], 10);
        showTitle = cleanDoc.split(/[:\-·]\s*(?:Episode|화|회|E\s*\d|Ep\s*\d)/i)[0].trim();
      }
    }

    return { showTitle: showTitle || cleanDoc, seasonNumber, episodeNumber };
  }

  function extractNetflixPageData() {
    try {
      const url = window.location.href;
      const matchWatch = url.match(/\/watch\/(\d+)/);
      const matchTitle = url.match(/\/title\/(\d+)/);
      const netflixId = matchWatch ? matchWatch[1] : (matchTitle ? matchTitle[1] : (lastKnownNetflixMeta.netflixId || ''));
      if (netflixId) lastKnownNetflixMeta.netflixId = netflixId;

      let title = '';
      let epText = '';
      let seasonNumber = null;
      let episodeNumber = null;

      // 1. Check MediaSession API
      if (typeof navigator !== 'undefined' && navigator.mediaSession?.metadata) {
        const meta = navigator.mediaSession.metadata;
        const mArtist = (meta.artist || '').trim();
        const mTitle = (meta.title || '').trim();
        const mAlbum = (meta.album || '').trim();

        console.log('[Munmek Netflix] MediaSession metadata found:', { artist: mArtist, title: mTitle, album: mAlbum });

        if (mArtist && !/^netflix$|^netflix video$/i.test(mArtist)) {
          title = mArtist;
        }
        if (mAlbum && !/^netflix$|^netflix video$/i.test(mAlbum)) {
          epText = mAlbum;
          const sMatch = mAlbum.match(/(?:Season|시즌|S)\s*(\d+)/i);
          if (sMatch) seasonNumber = parseInt(sMatch[1], 10);
        }
        if (mTitle && !/^netflix$|^netflix video$/i.test(mTitle)) {
          if (!title) {
            title = mTitle;
          } else {
            epText = epText ? `${epText} - ${mTitle}` : mTitle;
          }
          const epMatch = mTitle.match(/(?:Episode|E|Ep)\s*(\d+)|(\d+)\s*(?:화|회)/i);
          if (epMatch) episodeNumber = parseInt(epMatch[1] || epMatch[2], 10);
        }
      }

      // 2. Check Player DOM (when controls are visible or mounted in DOM)
      const videoTitleContainer = document.querySelector('[data-uia="video-title"], .video-title, [data-uia="control-header"]');
      if (videoTitleContainer) {
        const hEl = videoTitleContainer.querySelector('h4, [data-uia="player-title-header"], .video-title-header, .ellipsize-text');
        const spanEl = videoTitleContainer.querySelector('span, [data-uia="player-title-subtitle"], .video-title-sub');
        const domShow = (hEl?.textContent || '').trim();
        const domEp = (spanEl?.textContent || '').trim();
        console.log('[Munmek Netflix] Player DOM video-title elements:', { domShow, domEp });
        if (domShow && !/^netflix$|^netflix video$/i.test(domShow)) {
          title = domShow;
        }
        if (domEp) {
          epText = epText || domEp;
        }
      }

      // Additional DOM fallbacks using unified selector
      if (!title) {
        const fallbackEl = document.querySelector('.video-title h4, [data-uia="control-header-title"], .watch-video--player-view-title, .previewModal--player_container_title, .watch-video--evidence-overlay-text, [data-uia="watch-video-title"]');
        const text = (fallbackEl?.textContent || '').trim();
        if (text && !/^netflix$|^netflix video$/i.test(text)) {
          title = text;
          console.log('[Munmek Netflix] Found title from fallback DOM selector:', title);
        }
      }

      // Check button aria-labels (e.g. Back to Gokusen or Episodes: Gokusen)
      if (!title) {
        const episodesBtn = document.querySelector('[data-uia="control-episodes"], button[aria-label*="Episodes"], button[aria-label*="회차"]');
        const ariaLabel = episodesBtn?.getAttribute('aria-label') || '';
        const epAriaMatch = ariaLabel.match(/(?:Episodes|회차)\s*:\s*(.+)/i);
        if (epAriaMatch && epAriaMatch[1].trim()) {
          title = epAriaMatch[1].trim();
          console.log('[Munmek Netflix] Found title from episodes button aria-label:', title);
        }
      }

      // 3. Check document.title using unified title parser
      if (document.title) {
        const parsedDoc = parseNetflixTitleString(document.title);
        if (!title && parsedDoc.showTitle) title = parsedDoc.showTitle;
        if (seasonNumber == null && parsedDoc.seasonNumber != null) seasonNumber = parsedDoc.seasonNumber;
        if (episodeNumber == null && parsedDoc.episodeNumber != null) episodeNumber = parsedDoc.episodeNumber;
      }

      // Parse seasonNumber and episodeNumber from epText if not yet populated
      if (epText) {
        const seMatch = epText.match(/(?:S|Season|시즌)\s*(\d+)[\s:]*(?:(?:Episode|E|Ep)\s*(\d+)|(\d+)\s*(?:화|회))/i);
        if (seMatch) {
          if (!seasonNumber) seasonNumber = parseInt(seMatch[1], 10);
          if (!episodeNumber) episodeNumber = parseInt(seMatch[2] || seMatch[3], 10);
        } else {
          const epOnly = epText.match(/(?:(?:Episode|E|Ep)\s*(\d+)|(\d+)\s*(?:화|회))/i);
          if (epOnly && !episodeNumber) {
            episodeNumber = parseInt(epOnly[1] || epOnly[2], 10);
          }
        }
      }

      // 4. Scrape direct synopsis from Netflix DOM or JSON-LD
      let directSynopsis = '';
      const synopsisEl = document.querySelector('.previewModal--synopsis, .synopsis, [data-uia="episode-synopsis"], .titleDescription--synopsis, .episode-synopsis, [data-uia="video-synopsis"], .ltr-191i9y8, .about-synopsis');
      if (synopsisEl && synopsisEl.textContent) {
        directSynopsis = synopsisEl.textContent.trim();
      }

      if (!directSynopsis) {
        const jsonLdScripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const script of jsonLdScripts) {
          try {
            const parsed = JSON.parse(script.textContent || '{}');
            if (parsed.description) {
              directSynopsis = parsed.description.trim();
              if (!title && parsed.name) title = parsed.name.trim();
              break;
            }
          } catch (e) {}
        }
      }

      // Fall back to persistent cache if current state is missing values
      if (!title && lastKnownNetflixMeta.title) title = lastKnownNetflixMeta.title;
      if (!seasonNumber && lastKnownNetflixMeta.seasonNumber) seasonNumber = lastKnownNetflixMeta.seasonNumber;
      if (!episodeNumber && lastKnownNetflixMeta.episodeNumber) episodeNumber = lastKnownNetflixMeta.episodeNumber;
      if (!epText && lastKnownNetflixMeta.episodeTitle) epText = lastKnownNetflixMeta.episodeTitle;
      if (!directSynopsis && lastKnownNetflixMeta.synopsis) directSynopsis = lastKnownNetflixMeta.synopsis;

      // Update persistent cache with any newly discovered values
      if (title) lastKnownNetflixMeta.title = title;
      if (seasonNumber) lastKnownNetflixMeta.seasonNumber = seasonNumber;
      if (episodeNumber) lastKnownNetflixMeta.episodeNumber = episodeNumber;
      if (epText) lastKnownNetflixMeta.episodeTitle = epText;
      if (directSynopsis) lastKnownNetflixMeta.synopsis = directSynopsis;

      const subText = subtitleHistoryBuffer.slice(-12).join(' ');

      const result = {
        siteType: 'netflix',
        title: title || '',
        netflixData: {
          title: title || '',
          netflixId,
          seasonNumber,
          episodeNumber,
          episodeTitle: epText,
          synopsis: directSynopsis,
          hasDirectSynopsis: Boolean(directSynopsis),
          subtitles: subText,
          pageDetails: `${epText} ${directSynopsis}`.trim()
        },
        text: `${title} ${epText} ${directSynopsis} ${subText}`.trim()
      };

      console.log('[Munmek Netflix] Finished extractNetflixPageData:', {
        url,
        netflixId,
        title: result.title,
        seasonNumber,
        episodeNumber,
        hasDirectSynopsis: result.netflixData.hasDirectSynopsis,
        subtitlesLength: subText.length
      });

      return result;
    } catch (err) {
      console.error('[Munmek Netflix] Error in extractNetflixPageData:', err);
      return {
        siteType: 'netflix',
        title: lastKnownNetflixMeta.title || '',
        netflixData: {
          title: lastKnownNetflixMeta.title || '',
          netflixId: lastKnownNetflixMeta.netflixId || '',
          seasonNumber: lastKnownNetflixMeta.seasonNumber,
          episodeNumber: lastKnownNetflixMeta.episodeNumber,
          episodeTitle: lastKnownNetflixMeta.episodeTitle || '',
          synopsis: lastKnownNetflixMeta.synopsis || '',
          hasDirectSynopsis: Boolean(lastKnownNetflixMeta.synopsis),
          subtitles: subtitleHistoryBuffer.slice(-12).join(' '),
          pageDetails: ''
        },
        text: `${lastKnownNetflixMeta.title || ''} ${subtitleHistoryBuffer.slice(-12).join(' ')}`.trim()
      };
    }
  }

  function extractYouTubePageData() {
    let videoId = '';
    try {
      const url = new URL(window.location.href);
      videoId = url.searchParams.get('v') || (url.pathname.startsWith('/embed/') ? url.pathname.split('/')[2] : '');
    } catch (e) {}

    const titleEl = document.querySelector('h1.ytd-watch-metadata, #title h1, h1.title');
    const title = (titleEl?.textContent || document.title || 'YouTube Video').replace(/\s*-\s*YouTube$/i, '').trim();

    const authorEl = document.querySelector('#channel-name, #owner #text, ytd-channel-name');
    const author = (authorEl?.textContent || '').trim();

    const descEl = document.querySelector('#description-inline-expander, #description, ytd-text-inline-expander');
    const description = (descEl?.textContent || '').trim();

    // Check live on-screen YouTube captions if player is playing
    const liveCaptions = [];
    document.querySelectorAll('.ytp-caption-segment, .caption-visual-line, ytd-transcript-segment-renderer').forEach((el) => {
      const t = (el.textContent || '').trim();
      if (t && !liveCaptions.includes(t)) liveCaptions.push(t);
    });

    let captionTracks = [];
    try {
      if (window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
        captionTracks = window.ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks;
      } else {
        const scripts = document.querySelectorAll('script');
        for (const s of scripts) {
          if (s.textContent && s.textContent.includes('captionTracks')) {
            const match = s.textContent.match(/"captionTracks":\s*(\[[^\]]+\])/);
            if (match) {
              captionTracks = JSON.parse(match[1]);
              break;
            }
          }
        }
      }
    } catch (e) {}

    const subText = [...subtitleHistoryBuffer, ...liveCaptions].slice(-15).join(' ');

    return {
      siteType: 'youtube',
      title: title || 'YouTube Video',
      youtubeData: {
        videoId,
        title,
        author,
        description,
        captionTracks,
        subtitlesSample: subText
      },
      text: `${title}\n${author}\n${subText || description}`.trim()
    };
  }

  function extractGenericPageData() {
    const parts = [];
    const subtitleElements = document.querySelectorAll('.asbplayer-subtitle, [class*="subtitle"], [id*="subtitle"], track');
    subtitleElements.forEach((el) => {
      const t = (el.textContent || '').trim();
      if (t && !parts.includes(t)) parts.push(t);
    });

    const contentArea = document.querySelector('#bodyContent, article, main, [role="main"]') || document.body;
    const paragraphs = contentArea.querySelectorAll('p, h1, h2, h3');
    paragraphs.forEach((p) => {
      const t = (p.textContent || '').replace(/\s+/g, ' ').trim();
      // Filter out boilerplate / short navigational text
      if (t && t.length > 25 && t.length < 800 && !parts.includes(t)) {
        parts.push(t);
      }
    });

    return {
      siteType: 'generic',
      title: document.title || 'Webpage Content',
      text: parts.slice(0, 8).join('\n\n').slice(0, 2500)
    };
  }

  // Active tab context extractor and session messaging
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.type === 'setTabSessionActive') {
        extensionEnabled = Boolean(request.isActive);
        if (!extensionEnabled) scheduleHideTooltip();
        sendResponse({ success: true, extensionEnabled });
        return true;
      }

      if (request.type === 'extractSiteContext') {
        try {
          const host = window.location.hostname.toLowerCase();
          if (host.includes('netflix.com')) {
            sendResponse(extractNetflixPageData());
          } else if (host.includes('youtube.com') || host.includes('youtu.be')) {
            sendResponse(extractYouTubePageData());
          } else {
            sendResponse(extractGenericPageData());
          }
        } catch (extractErr) {
          console.error('[Munmek Content] extractSiteContext fatal error:', extractErr);
          const isNet = window.location.hostname.toLowerCase().includes('netflix.com');
          sendResponse({
            siteType: isNet ? 'netflix' : 'generic',
            title: isNet ? (lastKnownNetflixMeta.title || 'Netflix Video') : 'Webpage Content',
            netflixData: isNet ? lastKnownNetflixMeta : null,
            text: ''
          });
        }
        return true;
      }

      if (request.type === 'extractPageContext') {
        sendResponse(extractGenericPageData());
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
