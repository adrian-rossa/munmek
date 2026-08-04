const DICTIONARY_URL = chrome.runtime.getURL('korean_words.json');
const HIDE_DELAY_MS = 220;
const TOOLTIP_ID = 'munmek-tooltip';
const STYLE_ID = 'munmek-tooltip-style';

const sentenceAnalysisCache = new Map();
const pendingAnalysisRequests = new Map();

let dictionaryEntries = [];
let dictionaryIndex = { bySurface: new Map(), byBase: new Map() };
let dictionaryReady = false;
let dictionaryLoadError = '';

let tooltip = null;
let hideTimer = null;
let currentHoverState = null;
let lastHoverSignature = '';
let lastTooltipPosition = { x: 0, y: 0 };

function init() {
  injectTooltipStyles();
  loadDictionary();
  attachHoverListeners(document);
  observeShadowRoots();
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

async function loadDictionary() {
  try {
    const response = await fetch(DICTIONARY_URL);
    if (!response.ok) {
      throw new Error(`Dictionary load failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    dictionaryEntries = Array.isArray(data.words) ? data.words : [];
    dictionaryIndex = buildDictionaryIndex(dictionaryEntries);
    dictionaryReady = true;
    dictionaryLoadError = '';
    rerenderCurrentTooltip();
  } catch (error) {
    dictionaryEntries = [];
    dictionaryIndex = { bySurface: new Map(), byBase: new Map() };
    dictionaryReady = false;
    dictionaryLoadError = error.message;
    rerenderCurrentTooltip();
  }
}

function buildDictionaryIndex(entries) {
  const bySurface = new Map();
  const byBase = new Map();

  for (const entry of entries) {
    const surface = normalizeText(entry.surface || '');
    const base = normalizeText(entry.base || '');

    if (surface) {
      if (!bySurface.has(surface)) {
        bySurface.set(surface, []);
      }
      bySurface.get(surface).push(entry);
    }

    if (base) {
      if (!byBase.has(base)) {
        byBase.set(base, []);
      }
      byBase.get(base).push(entry);
    }
  }

  return { bySurface, byBase };
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

function handleMouseMove(event) {
  const range = getRangeFromPoint(event.view?.document || document, event.clientX, event.clientY);
  const hoverContext = extractHoverContext(range);

  if (!hoverContext) {
    scheduleHideTooltip();
    return;
  }

  const hoverState = buildHoverState(hoverContext, event.clientX, event.clientY);
  const signature = `${hoverState.word}|${hoverState.sentenceKey}`;

  if (signature === lastHoverSignature && tooltip && tooltip.style.display === 'block') {
    lastTooltipPosition = { x: event.clientX, y: event.clientY };
    positionTooltip(event.clientX, event.clientY);
    currentHoverState = hoverState;
    return;
  }

  lastHoverSignature = signature;
  currentHoverState = hoverState;
  lastTooltipPosition = { x: event.clientX, y: event.clientY };
  renderTooltip(hoverState);
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

  const paragraphText = normalizeText(node.parentElement?.textContent || textContent);
  const sentenceWindow = getSentenceWindow(paragraphText, word);

  return {
    word,
    sentence: sentenceWindow.currentSentence,
    prevSentence: sentenceWindow.prevSentence,
    nextSentence: sentenceWindow.nextSentence,
    paragraphText
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
  const lookup = findBestDictionaryEntry(word);
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

function findBestDictionaryEntry(surface) {
  const candidates = generateCandidates(surface);

  for (const candidate of candidates) {
    const surfaceHits = dictionaryIndex.bySurface.get(candidate.text);
    if (surfaceHits && surfaceHits.length > 0) {
      return {
        entry: surfaceHits[0],
        match: candidate.text,
        candidates,
        reason: candidate.reason
      };
    }

    const baseHits = dictionaryIndex.byBase.get(candidate.text);
    if (baseHits && baseHits.length > 0) {
      return {
        entry: baseHits[0],
        match: candidate.text,
        candidates,
        reason: candidate.reason
      };
    }
  }

  return {
    entry: null,
    match: '',
    candidates,
    reason: candidates.length > 0 ? candidates[0].reason : 'No candidate match'
  };
}

function generateCandidates(surface) {
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

function renderTooltip(state) {
  ensureTooltip();

  const analysis = sentenceAnalysisCache.get(state.sentenceKey) || null;
  const html = [
    `<div class="title">${escapeHtml(state.word || '...')}</div>`,
    state.sentence ? `<div class="subtitle">${escapeHtml(truncate(state.sentence, 180))}</div>` : '',
    state.dictionaryEntry ? renderDictionaryEntry(state.dictionaryEntry, state.dictionaryMatch || state.lookupReason) : renderDictionaryCandidates(state.candidateList, state.lookupReason),
    renderActions(state, Boolean(analysis)),
    renderAnalysisSection(analysis),
    state.feedback ? `<div class="feedback ${state.feedbackType === 'error' ? 'error' : ''}">${escapeHtml(state.feedback)}</div>` : '',
    dictionaryLoadError ? `<div class="feedback error">Dictionary load error: ${escapeHtml(dictionaryLoadError)}</div>` : ''
  ].filter(Boolean).join('');

  tooltip.innerHTML = html;
  tooltip.style.display = 'block';
  positionTooltip(state.x, state.y);
}

function renderDictionaryEntry(entry, matchLabel) {
  const definitions = Array.isArray(entry.definitions) ? entry.definitions : [];
  const chips = [entry.pos, entry.type, matchLabel].filter(Boolean).map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join('');

  return `
    <div class="section entry-box">
      <div class="entry-head">
        <div class="entry-word">${escapeHtml(entry.surface || '')}${entry.base && entry.base !== entry.surface ? ` <span class="muted">(${escapeHtml(entry.base)})</span>` : ''}</div>
      </div>
      <div class="chips">${chips}</div>
      ${entry.hanja ? `<div class="section"><div class="label">Hanja</div><div>${escapeHtml(entry.hanja)}</div></div>` : ''}
      ${definitions.length > 0 ? `<div class="section"><div class="label">Definition</div><ul>${definitions.map((definition) => `<li>${escapeHtml(definition)}</li>`).join('')}</ul></div>` : '<div class="section empty">No definition text in the local sample dictionary yet.</div>'}
      ${entry.grammar_notes ? `<div class="section"><div class="label">Notes</div><div>${escapeHtml(entry.grammar_notes)}</div></div>` : ''}
    </div>
  `;
}

function renderDictionaryCandidates(candidates, reason) {
  const limited = candidates.slice(0, 4);
  return `
    <div class="section entry-box">
      <div class="label">Local lookup</div>
      <div class="empty">${escapeHtml(reason || 'No exact dictionary hit yet.')}.</div>
      <div class="chips">
        ${limited.map((candidate) => `<span class="chip">${escapeHtml(candidate.text)}</span>`).join('')}
      </div>
    </div>
  `;
}

function renderActions(state, hasCachedAnalysis) {
  const aiLabel = hasCachedAnalysis ? 'Refresh Gemini' : 'Ask Gemini';
  return `
    <div class="section">
      <div class="actions">
        <button class="primary-button" data-action="analyze">${escapeHtml(aiLabel)}</button>
        <button class="secondary-button" data-action="anki">Send to Anki</button>
      </div>
    </div>
  `;
}

function renderAnalysisSection(analysis) {
  if (!analysis) {
    return '<div class="section empty">Ask Gemini for a richer, context-aware explanation.</div>';
  }

  if (analysis.error) {
    return `<div class="section feedback error">${escapeHtml(analysis.error)}</div>`;
  }

  const parts = [];
  const translation = analysis.translation || analysis.definition;
  const grammar = analysis.grammar || analysis.grammar_notes;
  const notes = analysis.notes;
  const hanja = analysis.hanja;
  const relatedWords = analysis.related_words || {};
  const examples = Array.isArray(analysis.examples) ? analysis.examples : [];

  if (translation) {
    parts.push(`<div><div class="label">Gemini meaning</div><div>${escapeHtml(translation)}</div></div>`);
  }

  if (grammar) {
    parts.push(`<div><div class="label">Grammar</div><div>${escapeHtml(grammar)}</div></div>`);
  }

  if (hanja) {
    parts.push(`<div><div class="label">Hanja</div><div>${escapeHtml(hanja)}</div></div>`);
  }

  if (notes) {
    parts.push(`<div><div class="label">Notes</div><div>${escapeHtml(notes)}</div></div>`);
  }

  if (relatedWords.synonyms || relatedWords.antonyms) {
    const synonymList = Array.isArray(relatedWords.synonyms) ? relatedWords.synonyms : [];
    const antonymList = Array.isArray(relatedWords.antonyms) ? relatedWords.antonyms : [];
    if (synonymList.length > 0 || antonymList.length > 0) {
      parts.push(`
        <div>
          <div class="label">Related words</div>
          ${synonymList.length > 0 ? `<div class="muted">Synonyms: ${escapeHtml(synonymList.join(', '))}</div>` : ''}
          ${antonymList.length > 0 ? `<div class="muted">Antonyms: ${escapeHtml(antonymList.join(', '))}</div>` : ''}
        </div>
      `);
    }
  }

  if (examples.length > 0) {
    parts.push(`<div><div class="label">Examples</div><ul>${examples.map((example) => `<li>${escapeHtml(example)}</li>`).join('')}</ul></div>`);
  }

  if (parts.length === 0) {
    parts.push(`<div class="empty">${escapeHtml(JSON.stringify(analysis, null, 2))}</div>`);
  }

  return `<div class="section entry-box">${parts.join('')}</div>`;
}

function ensureTooltip() {
  if (tooltip) {
    return;
  }

  tooltip = document.createElement('div');
  tooltip.id = TOOLTIP_ID;
  tooltip.className = 'munmek-tooltip';
  tooltip.addEventListener('mouseenter', cancelHideTooltip);
  tooltip.addEventListener('mouseleave', scheduleHideTooltip);
  tooltip.addEventListener('click', handleTooltipClick);
  document.body.appendChild(tooltip);
}

function handleTooltipClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  const action = target.getAttribute('data-action');
  if (!action || !currentHoverState) {
    return;
  }

  if (action === 'analyze') {
    requestSentenceAnalysis(currentHoverState);
  }

  if (action === 'anki') {
    sendCardToAnki(currentHoverState);
  }
}

function requestSentenceAnalysis(state) {
  if (sentenceAnalysisCache.has(state.sentenceKey) && !pendingAnalysisRequests.has(state.sentenceKey)) {
    currentHoverState.feedback = 'Using cached Gemini analysis for this sentence.';
    currentHoverState.feedbackType = 'info';
    renderTooltip(currentHoverState);
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
    }
  );
}

function sendCardToAnki(state) {
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
        dictionaryEntry: state.dictionaryEntry,
        candidate: state.dictionaryMatch,
        analysis: cachedAnalysis
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

  return `${text.slice(0, maxLength - 1)}…`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
