const HIDE_DELAY_MS = 450;
const TOOLTIP_ID = 'munmek-tooltip';
const STYLE_ID = 'munmek-tooltip-style';

const sentenceAnalysisCache = new Map();
const pendingAnalysisRequests = new Map();

let tooltip = null;
let hideTimer = null;
let currentHoverState = null;
let lastHoverSignature = '';
let lastTooltipPosition = { x: 0, y: 0 };
let isMouseOverTooltip = false;
let currentModifierKey = 'Shift';

function init() {
  injectTooltipStyles();
  attachHoverListeners(document);
  observeShadowRoots();

  chrome.storage.local.get(['modifierKey'], (result) => {
    if (result.modifierKey !== undefined) {
      currentModifierKey = result.modifierKey;
    }
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.modifierKey) {
      currentModifierKey = changes.modifierKey.newValue || 'Shift';
    }
  });

  window.addEventListener('keydown', handleGlobalKeyDown);
  window.addEventListener('keyup', handleGlobalKeyUp);

  window.addEventListener('munmekWasmAnalysisReady', (e) => {
    if (currentHoverState && e.detail && e.detail.surfaceText === currentHoverState.word) {
      const updatedHoverState = buildHoverState(
        {
          word: currentHoverState.word,
          sentence: currentHoverState.sentence,
          prevSentence: currentHoverState.prevSentence,
          nextSentence: currentHoverState.nextSentence
        },
        lastTooltipPosition.x,
        lastTooltipPosition.y
      );
      currentHoverState = updatedHoverState;
      rerenderCurrentTooltip();
    }
  });
}

function isModifierPressed(event) {
  if (!currentModifierKey || currentModifierKey === 'None') {
    return true;
  }
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

if (document.body) {
  init();
} else {
  document.addEventListener('DOMContentLoaded', init, { once: true });
}

function injectTooltipStyles() {
  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${TOOLTIP_ID}.munmek-tooltip {
      position: fixed;
      z-index: 2147483647;
      display: none;
      width: min(440px, calc(100vw - 24px));
      max-height: min(72vh, 760px);
      overflow: auto;
      box-sizing: border-box;
      padding: 16px;
      border: 1px solid #ddd3c4;
      border-radius: 18px;
      background: #fffdf8;
      color: #1e1b16;
      box-shadow: 0 18px 55px rgba(23, 56, 59, 0.2);
      font-family: Georgia, 'Times New Roman', serif;
      line-height: 1.5;
      user-select: text;
    }

    #${TOOLTIP_ID} .title {
      font-size: 1.2rem;
      font-weight: 700;
      margin-bottom: 6px;
      color: #17383b;
    }

    #${TOOLTIP_ID} .subtitle {
      color: #6c6458;
      font-size: 0.9rem;
      margin-bottom: 10px;
    }

    #${TOOLTIP_ID} .section {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #ece2d4;
    }

    #${TOOLTIP_ID} .section:first-of-type {
      margin-top: 0;
      padding-top: 0;
      border-top: 0;
    }

    #${TOOLTIP_ID} .label {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #7b7163;
      margin-bottom: 6px;
    }

    #${TOOLTIP_ID} .sentence {
      font-size: 0.92rem;
      color: #4f463a;
      background: #f7f2ea;
      border-radius: 12px;
      padding: 10px 12px;
    }

    #${TOOLTIP_ID} .chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 8px;
    }

    #${TOOLTIP_ID} .chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 10px;
      border-radius: 999px;
      background: #e4f0ee;
      color: #17383b;
      font-size: 0.82rem;
      font-weight: 700;
    }

    #${TOOLTIP_ID} .entry-box {
      border: 1px solid #eadfce;
      border-radius: 14px;
      padding: 12px;
      background: #fff;
    }

    #${TOOLTIP_ID} .entry-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 8px;
    }

    #${TOOLTIP_ID} .entry-word {
      font-size: 1.05rem;
      font-weight: 700;
    }

    #${TOOLTIP_ID} .entry-meta {
      color: #6c6458;
      font-size: 0.84rem;
    }

    #${TOOLTIP_ID} ul {
      margin: 8px 0 0 20px;
      padding: 0;
    }

    #${TOOLTIP_ID} li {
      margin: 4px 0;
    }

    #${TOOLTIP_ID} .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 12px;
    }

    #${TOOLTIP_ID} button {
      appearance: none;
      border: 0;
      border-radius: 999px;
      padding: 9px 14px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
    }

    #${TOOLTIP_ID} .primary-button {
      background: #2f5d62;
      color: #fff;
    }

    #${TOOLTIP_ID} .secondary-button {
      background: #e8e1d3;
      color: #1e1b16;
    }

    #${TOOLTIP_ID} .feedback {
      margin-top: 10px;
      border-radius: 12px;
      background: #f4f7f6;
      padding: 10px 12px;
      color: #35545c;
      font-size: 0.9rem;
    }

    #${TOOLTIP_ID} .feedback.error {
      background: #fff0f0;
      color: #9a1f1f;
    }

    #${TOOLTIP_ID} .muted {
      color: #7b7163;
    }

    #${TOOLTIP_ID} .empty {
      color: #6c6458;
      font-style: italic;
    }
  `;
  document.head.appendChild(style);
}



function attachHoverListeners(root) {
  if (!root || root._munmekHoverAttached) {
    return;
  }

  root.addEventListener('mousemove', handleMouseMove);
  root._munmekHoverAttached = true;
}

function observeShadowRoots() {
  scanForShadowRoots();

  const observer = new MutationObserver(() => {
    scanForShadowRoots();
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

function scanForShadowRoots() {
  document.querySelectorAll('*').forEach((element) => {
    if (element.shadowRoot) {
      attachHoverListeners(element.shadowRoot);
    }
  });
}

let mouseMoveScheduled = false;
let lastMouseEvent = null;

function handleMouseMove(event) {
  lastMouseEvent = event;

  if (isMouseOverTooltip) {
    return;
  }

  if (!isModifierPressed(event)) {
    if (tooltip && tooltip.style.display === 'block') {
      scheduleHideTooltip();
    }
    return;
  }

  if (!mouseMoveScheduled) {
    mouseMoveScheduled = true;
    requestAnimationFrame(() => {
      mouseMoveScheduled = false;
      if (lastMouseEvent) {
        processMouseMove(lastMouseEvent);
      }
    });
  }
}

function processMouseMove(event) {
  if (isMouseOverTooltip) {
    return;
  }

  const range = getRangeFromPoint(event.view?.document || document, event.clientX, event.clientY);
  const hoverContext = extractHoverContext(range);

  if (!hoverContext) {
    scheduleHideTooltip();
    return;
  }

  const hoverState = buildHoverState(hoverContext, event.clientX, event.clientY);
  const signature = `${hoverState.word}|${hoverState.sentenceKey}`;

  if (signature === lastHoverSignature && tooltip && tooltip.style.display === 'block') {
    cancelHideTooltip();
    lastTooltipPosition = { x: event.clientX, y: event.clientY };
    positionTooltip(event.clientX, event.clientY);
    currentHoverState = hoverState;
    triggerIndexedDbLookup(hoverState);
    return;
  }

  cancelHideTooltip();
  lastHoverSignature = signature;
  currentHoverState = hoverState;
  lastTooltipPosition = { x: event.clientX, y: event.clientY };
  renderTooltip(hoverState);

  // Trigger IndexedDB lookup and ONNX neural reranking
  triggerIndexedDbLookup(hoverState);
  triggerProgressiveReranking(hoverState);
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

      // No offline dictionary hits found. Update reason.
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
            const updatedLookup = findBestDictionaryEntryFromCandidates(response.candidates, state.word);
            currentHoverState.candidateList = response.candidates;
            if (updatedLookup.entry) {
              currentHoverState.dictionaryEntry = updatedLookup.entry;
              currentHoverState.dictionaryMatch = updatedLookup.match;
              currentHoverState.lookupReason = updatedLookup.reason || 'KoELECTRA Neural Reranked';
            }
            rerenderCurrentTooltip();
          }
        }
      }
    );
  }
}

function getRangeFromPoint(doc, x, y) {
  try {
    if (doc.caretRangeFromPoint) {
      return doc.caretRangeFromPoint(x, y);
    }

    if (doc.caretPositionFromPoint) {
      const position = doc.caretPositionFromPoint(x, y);
      if (position && position.offsetNode) {
        const range = doc.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.setEnd(position.offsetNode, position.offset);
        return range;
      }
    }
  } catch (error) {
    return null;
  }

  return null;
}

function extractHoverContext(range) {
  if (!range) {
    return null;
  }

  const node = range.startContainer;
  if (!node || node.nodeType !== Node.TEXT_NODE) {
    return null;
  }

  const textContent = node.textContent || '';
  if (!textContent.trim()) {
    return null;
  }

  const offset = Math.min(range.startOffset || 0, textContent.length);
  const wordChar = /[\p{L}\p{N}\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/u;

  let start = offset;
  while (start > 0 && wordChar.test(textContent[start - 1])) {
    start--;
  }

  let end = offset;
  while (end < textContent.length && wordChar.test(textContent[end])) {
    end++;
  }

  const word = textContent.slice(start, end).trim();
  if (!word) {
    return null;
  }

  let containerEl = node.parentElement;
  let asbplayerContainer = null;
  const blockTags = new Set(['P', 'DIV', 'LI', 'SECTION', 'ARTICLE', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'MAIN']);

  while (containerEl && containerEl !== document.body) {
    if (
      containerEl.classList &&
      Array.from(containerEl.classList).some((cls) => cls.includes('asbplayer-subtitles') || cls.includes('asbplayer-subtitle'))
    ) {
      asbplayerContainer = containerEl;
      break;
    }
    if (blockTags.has(containerEl.tagName)) {
      break;
    }
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
  if (!normalized) {
    return {
      currentSentence: sentenceFragment,
      prevSentence: '',
      nextSentence: ''
    };
  }

  const sentences = normalized
    .split(/(?<=[.!?。？！])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (sentences.length === 0) {
    return {
      currentSentence: normalized,
      prevSentence: '',
      nextSentence: ''
    };
  }

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
  const lookup = findBestDictionaryEntry(word, sentence);
  const sentenceKey = normalizeText(sentence || word);

  return {
    word,
    sentence,
    sentenceKey,
    prevSentence: normalizeText(context.prevSentence),
    nextSentence: normalizeText(context.nextSentence),
    dictionaryEntry: lookup.entry,
    dictionaryMatch: lookup.match,
    candidateList: lookup.candidates,
    lookupReason: lookup.reason,
    x,
    y,
    feedback: '',
    feedbackType: 'info'
  };
}

let currentSelectedDictionaryId = 'all';

if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
  chrome.storage.local.get(['selectedDictionaryId'], (res) => {
    if (res && res.selectedDictionaryId) currentSelectedDictionaryId = res.selectedDictionaryId;
  });
  if (chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes) => {
      if (changes.selectedDictionaryId) currentSelectedDictionaryId = changes.selectedDictionaryId.newValue || 'all';
    });
  }
}

function findBestDictionaryEntry(surface, sentenceContext = '') {
  const candidates = generateCandidates(surface, sentenceContext);
  return {
    entry: null,
    match: '',
    reason: 'Looking up in IndexedDB...',
    candidates
  };
}

function generateCandidates(surface, sentenceContext = '') {
  if (typeof window !== 'undefined' && window.KoreanPipeline) {
    const pipelineResults = window.KoreanPipeline.analyzeKoreanWord(surface, sentenceContext);
    if (pipelineResults && pipelineResults.length > 0) {
      return pipelineResults;
    }
  }

  const candidates = [];
  const push = (text, reason, score) => {
    const normalized = normalizeText(text);
    if (!normalized || candidates.some((candidate) => candidate.text === normalized)) {
      return;
    }

    candidates.push({ text: normalized, reason, score });
  };

  push(surface, 'surface form', 100);

  const particleSuffixes = ['으로부터', '에게서', '한테서', '에서', '에게', '한테', '까지', '부터', '으로', '로', '보다', '처럼', '같이', '만', '도', '은', '는', '이', '가', '을', '를', '의', '과', '와'];
  for (const suffix of particleSuffixes) {
    if (surface.length > suffix.length + 1 && surface.endsWith(suffix)) {
      push(surface.slice(0, -suffix.length), `removed particle ${suffix}`, 80);
    }
  }

  const politeVerbRules = [
    { suffix: '합니다', replacement: '하다' },
    { suffix: '합니다만', replacement: '하다' },
    { suffix: '해요', replacement: '하다' },
    { suffix: '하세요', replacement: '하다' },
    { suffix: '어요', replacement: '다' },
    { suffix: '아요', replacement: '다' },
    { suffix: '었어요', replacement: '다' },
    { suffix: '았어요', replacement: '다' },
    { suffix: '였어요', replacement: '다' },
    { suffix: '했다', replacement: '하다' },
    { suffix: '했다면', replacement: '하다' }
  ];

  for (const rule of politeVerbRules) {
    if (surface.endsWith(rule.suffix)) {
      const baseGuess = rule.replacement === '하다'
        ? surface.replace(new RegExp(`${rule.suffix}$`), '하다')
        : `${surface.slice(0, -rule.suffix.length)}${rule.replacement}`;
      push(baseGuess, `verb ending ${rule.suffix}`, 70);
    }
  }

  if (surface.endsWith('요') && surface.length > 1) {
    push(surface.slice(0, -1), 'removed polite ending 요', 60);
  }

  candidates.sort((a, b) => b.score - a.score || a.text.length - b.text.length);
  return candidates;
}

const pendingQuickFallbacks = new Map();

function triggerQuickGeminiFallback(state) {
  if (!state || !state.word || pendingQuickFallbacks.has(state.word)) return;
  const bestCandidate = (state.candidateList && state.candidateList[0]) ? state.candidateList[0].text : state.word;

  pendingQuickFallbacks.set(state.word, true);

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage(
      {
        type: 'quickGeminiFallback',
        data: {
          word: bestCandidate,
          sentence: state.sentence
        }
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

function renderTooltip(state) {
  ensureTooltip();

  const analysis = sentenceAnalysisCache.get(state.sentenceKey) || null;
  let dictHtml = '';

  if (Array.isArray(state.dictionaryEntries) && state.dictionaryEntries.length > 0) {
    dictHtml = renderDictionaryEntriesGrouped(state.dictionaryEntries, state.dictionaryMatch || state.lookupReason);
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
    state.sentence ? `<div class="subtitle">${escapeHtml(truncate(state.sentence, 180))}</div>` : '',
    renderActions(state, Boolean(analysis)),
    renderAnalysisSection(analysis),
    state.feedback ? `<div class="feedback ${state.feedbackType === 'error' ? 'error' : ''}">${escapeHtml(state.feedback)}</div>` : ''
  ].filter(Boolean).join('');

  tooltip.innerHTML = html;
  tooltip.style.display = 'block';
  positionTooltip(state.x, state.y);
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

function renderDictionaryEntriesGrouped(entries, matchLabel) {
  const dictGroups = groupEntriesByDictTitle(entries);
  if (dictGroups.length === 0) return '<div class="section empty">No definitions available.</div>';

  const selectedGroupIdx = (currentHoverState && typeof currentHoverState.selectedGroupIndex === 'number')
    ? currentHoverState.selectedGroupIndex
    : 0;
  const validGroupIdx = (selectedGroupIdx >= 0 && selectedGroupIdx < dictGroups.length) ? selectedGroupIdx : 0;
  const activeGroup = dictGroups[validGroupIdx];

  let topTabsHtml = '';
  if (dictGroups.length > 1) {
    topTabsHtml = `<div class="dict-group-tabs" style="display: flex; gap: 6px; margin-bottom: 10px; flex-wrap: wrap;">
      ${dictGroups.map((g, idx) => {
        const isActive = idx === validGroupIdx;
        return `<button type="button" class="dict-group-tab" data-action="select-dict-group-tab" data-group-index="${idx}" style="cursor: pointer; font-size: 0.78rem; font-weight: 700; padding: 4px 12px; border-radius: 8px; border: 1px solid ${isActive ? '#2f5d62' : '#ddd3c4'}; background: ${isActive ? '#2f5d62' : '#fff'}; color: ${isActive ? '#fff' : '#4f463a'};">Dict: ${escapeHtml(g.title)}</button>`;
      }).join('')}
    </div>`;
  }

  const itemsHtml = activeGroup.items.map((entry, itemIdx) => renderSingleEntryCard(entry, matchLabel, itemIdx)).join('');

  return `
    <div class="dictionary-container">
      ${topTabsHtml}
      ${itemsHtml}
    </div>
  `;
}

function formatDefinitionText(rawDef) {
  if (!rawDef || typeof rawDef !== 'string') return '';
  let str = rawDef.trim();
  // Separate headword translation ending with 。 or 】 before explanation sentence
  str = str.replace(/([。】])(?=[^\s。】\d\n])/g, '$1\n');
  // Format Sentence / 文型 patterns onto new lines
  str = str.replace(/\s*(文型|Sentence\s*\d*:?)/gi, '\n$1 ').trim();
  // Separate camelCase word transitions (e.g. gestureTo -> gesture\nTo)
  str = str.replace(/(?<=[a-z가-힣])(?=[A-Z])/g, '\n');
  return str;
}

function splitEmbeddedDefinitions(defList) {
  if (!Array.isArray(defList) || defList.length === 0) return [];
  const result = [];

  defList.forEach((defStr) => {
    if (!defStr || typeof defStr !== 'string') return;
    const subDefs = defStr.split(/(?<=\D|^)(?=\b\d{1,2}[\.\)]\s+)/g);
    subDefs.forEach((sub) => {
      let cleaned = sub.trim();
      if (!cleaned) return;
      cleaned = cleaned.replace(/^[\d]+[\.\)]\s*/, '').trim();
      if (cleaned && /[a-zA-Z가-힣ㄱ-ㅎㅏ-ㅣ\u3040-\u30ff\u4e00-\u9faf]/.test(cleaned)) {
        result.push(formatDefinitionText(cleaned));
      }
    });
  });

  return result.length > 0 ? result : defList.map(formatDefinitionText);
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

function renderSingleEntryCard(entry, matchLabel, itemIndex = 0) {
  const rawDefinitions = Array.isArray(entry.definitions) ? entry.definitions : [];
  const definitions = splitEmbeddedDefinitions(rawDefinitions);
  const selectedIndexKey = `selectedDefIndex_${itemIndex}`;
  const selectedIndex = (currentHoverState && typeof currentHoverState[selectedIndexKey] === 'number')
    ? currentHoverState[selectedIndexKey]
    : 0;

  const validIndex = (selectedIndex >= 0 && selectedIndex < definitions.length) ? selectedIndex : 0;
  const selectedDef = definitions[validIndex] || '';

  const chips = [entry.pos, entry.type, matchLabel].filter(Boolean).map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join('');

  const tabsHtml = definitions.length > 1
    ? `<div class="def-tabs" style="display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; padding-bottom: 4px;">
        ${definitions.map((def, idx) => {
          const isActive = idx === validIndex;
          const shortText = truncate(def, 22);
          return `<button type="button" class="def-tab" data-action="select-def-tab" data-item-index="${itemIndex}" data-def-index="${idx}" style="cursor: pointer; font-size: 0.76rem; font-weight: 700; padding: 4px 8px; border-radius: 6px; border: 1px solid ${isActive ? '#2f5d62' : '#ddd3c4'}; background: ${isActive ? '#2f5d62' : '#fff'}; color: ${isActive ? '#fff' : '#4f463a'};">Def ${idx + 1}: ${escapeHtml(shortText)}</button>`;
        }).join('')}
       </div>`
    : '';

  const definitionBoxHtml = definitions.length > 0
    ? `<div class="section">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <div class="label" style="margin: 0;">Definition ${definitions.length > 1 ? `(${validIndex + 1} of ${definitions.length})` : ''}</div>
          <button type="button" class="chip" data-action="anki-def" data-item-index="${itemIndex}" data-def-index="${validIndex}" title="Add or update this specific definition in Anki" style="cursor: pointer; font-size: 0.76rem; padding: 2px 8px; border: none; background: #2f5d62; color: #fff; border-radius: 6px;">+ Anki</button>
        </div>
        ${tabsHtml}
        <div style="font-size: 0.94rem; font-weight: 500; color: #1e1b16; background: #faf7f2; border: 1px solid #eadfce; border-left: 4px solid #2f5d62; border-radius: 8px; padding: 10px 12px; line-height: 1.5; white-space: pre-line;">
          ${escapeHtml(selectedDef)}
        </div>
       </div>`
    : '<div class="section empty">No definition text available.</div>';

  return `
    <div class="section entry-box" style="border-left: 4px solid #2f5d62; padding-left: 12px; background: #faf7f2; border-radius: 8px; border: 1px solid #eadfce; margin-bottom: 8px;">
      <div class="entry-head">
        <div class="entry-word" style="font-weight: 700;">${escapeHtml(entry.surface || '')}${entry.base && entry.base !== entry.surface ? ` <span class="muted">(${escapeHtml(entry.base)})</span>` : ''}</div>
      </div>
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
        <div style="font-size: 0.94rem; font-weight: 500; color: #1e1b16; background: #fff; border: 1px solid #fcd34d; border-radius: 8px; padding: 10px 12px; line-height: 1.5; white-space: pre-line;">
          ${escapeHtml(formatDefinitionText(norm.translation || 'No definition available.'))}
        </div>
      </div>
      ${norm.hanja ? `<div class="section"><div class="label">Hanja</div><div>${escapeHtml(norm.hanja)}</div></div>` : ''}
      ${norm.grammar ? `<div class="section"><div class="label">Grammar Notes</div><div>${escapeHtml(norm.grammar)}</div></div>` : ''}
    </div>
  `;
}

function renderDictionaryCandidates(candidates, reason) {
  const limited = candidates.slice(0, 4);
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
  const aiLabel = hasCachedAnalysis ? 'Refresh Gemini' : 'Ask Gemini';
  return `
    <div class="section">
      <div class="actions" style="display: flex; gap: 8px; flex-wrap: wrap;">
        <button class="primary-button" data-action="analyze">${escapeHtml(aiLabel)}</button>
        <button class="secondary-button" data-action="anki-dict" title="Send selected offline dictionary definition to Anki">Send to Anki (Dict)</button>
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

  let translationStr = '';
  if (typeof target.translation === 'string') {
    translationStr = target.translation;
  } else if (typeof target.definition === 'string') {
    translationStr = target.definition;
  } else if (Array.isArray(target.definitions)) {
    translationStr = target.definitions.join('; ');
  } else if (Array.isArray(target.meanings)) {
    translationStr = target.meanings.join('; ');
  }

  let grammarStr = '';
  if (typeof target.grammar === 'string') {
    grammarStr = target.grammar;
  } else if (typeof target.grammar_notes === 'string') {
    grammarStr = target.grammar_notes;
  } else if (target.conjugation && typeof target.conjugation === 'object') {
    const ending = target.conjugation.ending ? `Ending ${target.conjugation.ending}: ` : '';
    const exp = target.conjugation.explanation || '';
    grammarStr = `${ending}${exp}`.trim();
  }

  let notesStr = typeof target.notes === 'string' ? target.notes : '';
  if (target.grammar_notes && grammarStr !== target.grammar_notes) {
    notesStr = [notesStr, target.grammar_notes].filter(Boolean).join('\n');
  }

  let hanjaStr = typeof target.hanja === 'string' ? target.hanja : '';

  return {
    translation: translationStr,
    grammar: grammarStr,
    notes: notesStr,
    hanja: hanjaStr,
    related_words: target.related_words || {},
    examples: Array.isArray(target.examples) ? target.examples : []
  };
}

function renderAnalysisSection(rawAnalysis) {
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
    const currentWord = normalizeText(currentHoverState ? currentHoverState.word : '');
    let targetItem = wordsAnalysis.find((item) => {
      const s = normalizeText(item.surface || item.word || '');
      const b = normalizeText(item.base || '');
      if (!s && !b) return false;
      if (s === currentWord || b === currentWord) return true;
      if (currentWord.startsWith(s) || s.startsWith(currentWord)) return true;
      if (currentWord.includes(s) || s.includes(currentWord)) return true;

      const cleanW = currentWord.replace(/(은|는|이|가|을|를|의|에|에서|와|과|도|만|으로|로)$/, '');
      const cleanS = s.replace(/(은|는|이|가|을|를|의|에|에서|와|과|도|만|으로|로)$/, '');
      return cleanW && cleanS && cleanW === cleanS;
    });

    if (!targetItem) {
      return `<div class="section empty" style="font-size:0.86rem;">Sentence breakdown cached (${wordsAnalysis.length} words), but no entry matching "${escapeHtml(currentWord)}" was returned.</div>`;
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
          <span style="font-weight: 700; color: #17383b; font-size: 0.96rem;">
            Gemini: ${escapeHtml(surface)} ${base && base !== surface ? `<span class="muted" style="font-weight:400;">(${escapeHtml(base)})</span>` : ''}
          </span>
          ${pos ? `<span class="chip" style="font-size: 0.74rem; background: #2f5d62; color: #fff;">${escapeHtml(pos)}</span>` : ''}
        </div>

        ${defs.length > 0
          ? `<ul style="margin: 4px 0 6px 18px; padding: 0; color: #1e1b16; font-size: 0.88rem; line-height: 1.4;">
              ${defs.map((d) => `<li><strong>${escapeHtml(d)}</strong></li>`).join('')}
             </ul>`
          : ''}

        ${conj && typeof conj === 'object' && (conj.ending || conj.explanation)
          ? `<div style="font-size: 0.82rem; color: #17383b; margin-top: 6px; background: #e4f0ee; padding: 6px 10px; border-radius: 8px;">
              <strong>Grammar:</strong> ${conj.ending ? `Ending <code>${escapeHtml(conj.ending)}</code> — ` : ''}${escapeHtml(conj.explanation || '')}
             </div>`
          : ''}

        ${notes
          ? `<div style="font-size: 0.82rem; color: #4f463a; margin-top: 6px; font-style: italic; background: #fff; padding: 6px 10px; border-radius: 8px; border: 1px solid #eadfce;">
              <strong>Context Note:</strong> ${escapeHtml(notes)}
             </div>`
          : ''}

        ${(() => {
          const reservedKeys = new Set(['words_analysis', 'words', 'analysis', 'surface', 'word', 'base', 'pos', 'definitions', 'definition', 'conjugation', 'notes', 'grammar_notes', 'id']);
          const customCards = [];
          const scanObj = (obj) => {
            if (!obj || typeof obj !== 'object') return;
            for (const [k, v] of Object.entries(obj)) {
              if (!reservedKeys.has(k) && v) {
                const title = k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                const valStr = typeof v === 'string' ? v : (Array.isArray(v) ? v.join('; ') : JSON.stringify(v));
                customCards.push(`
                  <div style="font-size: 0.82rem; color: #17383b; margin-top: 6px; background: #e8f3f1; padding: 6px 10px; border-radius: 8px; border: 1px solid #bce0da;">
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

function ensureTooltip() {
  if (tooltip) {
    return;
  }

  tooltip = document.createElement('div');
  tooltip.id = TOOLTIP_ID;
  tooltip.className = 'munmek-tooltip';
  tooltip.addEventListener('mouseenter', () => {
    isMouseOverTooltip = true;
    cancelHideTooltip();
  });
  tooltip.addEventListener('mouseleave', () => {
    isMouseOverTooltip = false;
    scheduleHideTooltip();
  });
  tooltip.addEventListener('click', handleTooltipClick);
  document.body.appendChild(tooltip);
}

function handleTooltipClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const selectedCandidate = target.getAttribute('data-candidate');
  if (selectedCandidate && currentHoverState) {
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
        if (res && res.hits && res.hits.length > 0) {
          if (currentHoverState) {
            currentHoverState.dictionaryEntries = res.hits;
            currentHoverState.dictionaryEntry = res.hits[0];
            currentHoverState.lookupReason = `Selected Candidate (${res.hits[0].dictTitle || 'Local'})`;
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
              currentHoverState.dictionaryEntries = resBase.hits;
              currentHoverState.dictionaryEntry = resBase.hits[0];
              currentHoverState.lookupReason = `Selected Candidate (${resBase.hits[0].dictTitle || 'Local'})`;
              rerenderCurrentTooltip();
            } else if (currentHoverState) {
              currentHoverState.dictionaryEntries = [];
              currentHoverState.dictionaryEntry = null;
              currentHoverState.lookupReason = `Selected candidate "${selectedCandidate}" (No offline match, running Quick LLM Lookup...)`;
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
  if (!action || !currentHoverState) {
    return;
  }

  if (action === 'upload-context') {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.txt,.srt,.vtt,.json';
    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        window._munmekTabContextText = evt.target.result || '';
        window._munmekTabContextName = file.name;
        if (currentHoverState) {
          currentHoverState.feedback = `Loaded tab context file: ${file.name}`;
          currentHoverState.feedbackType = 'info';
          rerenderCurrentTooltip();
        }
      };
      reader.readAsText(file);
    };
    fileInput.click();
    return;
  }

  if (action === 'select-dict-group-tab') {
    const idx = parseInt(target.getAttribute('data-group-index'), 10);
    if (currentHoverState) {
      currentHoverState.selectedGroupIndex = idx;
      const dictGroups = groupEntriesByDictTitle(currentHoverState.dictionaryEntries || []);
      if (dictGroups[idx] && dictGroups[idx].items[0]) {
        currentHoverState.dictionaryEntry = dictGroups[idx].items[0];
      }
      rerenderCurrentTooltip();
    }
    return;
  }

  if (action === 'select-def-tab') {
    const idxStr = target.getAttribute('data-def-index');
    const itemIdxStr = target.getAttribute('data-item-index') || '0';
    if (idxStr !== null && currentHoverState) {
      const itemIdx = Number(itemIdxStr);
      const defIdx = Number(idxStr);
      currentHoverState[`selectedDefIndex_${itemIdx}`] = defIdx;

      const dictGroups = groupEntriesByDictTitle(currentHoverState.dictionaryEntries || []);
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
    const splitDefs = splitEmbeddedDefinitions(rawDefs);
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

    const dictGroups = groupEntriesByDictTitle(currentHoverState.dictionaryEntries || []);
    const selectedGroupIdx = currentHoverState.selectedGroupIndex || 0;
    const activeGroup = dictGroups[selectedGroupIdx];
    const targetEntry = (activeGroup && activeGroup.items[itemIdx]) || currentHoverState.dictionaryEntry;

    const rawDefs = Array.isArray(targetEntry?.definitions) ? targetEntry.definitions : [];
    const splitDefs = splitEmbeddedDefinitions(rawDefs);
    const selectedDef = splitDefs[defIndex] || (rawDefs[defIndex] || null);

    currentHoverState.dictionaryEntry = targetEntry;
    sendCardToAnki(currentHoverState, selectedDef, 'dict');
  }
}

function requestSentenceAnalysis(state, onSuccess = null) {
  if (sentenceAnalysisCache.has(state.sentenceKey) && !pendingAnalysisRequests.has(state.sentenceKey)) {
    currentHoverState.feedback = 'Using cached Gemini analysis for this sentence.';
    currentHoverState.feedbackType = 'info';
    renderTooltip(currentHoverState);
    if (typeof onSuccess === 'function') onSuccess();
    return;
  }

  if (pendingAnalysisRequests.has(state.sentenceKey)) {
    currentHoverState.feedback = 'Gemini analysis is already in progress.';
    currentHoverState.feedbackType = 'info';
    renderTooltip(currentHoverState);
    return;
  }

  currentHoverState.feedback = 'Loading Gemini analysis...';
  currentHoverState.feedbackType = 'info';
  renderTooltip(currentHoverState);

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

      if (chrome.runtime.lastError) {
        currentHoverState.feedback = `Extension error: ${chrome.runtime.lastError.message}`;
        currentHoverState.feedbackType = 'error';
        renderTooltip(currentHoverState);
        return;
      }

      if (!response || response.error) {
        currentHoverState.feedback = response?.error || 'Gemini request failed.';
        currentHoverState.feedbackType = 'error';
        renderTooltip(currentHoverState);
        return;
      }

      sentenceAnalysisCache.set(state.sentenceKey, response.data);
      currentHoverState.feedback = 'Gemini analysis ready.';
      currentHoverState.feedbackType = 'info';
      renderTooltip(currentHoverState);
      if (typeof onSuccess === 'function') onSuccess();
    }
  );
}

function sendCardToAnki(state, selectedDefinition = null, mode = 'dict') {
  const cachedAnalysis = sentenceAnalysisCache.get(state.sentenceKey) || null;

  currentHoverState.feedback = 'Sending card to Anki...';
  currentHoverState.feedbackType = 'info';
  renderTooltip(currentHoverState);

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
      if (chrome.runtime.lastError) {
        currentHoverState.feedback = `Extension error: ${chrome.runtime.lastError.message}`;
        currentHoverState.feedbackType = 'error';
        renderTooltip(currentHoverState);
        return;
      }

      if (!response || response.error) {
        currentHoverState.feedback = response?.error || 'AnkiConnect request failed.';
        currentHoverState.feedbackType = 'error';
        renderTooltip(currentHoverState);
        return;
      }

      currentHoverState.feedback = response.data?.updated ? 'Updated the last Anki card.' : 'Created a new Anki card.';
      currentHoverState.feedbackType = 'info';
      renderTooltip(currentHoverState);
    }
  );
}

function rerenderCurrentTooltip() {
  if (currentHoverState && tooltip && tooltip.style.display === 'block') {
    renderTooltip(currentHoverState);
  }
}

function positionTooltip(x, y) {
  if (!tooltip) {
    return;
  }

  tooltip.style.visibility = 'hidden';
  tooltip.style.display = 'block';

  const rect = tooltip.getBoundingClientRect();
  const width = rect.width;
  const height = rect.height;

  let left = x + 18;
  let top = y + 18;

  if (left + width > window.innerWidth - 8) {
    left = x - width - 18;
  }

  if (top + height > window.innerHeight - 8) {
    top = y - height - 18;
  }

  left = Math.max(8, left);
  top = Math.max(8, top);

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
  tooltip.style.visibility = 'visible';
}

function scheduleHideTooltip() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hideTooltip();
  }, HIDE_DELAY_MS);
}

function cancelHideTooltip() {
  clearTimeout(hideTimer);
}

function hideTooltip() {
  if (tooltip) {
    tooltip.style.display = 'none';
  }
}

function normalizeText(value) {
  return String(value || '')
    .normalize()
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(value, maxLength) {
  const text = normalizeText(value);
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength)}...`;
}

// Add page & subtitle context extractor message listener
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'extractPageContext') {
      const parts = [];

      // Scrape ASB Player or custom subtitle elements
      const subtitleElements = document.querySelectorAll('.asbplayer-subtitle, [class*="subtitle"], [id*="subtitle"], track');
      subtitleElements.forEach((el) => {
        const t = (el.textContent || '').trim();
        if (t && !parts.includes(t)) parts.push(t);
      });

      // Scrape article paragraph content
      const contentArea = document.querySelector('#bodyContent, article, main') || document.body;
      const paragraphs = contentArea.querySelectorAll('p, h1, h2, h3');
      paragraphs.forEach((p) => {
        const t = (p.textContent || '').trim();
        if (t && t.length > 15 && !parts.includes(t)) parts.push(t);
      });

      const fullContext = parts.join('\n\n').slice(0, 20000);
      sendResponse({ text: fullContext, name: document.title || 'Webpage Content' });
      return true;
    }
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
