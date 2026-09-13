document.addEventListener('DOMContentLoaded', () => {
  const aiProviderSelect = document.getElementById('aiProvider');
  const geminiSettingsContainer = document.getElementById('geminiSettingsContainer');
  const customAiSettingsContainer = document.getElementById('customAiSettingsContainer');
  const apiKeyInput = document.getElementById('apiKey');
  const modelIdInput = document.getElementById('modelId');
  const geminiModelSelect = document.getElementById('geminiModelSelect');
  const customEndpointUrlInput = document.getElementById('customEndpointUrl');
  const customModelIdInput = document.getElementById('customModelId');
  const customModelSelect = document.getElementById('customModelSelect');
  const customApiKeyInput = document.getElementById('customApiKey');
  const customDisableReasoningInput = document.getElementById('customDisableReasoning');
  const customTemperatureInput = document.getElementById('customTemperature');
  const customTopPInput = document.getElementById('customTopP');
  const customTopKInput = document.getElementById('customTopK');
  const customMinPInput = document.getElementById('customMinP');
  const customRepeatPenaltyInput = document.getElementById('customRepeatPenalty');
  const customPresencePenaltyInput = document.getElementById('customPresencePenalty');
  const autoTriggerAiOnHoverInput = document.getElementById('autoTriggerAiOnHover');
  const testAiBtn = document.getElementById('testAiBtn');
  const aiTestStatus = document.getElementById('aiTestStatus');
  const aiPromptExtensionInput = document.getElementById('aiPromptExtension');
  const ankiConnectUrlInput = document.getElementById('ankiConnectUrl');
  const testAnkiBtn = document.getElementById('testAnkiBtn');
  const ankiStatus = document.getElementById('ankiStatus');
  const ankiConnectedControls = document.getElementById('ankiConnectedControls');
  const ankiDeckNameSelect = document.getElementById('ankiDeckName');
  const ankiNoteTypeSelect = document.getElementById('ankiNoteType');
  const ankiDefinitionFieldSelect = document.getElementById('ankiDefinitionField');
  const ankiDynamicFieldsContainer = document.getElementById('ankiDynamicFieldsContainer');
  const ankiFieldMappingInput = document.getElementById('ankiFieldMapping');
  const ankiUpdateLastCardInput = document.getElementById('ankiUpdateLastCard');
  const enableOnnxRerankerInput = document.getElementById('enableOnnxReranker');
  const dictFileInput = document.getElementById('dictFileInput');
  const importDictBtn = document.getElementById('importDictBtn');
  const clearDictBtn = document.getElementById('clearDictBtn');
  const dictStatus = document.getElementById('dictStatus');
  const dictListContainer = document.getElementById('dictListContainer');
  const selectedDictionaryIdInput = document.getElementById('selectedDictionaryId');
  const cheaperSummaryModelIdInput = document.getElementById('cheaperSummaryModelId');
  const enableCheaperSummaryModelInput = document.getElementById('enableCheaperSummaryModel');
  const useFullContextInput = document.getElementById('useFullContext');
  const enableWebGpuInput = document.getElementById('enableWebGpu');
  const enableDevModeInput = document.getElementById('enableDevMode');
  const devModeSettingsContainer = document.getElementById('devModeSettingsContainer');
  const tmdbApiKeyInput = document.getElementById('tmdbApiKey');
  const modifierKeyInput = document.getElementById('modifierKey');
  const tooltipFontSizeInput = document.getElementById('tooltipFontSize');
  const saveButton = document.getElementById('save');
  const resetButton = document.getElementById('reset');
  const statusDiv = document.getElementById('status');

  if (geminiModelSelect) {
    geminiModelSelect.addEventListener('change', () => {
      if (geminiModelSelect.value) {
        modelIdInput.value = geminiModelSelect.value;
      }
    });
  }

  if (customModelSelect) {
    customModelSelect.addEventListener('change', () => {
      if (customModelSelect.value) {
        customModelIdInput.value = customModelSelect.value;
      }
    });
  }

  function updateAiProviderVisibility() {
    if (!aiProviderSelect) return;
    const isCustom = aiProviderSelect.value === 'custom';
    if (geminiSettingsContainer) geminiSettingsContainer.style.display = isCustom ? 'none' : 'block';
    if (customAiSettingsContainer) customAiSettingsContainer.style.display = isCustom ? 'block' : 'none';
  }

  if (aiProviderSelect) {
    aiProviderSelect.addEventListener('change', updateAiProviderVisibility);
  }

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const url = btn.getAttribute('data-url');
      const model = btn.getAttribute('data-model');
      if (url && customEndpointUrlInput) customEndpointUrlInput.value = url;
      if (model && customModelIdInput) customModelIdInput.value = model;
    });
  });

  if (testAiBtn) {
    testAiBtn.addEventListener('click', () => {
      const provider = aiProviderSelect ? aiProviderSelect.value : 'gemini';
      const payload = {
        aiProvider: provider,
        apiKey: apiKeyInput ? apiKeyInput.value.trim() : '',
        modelId: modelIdInput ? modelIdInput.value.trim() : '',
        customEndpointUrl: customEndpointUrlInput ? customEndpointUrlInput.value.trim() : '',
        customModelId: customModelIdInput ? customModelIdInput.value.trim() : '',
        customApiKey: customApiKeyInput ? customApiKeyInput.value.trim() : ''
      };
      if (aiTestStatus) {
        aiTestStatus.textContent = 'Testing connection...';
        aiTestStatus.style.color = '#555';
      }
      chrome.runtime.sendMessage({ type: 'testAiEndpoint', data: payload }, (res) => {
        if (!aiTestStatus) return;
        if (chrome.runtime.lastError || !res || !res.success) {
          const err = res?.error || chrome.runtime.lastError?.message || 'Connection failed';
          aiTestStatus.textContent = `✗ Error: ${err}`;
          aiTestStatus.style.color = '#8b261e';
        } else {
          const countStr = typeof res.count === 'number' ? ` (${res.count} model${res.count === 1 ? '' : 's'} available)` : '';
          aiTestStatus.textContent = `✓ Connected successfully!${countStr}`;
          aiTestStatus.style.color = '#2f5d62';

          if (Array.isArray(res.models) && res.models.length > 0) {
            if (provider === 'custom' && customModelSelect) {
              customModelSelect.innerHTML = `<option value="">-- Discovered Models (${res.models.length}) --</option>`;
              res.models.forEach((m) => {
                const opt = document.createElement('option');
                opt.value = m;
                opt.textContent = m;
                if (customModelIdInput && customModelIdInput.value.trim() === m) opt.selected = true;
                customModelSelect.appendChild(opt);
              });
              customModelSelect.style.display = 'block';
            } else if (provider === 'gemini' && geminiModelSelect) {
              geminiModelSelect.innerHTML = `<option value="">-- Discovered Models (${res.models.length}) --</option>`;
              res.models.forEach((m) => {
                const opt = document.createElement('option');
                opt.value = m;
                opt.textContent = m;
                if (modelIdInput && modelIdInput.value.trim() === m) opt.selected = true;
                geminiModelSelect.appendChild(opt);
              });
              geminiModelSelect.style.display = 'block';
            }
          }
        }
      });
    });
  }

  let currentDictOrder = [];
  let savedFieldMapping = {};
  let cachedTrackedGeminiFields = {};

  const FIELD_VALUE_OPTIONS = [
    { value: 'none', label: 'None (Empty)' },
    { value: '{{word}}', label: 'Target Word (Surface Form)' },
    { value: '{{base}}', label: 'Base / Dictionary Form' },
    { value: '{{pos}}', label: 'Part of Speech' },
    { value: '{{definition}}', label: 'Selected Dictionary Definition' },
    { value: '{{sentence}}', label: 'Target Sentence Context' },
    { value: '{{prevSentence}}', label: 'Preceding Sentence (−1)' },
    { value: '{{prevSentence2}}', label: 'Preceding Sentence (−2)' },
    { value: '{{candidate}}', label: 'Selected Candidate Word' }
  ];

  async function updateDictStatus() {
    if (typeof window.DictionaryDB !== 'undefined') {
      try {
        const count = await window.DictionaryDB.getWordCount();
        dictStatus.textContent = `IndexedDB Total Word Count: ${count.toLocaleString()} words loaded`;

        const dicts = await window.DictionaryDB.getDictionaries();
        
        // Sync dict order
        chrome.storage.local.get(['dictionaryOrder'], (res) => {
          let order = res.dictionaryOrder || [];
          const dictIds = dicts.map(d => d.id);
          order = order.filter(id => dictIds.includes(id));
          dictIds.forEach(id => {
            if (!order.includes(id)) order.push(id);
          });
          currentDictOrder = order;
          renderDictList(dicts);
        });
      } catch (err) {
        dictStatus.textContent = `IndexedDB Status Error: ${err.message}`;
      }
    }
  }

  function renderDictList(dicts) {
    if (!selectedDictionaryIdInput || !dictListContainer) return;

    const currentSelected = selectedDictionaryIdInput.value || 'all';
    selectedDictionaryIdInput.innerHTML = '<option value="all">Search All Installed Dictionaries (by Priority Order)</option>';

    if (!Array.isArray(dicts) || dicts.length === 0) {
      dictListContainer.innerHTML = '<div class="hint">No user-imported dictionaries installed yet. Upload a KRDict zip/json file above.</div>';
      return;
    }

    // Sort dicts by currentDictOrder
    const sortedDicts = [...dicts].sort((a, b) => {
      const idxA = currentDictOrder.indexOf(a.id);
      const idxB = currentDictOrder.indexOf(b.id);
      return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB);
    });

    let listHtml = '<div style="display:grid; gap:8px;">';
    sortedDicts.forEach((d, idx) => {
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = `${d.title || d.id} (${(d.wordCount || 0).toLocaleString()} words)`;
      if (d.id === currentSelected) opt.selected = true;
      selectedDictionaryIdInput.appendChild(opt);

      const isDevMode = Boolean(enableDevModeInput && enableDevModeInput.checked);
      const isRerankerEnabled = isDevMode && Boolean(enableOnnxRerankerInput && enableOnnxRerankerInput.checked);
      const vectorSection = document.getElementById('vectorPrecomputationSection');
      if (vectorSection) {
        vectorSection.style.display = isRerankerEnabled ? 'block' : 'none';
      }

      let vectorControlsHtml = '';
      if (isRerankerEnabled) {
        if (d.hasPrecomputedVectors) {
          vectorControlsHtml = `
            <div style="margin-top:6px; display:flex; align-items:center; gap:8px;">
              <span class="chip" style="background:#e6f4ea; color:#137333; font-weight:700;">⚡ Vector Cached</span>
              <button type="button" class="remove-vector-btn" data-id="${escapeHtml(d.id)}" style="background:#8b261e; font-size:0.8rem; padding:4px 8px;">Remove Vectors</button>
            </div>
          `;
        } else {
          vectorControlsHtml = `
            <div style="margin-top:6px; display:flex; align-items:center; gap:8px;">
              <button type="button" class="import-vector-btn" data-id="${escapeHtml(d.id)}" style="background:#2563eb; font-size:0.8rem; padding:4px 10px;">📥 Import Vector File (.vec.bin / .json)</button>
              <input type="file" class="vector-file-input" data-id="${escapeHtml(d.id)}" accept=".json,.bin,.vec.bin" style="display:none;">
            </div>
          `;
        }
      }

      listHtml += `
        <div style="display:flex; flex-direction:column; background:#fff; padding:10px 14px; border-radius:12px; border:1px solid var(--line);">
          <div style="display:flex; align-items:center; justify-content:space-between;">
            <div>
              <strong>${escapeHtml(d.title || d.id)}</strong>
              <span class="muted" style="font-size:0.85rem; margin-left:8px;">${(d.wordCount || 0).toLocaleString()} words</span>
              ${d.targetLanguage ? `<span class="chip" style="margin-left:6px; font-size:0.75rem; text-transform:uppercase; background:#e0f2fe; color:#0369a1;">${escapeHtml(d.targetLanguage)}</span>` : ''}
              <span class="chip" style="margin-left:8px; font-size:0.75rem;">Priority #${idx + 1}</span>
            </div>
            <div style="display:flex; gap:6px;">
              <button type="button" class="move-dict-up" data-index="${idx}" ${idx === 0 ? 'disabled style="opacity:0.5;"' : ''}>▲ Up</button>
              <button type="button" class="move-dict-down" data-index="${idx}" ${idx === sortedDicts.length - 1 ? 'disabled style="opacity:0.5;"' : ''}>▼ Down</button>
              <button type="button" class="delete-dict-btn" data-id="${escapeHtml(d.id)}" style="background:#8b261e;">Delete</button>
            </div>
          </div>
          ${vectorControlsHtml}
        </div>
      `;
    });
    listHtml += '</div>';

    dictListContainer.innerHTML = listHtml;

    // Add reorder event listeners
    dictListContainer.querySelectorAll('.move-dict-up').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        if (idx > 0) {
          const temp = currentDictOrder[idx];
          currentDictOrder[idx] = currentDictOrder[idx - 1];
          currentDictOrder[idx - 1] = temp;
          chrome.storage.local.set({ dictionaryOrder: currentDictOrder }, updateDictStatus);
        }
      });
    });

    dictListContainer.querySelectorAll('.move-dict-down').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.getAttribute('data-index'), 10);
        if (idx < sortedDicts.length - 1) {
          const temp = currentDictOrder[idx];
          currentDictOrder[idx] = currentDictOrder[idx + 1];
          currentDictOrder[idx + 1] = temp;
          chrome.storage.local.set({ dictionaryOrder: currentDictOrder }, updateDictStatus);
        }
      });
    });

    dictListContainer.querySelectorAll('.delete-dict-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const dictId = e.target.getAttribute('data-id');
        if (dictId && confirm(`Are you sure you want to delete this dictionary ("${dictId}")?`)) {
          dictStatus.textContent = `Deleting dictionary ${dictId}...`;
          await window.DictionaryDB.deleteDictionary(dictId);
          currentDictOrder = currentDictOrder.filter(id => id !== dictId);
          chrome.storage.local.set({ dictionaryOrder: currentDictOrder });
          updateDictStatus();
        }
      });
    });

    dictListContainer.querySelectorAll('.import-vector-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const dictId = e.target.getAttribute('data-id');
        const fileInput = dictListContainer.querySelector(`.vector-file-input[data-id="${dictId}"]`);
        if (fileInput) fileInput.click();
      });
    });

    dictListContainer.querySelectorAll('.vector-file-input').forEach((input) => {
      input.addEventListener('change', async (e) => {
        const dictId = e.target.getAttribute('data-id');
        const file = e.target.files ? e.target.files[0] : null;
        if (!file || !dictId) return;

        dictStatus.textContent = `Reading vector file ${file.name}...`;
        try {
          let vectorMap = {};
          if (file.name.endsWith('.vec.bin') || file.name.endsWith('.bin')) {
            const buffer = await file.arrayBuffer();
            const metaLength = new DataView(buffer).getUint32(0, true);
            const metaJsonText = new TextDecoder().decode(new Uint8Array(buffer, 4, metaLength));
            const metaMap = JSON.parse(metaJsonText);
            const vectorBufferOffset = 4 + metaLength;
            const rawInt8Bytes = new Int8Array(buffer, vectorBufferOffset);

            const DIM = 384;
            Object.keys(metaMap).forEach((defStr) => {
              const idx = metaMap[defStr];
              const sliceOffset = idx * DIM;
              vectorMap[defStr] = rawInt8Bytes.subarray(sliceOffset, sliceOffset + DIM);
            });
          } else {
            const content = await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onload = (evt) => resolve(evt.target.result);
              reader.readAsText(file);
            });
            const parsed = JSON.parse(content);
            vectorMap = parsed.vectors || parsed;
          }

          dictStatus.textContent = `Importing precomputed vectors for dictionary "${dictId}"...`;
          const updatedCount = await window.DictionaryDB.importPrecomputedVectorsForDict(dictId, vectorMap);
          dictStatus.textContent = `✓ Imported vectors for ${updatedCount.toLocaleString()} terms in "${dictId}"!`;
          alert(`Successfully imported precomputed vectors for ${updatedCount.toLocaleString()} terms!`);
          updateDictStatus();
        } catch (err) {
          dictStatus.textContent = `Vector import error: ${err.message}`;
          alert(`Vector import error: ${err.message}`);
        }
      });
    });

    dictListContainer.querySelectorAll('.remove-vector-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const dictId = e.target.getAttribute('data-id');
        if (dictId && confirm(`Are you sure you want to remove precomputed vectors for dictionary "${dictId}"?`)) {
          dictStatus.textContent = `Removing precomputed vectors for ${dictId}...`;
          await window.DictionaryDB.removePrecomputedVectors(dictId);
          dictStatus.textContent = `Precomputed vectors removed for ${dictId}.`;
          updateDictStatus();
        }
      });
    });
  }

  updateDictStatus();

  if (clearDictBtn) {
    clearDictBtn.addEventListener('click', async () => {
      if (confirm('Are you sure you want to clear all imported IndexedDB dictionaries?')) {
        dictStatus.textContent = 'Clearing dictionaries...';
        try {
          await window.DictionaryDB.clearDictionary();
          currentDictOrder = [];
          chrome.storage.local.set({ dictionaryOrder: [] });
          updateDictStatus();
          alert('All dictionaries cleared successfully!');
        } catch (err) {
          alert(`Error clearing dictionaries: ${err.message}`);
        }
      }
    });
  }

  if (importDictBtn) {
    importDictBtn.addEventListener('click', async () => {
      const files = dictFileInput.files;
      if (!files || files.length === 0) {
        alert('Please select one or more dictionary file(s) (.json or .zip) first.');
        return;
      }

      try {
        dictStatus.textContent = 'Preparing files for dictionary import...';
        let allTermBanksData = [];
        let detectedTitle = null;
        let detectedSourceLang = null;
        let detectedTargetLang = null;

        for (let fIdx = 0; fIdx < files.length; fIdx++) {
          const file = files[fIdx];
          if (file.name.endsWith('.zip')) {
            dictStatus.textContent = `Unzipping ${file.name}...`;
            if (typeof JSZip === 'undefined') {
              throw new Error('JSZip library is not available to unpack zip archives.');
            }
            const zip = await JSZip.loadAsync(file);
            if (zip.files['index.json']) {
              const indexRaw = await zip.files['index.json'].async('string');
              const indexObj = JSON.parse(indexRaw);
              if (indexObj) {
                if (indexObj.title) detectedTitle = indexObj.title;
                if (indexObj.sourceLanguage) detectedSourceLang = indexObj.sourceLanguage;
                if (indexObj.targetLanguage) detectedTargetLang = indexObj.targetLanguage;
              }
            }
            const termBankFileNames = Object.keys(zip.files).filter(name => name.includes('term_bank_') && name.endsWith('.json'));
            for (const tbName of termBankFileNames) {
              const content = await zip.files[tbName].async('string');
              allTermBanksData.push(JSON.parse(content));
            }
          } else if (file.name.endsWith('.json')) {
            const content = await new Promise(r => { const reader = new FileReader(); reader.onload = (e) => r(e.target.result); reader.readAsText(file); });
            const parsed = JSON.parse(content);
            if (file.name === 'index.json') {
              if (parsed) {
                if (parsed.title) detectedTitle = parsed.title;
                if (parsed.sourceLanguage) detectedSourceLang = parsed.sourceLanguage;
                if (parsed.targetLanguage) detectedTargetLang = parsed.targetLanguage;
              }
            } else if (Array.isArray(parsed)) {
              allTermBanksData.push(parsed);
            } else if (parsed && Array.isArray(parsed.words)) {
              allTermBanksData.push(parsed.words);
            }
          }
        }

        function inferTargetLanguage(title) {
          if (!title || typeof title !== 'string') return '';
          const t = title.toLowerCase();
          if (/\b(ja|jpn|japanese|일본어|일어|日本語)\b/i.test(t) || t.includes(' ja') || t.includes('japanese') || t.includes('일본어')) {
            return 'ja';
          }
          if (/\b(en|eng|english|영어|英語)\b/i.test(t) || t.includes(' en') || t.includes('english') || t.includes('영어')) {
            return 'en';
          }
          if (/\b(ko|kor|korean|한국어|국어|韓国語)\b/i.test(t) || t.includes(' ko') || t.includes('korean') || t.includes('국어') || t.includes('한국어')) {
            return 'ko';
          }
          return '';
        }

        const dictTitle = detectedTitle || files[0].name.replace(/\.(zip|json)$/i, '') || 'Imported Dictionary';
        const sourceLang = detectedSourceLang || 'kor';
        const targetLang = detectedTargetLang || inferTargetLanguage(dictTitle);
        const dictMeta = { sourceLanguage: sourceLang, targetLanguage: targetLang };
        const dictId = `dict_${Date.now().toString(36)}`;
        let entriesToInsert = [];
        let itemIndex = 0;

        for (const dataArray of allTermBanksData) {
          if (!Array.isArray(dataArray)) continue;
          for (const item of dataArray) {
            if (item && typeof item === 'object' && item.surface && item.definitions) {
              entriesToInsert.push({ ...item, dictId, dictTitle, dictTargetLanguage: targetLang, dictSourceLanguage: sourceLang });
            } else {
              const parsed = window.DictionaryDB.parseKrdictTermItem(item, `${dictId}_term_${itemIndex++}`);
              if (parsed) {
                parsed.dictId = dictId;
                parsed.dictTitle = dictTitle;
                parsed.dictTargetLanguage = targetLang;
                parsed.dictSourceLanguage = sourceLang;
                entriesToInsert.push(parsed);
              }
            }
          }
        }

        // Merge sequenced multi-row entries before chunking
        const mergedEntries = (window.DictionaryDB && typeof window.DictionaryDB.mergeSequencedEntries === 'function')
          ? window.DictionaryDB.mergeSequencedEntries(entriesToInsert)
          : entriesToInsert;

        const chunkSize = 2000;
        let insertedTotal = 0;
        for (let i = 0; i < mergedEntries.length; i += chunkSize) {
          const chunk = mergedEntries.slice(i, i + chunkSize);
          await window.DictionaryDB.insertEntries(chunk, dictId, dictTitle, dictMeta);
          insertedTotal += chunk.length;
          dictStatus.textContent = `Inserted ${insertedTotal.toLocaleString()} / ${mergedEntries.length.toLocaleString()} terms...`;
        }

        dictFileInput.value = '';
        currentDictOrder.push(dictId);
        chrome.storage.local.set({ dictionaryOrder: currentDictOrder }, () => {
          chrome.runtime.sendMessage({ type: 'clearDictCache' });
        });
        alert(`Successfully imported "${dictTitle}" with ${insertedTotal.toLocaleString()} dictionary entries!`);
        updateDictStatus();
      } catch (err) {
        alert(`Error importing termbank: ${err.message}`);
        updateDictStatus();
      }
    });
  }

  async function callAnkiConnect(baseUrl, action, params = {}) {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, version: 6, params })
    });
    if (!response.ok) throw new Error(`AnkiConnect HTTP ${response.status}: ${response.statusText}`);
    const result = await response.json();
    if (result.error) throw new Error(result.error);
    return result.result;
  }

  async function testAnkiConnection(showSuccessAlert = false) {
    const url = ankiConnectUrlInput.value.trim();
    if (!url) {
      ankiStatus.textContent = 'Please enter an AnkiConnect URL.';
      ankiStatus.style.color = '#8b261e';
      if (ankiConnectedControls) ankiConnectedControls.style.display = 'none';
      return false;
    }
    ankiStatus.textContent = 'Testing connection to AnkiConnect...';
    try {
      const version = await callAnkiConnect(url, 'version');
      ankiStatus.textContent = `✓ Connected to Anki (AnkiConnect v${version})`;
      ankiStatus.style.color = '#2f5d62';
      if (ankiConnectedControls) ankiConnectedControls.style.display = 'block';
      const decks = await callAnkiConnect(url, 'deckNames');
      const models = await callAnkiConnect(url, 'modelNames');
      const currentDeck = ankiDeckNameSelect.getAttribute('data-value') || 'Korean';
      ankiDeckNameSelect.innerHTML = decks.map(d => `<option value="${escapeHtml(d)}" ${d === currentDeck ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('');
      const currentModel = ankiNoteTypeSelect.getAttribute('data-value') || 'Basic';
      ankiNoteTypeSelect.innerHTML = models.map(m => `<option value="${escapeHtml(m)}" ${m === currentModel ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('');
      await updateAnkiModelFields();
      if (showSuccessAlert) alert(`Successfully connected to Anki (v${version})!`);
      return true;
    } catch (err) {
      ankiStatus.textContent = `✗ Connection failed: ${err.message}`;
      ankiStatus.style.color = '#8b261e';
      if (ankiConnectedControls) ankiConnectedControls.style.display = 'none';
      return false;
    }
  }

  function getDynamicFieldValueOptions() {
    const opts = [...FIELD_VALUE_OPTIONS];
    const existingValues = new Set(opts.map(o => o.value));

    const userText = aiPromptExtensionInput ? aiPromptExtensionInput.value : '';
    const reservedKeys = new Set(['words_analysis', 'words', 'analysis', 'conjugation']);

    const reservedWords = new Set([
      'and', 'the', 'for', 'with', 'from', 'words', 'analysis', 'rules',
      'words_analysis', 'pos', 'surface', 'base', 'definitions', 'grammar_notes',
      'conjugation', 'sentence', 'context', 'korean', 'return', 'only', 'valid', 'json',
      'string', 'array', 'object', 'number', 'boolean', 'field', 'fields', 'value', 'values',
      'custom', 'extra', 'additional', 'following', 'containing', 'translation', 'definition'
    ]);

    const customKeyMatches = [
      ...userText.matchAll(/[\("'`]\s*([a-zA-Z0-9_]{3,40})\s*[\)"'`]/g),
      ...userText.matchAll(/\{\{([a-zA-Z0-9_]{3,40})\}\}/g),
      ...userText.matchAll(/["'`]?([a-zA-Z0-9_]{3,40})["'`]?\s*:/g),
      ...userText.matchAll(/(?:as|field|key|named|\()\s*["'(`]?([a-zA-Z0-9_]{3,40})["')`]?/g),
      ...userText.matchAll(/["'`(]?([a-zA-Z0-9_]{3,40})["'`)']?\s+(?:field|key)\b/gi),
      ...userText.matchAll(/\b([a-z][a-z0-9_]{2,30}_(?:translation|def|definition|meaning|field|note|nuance|romaji|reading|kana|kanji))\b/gi)
    ];

    for (const m of customKeyMatches) {
      const key = m[1];
      if (reservedWords.has(key.toLowerCase())) continue;
      if (!key.includes('_') && !/^[a-z]+[A-Z]/.test(key) && !['nuance', 'reading', 'hanja', 'synopsis', 'etymology', 'pitch', 'romaji'].includes(key.toLowerCase())) continue;
      const val = `{{${key}}}`;
      if (!existingValues.has(val)) {
        existingValues.add(val);
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + ' (Custom Prompt Field)';
        opts.push({ value: val, label });
      }
    }

    // Include standard LLM fields if not already present
    ['translation', 'grammar', 'notes', 'hanja'].forEach((key) => {
      const val = `{{${key}}}`;
      if (!existingValues.has(val)) {
        existingValues.add(val);
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + ' (Gemini Field)';
        opts.push({ value: val, label });
      }
    });

    if (cachedTrackedGeminiFields && typeof cachedTrackedGeminiFields === 'object') {
      Object.keys(cachedTrackedGeminiFields).forEach((key) => {
        const val = `{{${key}}}`;
        if (!existingValues.has(val) && !reservedKeys.has(key)) {
          existingValues.add(val);
          const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) + ' (Detected LLM Field)';
          opts.push({ value: val, label });
        }
      });
    }

    return opts;
  }

  async function updateAnkiModelFields() {
    const url = ankiConnectUrlInput.value.trim();
    const selectedModel = ankiNoteTypeSelect.value;
    if (!url || !selectedModel) return;
    try {
      const fields = await callAnkiConnect(url, 'modelFieldNames', { modelName: selectedModel });
      const currentDefField = ankiDefinitionFieldSelect.value || ankiDefinitionFieldSelect.getAttribute('data-value') || 'Back';
      ankiDefinitionFieldSelect.setAttribute('data-value', currentDefField);
      ankiDefinitionFieldSelect.innerHTML = fields.map(f => `<option value="${escapeHtml(f)}" ${f === currentDefField ? 'selected' : ''}>${escapeHtml(f)}</option>`).join('');
      let containerHtml = '';
      const dynamicOptions = getDynamicFieldValueOptions();
      fields.forEach(field => {
        const currentMappingVal = savedFieldMapping[field] || 'none';
        containerHtml += `
          <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <label style="font-weight:700; min-width:110px;">${escapeHtml(field)}</label>
            <select class="field-map-select" data-field="${escapeHtml(field)}" style="flex:1; padding:8px 12px; border:1px solid var(--line); border-radius:10px; background:#fff;">
              ${dynamicOptions.map(opt => `<option value="${escapeHtml(opt.value)}" ${opt.value === currentMappingVal ? 'selected' : ''}>${escapeHtml(opt.label)}</option>`).join('')}
            </select>
          </div>
        `;
      });
      ankiDynamicFieldsContainer.innerHTML = containerHtml;
      ankiDynamicFieldsContainer.querySelectorAll('.field-map-select').forEach(sel => {
        sel.addEventListener('change', updateFieldMappingJson);
      });
      updateFieldMappingJson();
    } catch (e) { console.warn('Failed to load model fields', e); }
  }

  function updateFieldMappingJson() {
    const mapping = {};
    if (ankiDynamicFieldsContainer) {
      ankiDynamicFieldsContainer.querySelectorAll('.field-map-select').forEach(sel => {
        const field = sel.getAttribute('data-field');
        const val = sel.value;
        if (field && val && val !== 'none') mapping[field] = val;
      });
    }
    savedFieldMapping = mapping;
    ankiFieldMappingInput.value = JSON.stringify(mapping, null, 2);
  }

  if (testAnkiBtn) testAnkiBtn.addEventListener('click', () => testAnkiConnection(true));
  if (ankiNoteTypeSelect) ankiNoteTypeSelect.addEventListener('change', updateAnkiModelFields);
  if (ankiDefinitionFieldSelect) {
    ankiDefinitionFieldSelect.addEventListener('change', () => {
      ankiDefinitionFieldSelect.setAttribute('data-value', ankiDefinitionFieldSelect.value);
    });
  }

  chrome.storage.local.get([
    'aiProvider',
    'apiKey',
    'modelId',
    'customEndpointUrl',
    'customModelId',
    'customApiKey',
    'autoTriggerAiOnHover',
    'customDisableReasoning',
    'customTemperature',
    'customTopP',
    'customTopK',
    'customMinP',
    'customRepeatPenalty',
    'customPresencePenalty',
    'aiPromptExtension',
    'tmdbApiKey',
    'enableDevMode',
    'enableOnnxReranker',
    'enableWebGpu',
    'useFullContext',
    'enableCheaperSummaryModel',
    'cheaperSummaryModelId',
    'selectedDictionaryId',
    'modifierKey',
    'tooltipFontSize',
    'ankiConnectUrl',
    'ankiDeckName',
    'ankiNoteType',
    'ankiFieldMapping',
    'ankiDefinitionField',
    'trackedGeminiFields'
  ], (result) => {
    if (result.trackedGeminiFields) cachedTrackedGeminiFields = result.trackedGeminiFields;
    if (aiProviderSelect) {
      aiProviderSelect.value = result.aiProvider || 'custom';
      updateAiProviderVisibility();
    }
    if (result.apiKey) apiKeyInput.value = result.apiKey;
    if (tmdbApiKeyInput && result.tmdbApiKey) tmdbApiKeyInput.value = result.tmdbApiKey;
    modelIdInput.value = result.modelId || 'gemini-flash-lite-latest';
    if (customEndpointUrlInput) customEndpointUrlInput.value = result.customEndpointUrl || 'http://localhost:1234/v1';
    if (customModelIdInput) customModelIdInput.value = result.customModelId || 'llama-3.2-3b-instruct';
    if (customApiKeyInput) customApiKeyInput.value = result.customApiKey || '';
    if (autoTriggerAiOnHoverInput) autoTriggerAiOnHoverInput.checked = Boolean(result.autoTriggerAiOnHover);
    if (customDisableReasoningInput) customDisableReasoningInput.checked = Boolean(result.customDisableReasoning);
    if (customTemperatureInput) customTemperatureInput.value = result.customTemperature !== undefined ? result.customTemperature : '0.2';
    if (customTopPInput) customTopPInput.value = result.customTopP !== undefined ? result.customTopP : '0.9';
    if (customTopKInput) customTopKInput.value = result.customTopK !== undefined ? result.customTopK : '40';
    if (customMinPInput) customMinPInput.value = result.customMinP !== undefined ? result.customMinP : '0.05';
    if (customRepeatPenaltyInput) customRepeatPenaltyInput.value = result.customRepeatPenalty !== undefined ? result.customRepeatPenalty : '1.1';
    if (customPresencePenaltyInput) customPresencePenaltyInput.value = result.customPresencePenalty !== undefined ? result.customPresencePenalty : '0.0';
    if (aiPromptExtensionInput) aiPromptExtensionInput.value = result.aiPromptExtension || '';

    function updateDevModeVisibility() {
      const isDev = Boolean(enableDevModeInput && enableDevModeInput.checked);
      if (devModeSettingsContainer) {
        devModeSettingsContainer.style.display = isDev ? 'block' : 'none';
      }
      const vectorSection = document.getElementById('vectorPrecomputationSection');
      if (vectorSection) {
        const isReranker = isDev && Boolean(enableOnnxRerankerInput && enableOnnxRerankerInput.checked);
        vectorSection.style.display = isReranker ? 'block' : 'none';
      }
    }

    if (enableDevModeInput) {
      enableDevModeInput.checked = Boolean(result.enableDevMode);
      updateDevModeVisibility();
      enableDevModeInput.addEventListener('change', () => {
        chrome.storage.local.set({ enableDevMode: enableDevModeInput.checked });
        updateDevModeVisibility();
        updateDictStatus();
      });
    }

    enableOnnxRerankerInput.checked = typeof result.enableOnnxReranker === 'boolean' ? result.enableOnnxReranker : false;
    if (enableOnnxRerankerInput) {
      enableOnnxRerankerInput.addEventListener('change', () => {
        chrome.storage.local.set({ enableOnnxReranker: enableOnnxRerankerInput.checked });
        updateDevModeVisibility();
        updateDictStatus();
      });
    }
    if (enableWebGpuInput) {
      enableWebGpuInput.checked = typeof result.enableWebGpu === 'boolean' ? result.enableWebGpu : false;
      enableWebGpuInput.addEventListener('change', () => {
        chrome.storage.local.set({ enableWebGpu: enableWebGpuInput.checked }, () => {
          console.log('[Munmek Options] Enable WebGPU setting updated instantly to:', enableWebGpuInput.checked);
        });
      });
    }
    if (useFullContextInput) useFullContextInput.checked = Boolean(result.useFullContext);
    if (enableCheaperSummaryModelInput) enableCheaperSummaryModelInput.checked = Boolean(result.enableCheaperSummaryModel);
    if (cheaperSummaryModelIdInput) cheaperSummaryModelIdInput.value = result.cheaperSummaryModelId || 'gemini-flash-lite-latest';
    if (selectedDictionaryIdInput && result.selectedDictionaryId) selectedDictionaryIdInput.value = result.selectedDictionaryId;
    if (modifierKeyInput) modifierKeyInput.value = result.modifierKey || 'Shift';
    if (tooltipFontSizeInput) tooltipFontSizeInput.value = result.tooltipFontSize || '15';
    ankiConnectUrlInput.value = result.ankiConnectUrl || 'http://127.0.0.1:8765';
    ankiDeckNameSelect.setAttribute('data-value', result.ankiDeckName || 'Korean');
    ankiNoteTypeSelect.setAttribute('data-value', result.ankiNoteType || 'Basic');
    ankiDefinitionFieldSelect.setAttribute('data-value', result.ankiDefinitionField || 'Back');
    try { savedFieldMapping = JSON.parse(result.ankiFieldMapping || '{"Front":"{{word}}","Back":"{{definition}}"}'); } catch (e) { savedFieldMapping = { Front: '{{word}}', Back: '{{definition}}' }; }
    ankiFieldMappingInput.value = JSON.stringify(savedFieldMapping, null, 2);
    if (aiPromptExtensionInput) {
      aiPromptExtensionInput.addEventListener('input', updateAnkiModelFields);
    }
    testAnkiConnection(false);
  });

  const clearTmdbCacheBtn = document.getElementById('clearTmdbCacheBtn');
  const tmdbCacheStatus = document.getElementById('tmdbCacheStatus');
  if (clearTmdbCacheBtn) {
    clearTmdbCacheBtn.addEventListener('click', () => {
      chrome.storage.local.set({ netflixTmdbMap: {} }, () => {
        if (tmdbCacheStatus) {
          tmdbCacheStatus.textContent = '✓ TMDB cache cleared!';
          setTimeout(() => { tmdbCacheStatus.textContent = ''; }, 3000);
        }
      });
    });
  }

  resetButton.addEventListener('click', () => {
    if (aiProviderSelect) aiProviderSelect.value = 'custom';
    updateAiProviderVisibility();
    apiKeyInput.value = '';
    modelIdInput.value = 'gemini-flash-lite-latest';
    if (customEndpointUrlInput) customEndpointUrlInput.value = 'http://localhost:1234/v1';
    if (customModelIdInput) customModelIdInput.value = 'llama-3.2-3b-instruct';
    if (customApiKeyInput) customApiKeyInput.value = '';
    if (autoTriggerAiOnHoverInput) autoTriggerAiOnHoverInput.checked = false;
    if (customDisableReasoningInput) customDisableReasoningInput.checked = false;
    if (customTemperatureInput) customTemperatureInput.value = '0.2';
    if (customTopPInput) customTopPInput.value = '0.9';
    if (customTopKInput) customTopKInput.value = '40';
    if (customMinPInput) customMinPInput.value = '0.05';
    if (customRepeatPenaltyInput) customRepeatPenaltyInput.value = '1.1';
    if (customPresencePenaltyInput) customPresencePenaltyInput.value = '0.0';
    if (tmdbApiKeyInput) tmdbApiKeyInput.value = '';
    if (aiPromptExtensionInput) aiPromptExtensionInput.value = '';
    if (enableDevModeInput) enableDevModeInput.checked = false;
    enableOnnxRerankerInput.checked = false;
    if (enableWebGpuInput) enableWebGpuInput.checked = false;
    if (devModeSettingsContainer) devModeSettingsContainer.style.display = 'none';
    const vectorSection = document.getElementById('vectorPrecomputationSection');
    if (vectorSection) vectorSection.style.display = 'none';
    updateDictStatus();
    if (useFullContextInput) useFullContextInput.checked = false;
    if (enableCheaperSummaryModelInput) enableCheaperSummaryModelInput.checked = false;
    if (cheaperSummaryModelIdInput) cheaperSummaryModelIdInput.value = 'gemini-flash-lite-latest';
    if (selectedDictionaryIdInput) selectedDictionaryIdInput.value = 'all';
    if (modifierKeyInput) modifierKeyInput.value = 'Shift';
    if (tooltipFontSizeInput) tooltipFontSizeInput.value = '15';
    if (customModelSelect) {
      customModelSelect.innerHTML = '<option value="">-- Discovered Models --</option>';
      customModelSelect.style.display = 'none';
    }
    if (geminiModelSelect) {
      geminiModelSelect.innerHTML = '<option value="">-- Discovered Models --</option>';
      geminiModelSelect.style.display = 'none';
    }
    statusDiv.textContent = 'Defaults restored locally. Click Save to store them.';
    statusDiv.className = 'success';
  });

  saveButton.addEventListener('click', () => {
    const aiProvider = aiProviderSelect ? aiProviderSelect.value : 'custom';
    const apiKey = apiKeyInput.value.trim();
    const modelId = modelIdInput.value.trim();
    const tmdbApiKey = tmdbApiKeyInput ? tmdbApiKeyInput.value.trim() : '';
    const customEndpointUrl = customEndpointUrlInput ? customEndpointUrlInput.value.trim() : '';
    const customModelId = customModelIdInput ? customModelIdInput.value.trim() : '';
    const customApiKey = customApiKeyInput ? customApiKeyInput.value.trim() : '';
    const autoTriggerAiOnHover = autoTriggerAiOnHoverInput ? autoTriggerAiOnHoverInput.checked : false;
    const customDisableReasoning = customDisableReasoningInput ? customDisableReasoningInput.checked : false;
    const customTemperature = customTemperatureInput ? customTemperatureInput.value.trim() : '0.2';
    const customTopP = customTopPInput ? customTopPInput.value.trim() : '0.9';
    const customTopK = customTopKInput ? customTopKInput.value.trim() : '40';
    const customMinP = customMinPInput ? customMinPInput.value.trim() : '0.05';
    const customRepeatPenalty = customRepeatPenaltyInput ? customRepeatPenaltyInput.value.trim() : '1.1';
    const customPresencePenalty = customPresencePenaltyInput ? customPresencePenaltyInput.value.trim() : '0.0';
    const aiPromptExtension = aiPromptExtensionInput ? aiPromptExtensionInput.value.trim() : '';
    const enableDevMode = enableDevModeInput ? enableDevModeInput.checked : false;
    const enableOnnxReranker = enableOnnxRerankerInput.checked;
    const enableWebGpu = enableWebGpuInput ? enableWebGpuInput.checked : false;
    const useFullContext = useFullContextInput ? useFullContextInput.checked : false;
    const enableCheaperSummaryModel = enableCheaperSummaryModelInput ? enableCheaperSummaryModelInput.checked : false;
    const cheaperSummaryModelId = cheaperSummaryModelIdInput ? cheaperSummaryModelIdInput.value.trim() : 'gemini-flash-lite-latest';
    const selectedDictionaryId = selectedDictionaryIdInput ? selectedDictionaryIdInput.value : 'all';
    const modifierKey = modifierKeyInput ? modifierKeyInput.value : 'Shift';
    const tooltipFontSize = tooltipFontSizeInput ? tooltipFontSizeInput.value : '15';
    const ankiConnectUrl = ankiConnectUrlInput.value.trim();
    const ankiDeckName = ankiDeckNameSelect.value || 'Korean';
    const ankiNoteType = ankiNoteTypeSelect.value || 'Basic';
    const ankiDefinitionField = ankiDefinitionFieldSelect.value || 'Back';
    updateFieldMappingJson();
    const updatedTrackedFields = {};
    if (cachedTrackedGeminiFields && typeof cachedTrackedGeminiFields === 'object') {
      Object.keys(cachedTrackedGeminiFields).forEach((key) => {
        if (aiPromptExtension.includes(key)) {
          updatedTrackedFields[key] = cachedTrackedGeminiFields[key];
        }
      });
    }
    cachedTrackedGeminiFields = updatedTrackedFields;

    const dataToSave = {
      aiProvider,
      apiKey,
      tmdbApiKey,
      modelId: modelId || 'gemini-flash-lite-latest',
      customEndpointUrl,
      customModelId,
      customApiKey,
      autoTriggerAiOnHover,
      customDisableReasoning,
      customTemperature,
      customTopP,
      customTopK,
      customMinP,
      customRepeatPenalty,
      customPresencePenalty,
      aiPromptExtension,
      enableDevMode,
      enableOnnxReranker,
      enableWebGpu,
      useFullContext,
      enableCheaperSummaryModel,
      cheaperSummaryModelId,
      selectedDictionaryId,
      modifierKey,
      tooltipFontSize,
      ankiConnectUrl,
      ankiDeckName,
      ankiNoteType,
      ankiFieldMapping: JSON.stringify(savedFieldMapping, null, 2),
      ankiDefinitionField,
      dictionaryOrder: currentDictOrder,
      trackedGeminiFields: updatedTrackedFields
    };
    chrome.storage.local.set(dataToSave, () => {
      if (chrome.runtime.lastError) {
        statusDiv.textContent = `Error saving settings: ${chrome.runtime.lastError.message}`;
        statusDiv.className = 'error';
      } else {
        const isCustom = aiProvider === 'custom';
        const msg = isCustom
          ? 'Settings saved successfully with Custom OpenAI endpoint!'
          : (apiKey ? 'Settings saved successfully with Gemini!' : 'Local settings saved! (Add a Gemini API Key or switch to Local AI to enable AI explanations).');
        statusDiv.textContent = msg;
        statusDiv.className = 'success';
        updateAnkiModelFields();
      }

      setTimeout(() => {
        statusDiv.textContent = '';
        statusDiv.className = '';
      }, 4000);
    });
  });

  function escapeHtml(val) {
    return String(val || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
});
