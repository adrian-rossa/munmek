document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const modelIdInput = document.getElementById('modelId');
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
  const modifierKeyInput = document.getElementById('modifierKey');
  const tooltipFontSizeInput = document.getElementById('tooltipFontSize');
  const saveButton = document.getElementById('save');
  const resetButton = document.getElementById('reset');
  const statusDiv = document.getElementById('status');

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

      listHtml += `
        <div style="display:flex; align-items:center; justify-content:space-between; background:#fff; padding:10px 14px; border-radius:12px; border:1px solid var(--line);">
          <div>
            <strong>${escapeHtml(d.title || d.id)}</strong>
            <span class="muted" style="font-size:0.85rem; margin-left:8px;">${(d.wordCount || 0).toLocaleString()} words</span>
            <span class="chip" style="margin-left:8px; font-size:0.75rem;">Priority #${idx + 1}</span>
          </div>
          <div style="display:flex; gap:6px;">
            <button type="button" class="move-dict-up" data-index="${idx}" ${idx === 0 ? 'disabled style="opacity:0.5;"' : ''}>▲ Up</button>
            <button type="button" class="move-dict-down" data-index="${idx}" ${idx === sortedDicts.length - 1 ? 'disabled style="opacity:0.5;"' : ''}>▼ Down</button>
            <button type="button" class="delete-dict-btn" data-id="${escapeHtml(d.id)}" style="background:#8b261e;">Delete</button>
          </div>
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
              if (indexObj && indexObj.title) detectedTitle = indexObj.title;
            }
            const termBankFileNames = Object.keys(zip.files).filter(name => name.includes('term_bank_') && name.endsWith('.json'));
            for (const tbName of termBankFileNames) {
              const content = await zip.files[tbName].async('string');
              allTermBanksData.push(JSON.parse(content));
            }
          } else if (file.name.endsWith('.json')) {
            const content = await new Promise(r => { const reader = new FileReader(); reader.onload = (e) => r(e.target.result); reader.readAsText(file); });
            const parsed = JSON.parse(content);
            if (file.name === 'index.json') { if (parsed && parsed.title) detectedTitle = parsed.title; }
            else if (Array.isArray(parsed)) allTermBanksData.push(parsed);
            else if (parsed && Array.isArray(parsed.words)) allTermBanksData.push(parsed.words);
          }
        }

        const dictTitle = detectedTitle || files[0].name.replace(/\.(zip|json)$/i, '') || 'Imported Dictionary';
        const dictId = `dict_${Date.now().toString(36)}`;
        let entriesToInsert = [];
        let itemIndex = 0;

        for (const dataArray of allTermBanksData) {
          if (!Array.isArray(dataArray)) continue;
          for (const item of dataArray) {
            if (item && typeof item === 'object' && item.surface && item.definitions) {
              entriesToInsert.push({ ...item, dictId, dictTitle });
            } else {
              const parsed = window.DictionaryDB.parseKrdictTermItem(item, `${dictId}_term_${itemIndex++}`);
              if (parsed) {
                parsed.dictId = dictId;
                parsed.dictTitle = dictTitle;
                entriesToInsert.push(parsed);
              }
            }
          }
        }

        const chunkSize = 2000;
        let insertedTotal = 0;
        for (let i = 0; i < entriesToInsert.length; i += chunkSize) {
          const chunk = entriesToInsert.slice(i, i + chunkSize);
          await window.DictionaryDB.insertEntries(chunk, dictId, dictTitle);
          insertedTotal += chunk.length;
          dictStatus.textContent = `Inserted ${insertedTotal.toLocaleString()} / ${entriesToInsert.length.toLocaleString()} terms...`;
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

    // Match keys with or without quotes: "german_definition": or german_definition:
    const customKeyMatches = userText.matchAll(/["']?([a-zA-Z0-9_]{3,40})["']?\s*:/g);

    for (const m of customKeyMatches) {
      const key = m[1];
      const val = `{{${key}}}`;
      if (!existingValues.has(val) && !reservedKeys.has(key)) {
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
      const currentDefField = ankiDefinitionFieldSelect.getAttribute('data-value') || 'Back';
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

  const useFullContextInput = document.getElementById('useFullContext');
  const enableCheaperSummaryModelInput = document.getElementById('enableCheaperSummaryModel');
  const cheaperSummaryModelIdInput = document.getElementById('cheaperSummaryModelId');
  const responseLanguageInput = document.getElementById('responseLanguage');
  const customResponseLanguageInput = document.getElementById('customResponseLanguage');
  const customLanguageContainer = document.getElementById('customLanguageContainer');

  if (responseLanguageInput && customLanguageContainer) {
    responseLanguageInput.addEventListener('change', () => {
      customLanguageContainer.style.display = responseLanguageInput.value === 'Custom' ? 'block' : 'none';
    });
  }

  chrome.storage.local.get(['apiKey', 'modelId', 'aiPromptExtension', 'responseLanguage', 'customResponseLanguage', 'enableOnnxReranker', 'useFullContext', 'enableCheaperSummaryModel', 'cheaperSummaryModelId', 'selectedDictionaryId', 'modifierKey', 'tooltipFontSize', 'ankiConnectUrl', 'ankiDeckName', 'ankiNoteType', 'ankiFieldMapping', 'ankiDefinitionField', 'trackedGeminiFields'], (result) => {
    if (result.trackedGeminiFields) cachedTrackedGeminiFields = result.trackedGeminiFields;
    if (result.apiKey) apiKeyInput.value = result.apiKey;
    modelIdInput.value = result.modelId || 'gemini-2.0-flash-lite';
    if (aiPromptExtensionInput) aiPromptExtensionInput.value = result.aiPromptExtension || '';
    if (responseLanguageInput) {
      responseLanguageInput.value = result.responseLanguage || 'English';
      if (customLanguageContainer) {
        customLanguageContainer.style.display = responseLanguageInput.value === 'Custom' ? 'block' : 'none';
      }
    }
    if (customResponseLanguageInput) customResponseLanguageInput.value = result.customResponseLanguage || '';
    enableOnnxRerankerInput.checked = typeof result.enableOnnxReranker === 'boolean' ? result.enableOnnxReranker : true;
    if (useFullContextInput) useFullContextInput.checked = Boolean(result.useFullContext);
    if (enableCheaperSummaryModelInput) enableCheaperSummaryModelInput.checked = Boolean(result.enableCheaperSummaryModel);
    if (cheaperSummaryModelIdInput) cheaperSummaryModelIdInput.value = result.cheaperSummaryModelId || 'gemini-2.0-flash-lite';
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

  resetButton.addEventListener('click', () => {
    apiKeyInput.value = '';
    modelIdInput.value = 'gemini-2.0-flash-lite';
    if (aiPromptExtensionInput) aiPromptExtensionInput.value = '';
    if (responseLanguageInput) responseLanguageInput.value = 'English';
    if (customResponseLanguageInput) customResponseLanguageInput.value = '';
    if (customLanguageContainer) customLanguageContainer.style.display = 'none';
    enableOnnxRerankerInput.checked = true;
    if (useFullContextInput) useFullContextInput.checked = false;
    if (enableCheaperSummaryModelInput) enableCheaperSummaryModelInput.checked = false;
    if (cheaperSummaryModelIdInput) cheaperSummaryModelIdInput.value = 'gemini-2.0-flash-lite';
    if (selectedDictionaryIdInput) selectedDictionaryIdInput.value = 'all';
    if (modifierKeyInput) modifierKeyInput.value = 'Shift';
    if (tooltipFontSizeInput) tooltipFontSizeInput.value = '15';
    ankiConnectUrlInput.value = 'http://127.0.0.1:8765';
    statusDiv.textContent = 'Defaults restored locally. Click Save to store them.';
    statusDiv.className = 'success';
  });

  saveButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    const modelId = modelIdInput.value.trim();
    const aiPromptExtension = aiPromptExtensionInput ? aiPromptExtensionInput.value.trim() : '';
    const responseLanguage = responseLanguageInput ? responseLanguageInput.value : 'English';
    const customResponseLanguage = customResponseLanguageInput ? customResponseLanguageInput.value.trim() : '';
    const enableOnnxReranker = enableOnnxRerankerInput.checked;
    const useFullContext = useFullContextInput ? useFullContextInput.checked : false;
    const enableCheaperSummaryModel = enableCheaperSummaryModelInput ? enableCheaperSummaryModelInput.checked : false;
    const cheaperSummaryModelId = cheaperSummaryModelIdInput ? cheaperSummaryModelIdInput.value.trim() : 'gemini-2.0-flash-lite';
    const selectedDictionaryId = selectedDictionaryIdInput ? selectedDictionaryIdInput.value : 'all';
    const modifierKey = modifierKeyInput ? modifierKeyInput.value : 'Shift';
    const tooltipFontSize = tooltipFontSizeInput ? tooltipFontSizeInput.value : '15';
    const ankiConnectUrl = ankiConnectUrlInput.value.trim();
    const ankiDeckName = ankiDeckNameSelect.value || 'Korean';
    const ankiNoteType = ankiNoteTypeSelect.value || 'Basic';
    const ankiDefinitionField = ankiDefinitionFieldSelect.value || 'Back';
    updateFieldMappingJson();
    if (!apiKey || !modelId) {
      statusDiv.textContent = 'API Key and Model ID are required.';
      statusDiv.className = 'error';
      return;
    }
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
      apiKey, modelId, aiPromptExtension, responseLanguage, customResponseLanguage, enableOnnxReranker, useFullContext, enableCheaperSummaryModel, cheaperSummaryModelId, selectedDictionaryId, modifierKey, tooltipFontSize, ankiConnectUrl, ankiDeckName, ankiNoteType,
      ankiFieldMapping: JSON.stringify(savedFieldMapping, null, 2), ankiDefinitionField, dictionaryOrder: currentDictOrder,
      trackedGeminiFields: updatedTrackedFields
    };
    chrome.storage.local.set(dataToSave, () => {
      if (chrome.runtime.lastError) {
        statusDiv.textContent = `Error saving settings: ${chrome.runtime.lastError.message}`;
        statusDiv.className = 'error';
      } else {
        statusDiv.textContent = 'Settings saved successfully!';
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
