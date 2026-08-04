document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const modelIdInput = document.getElementById('modelId');
  const aiPromptInput = document.getElementById('aiPrompt');
  const ankiConnectUrlInput = document.getElementById('ankiConnectUrl');
  const ankiDeckNameInput = document.getElementById('ankiDeckName');
  const ankiNoteTypeInput = document.getElementById('ankiNoteType');
  const ankiFieldMappingInput = document.getElementById('ankiFieldMapping');
  const ankiDefinitionFieldInput = document.getElementById('ankiDefinitionField');
  const ankiUpdateLastCardInput = document.getElementById('ankiUpdateLastCard');
  const saveButton = document.getElementById('save');
  const resetButton = document.getElementById('reset');
  const statusDiv = document.getElementById('status');

  const defaultPrompt = `You are a Korean language tutor.

Return only a single JSON object and no markdown fences.
Explain the target word using the sentence context and, if useful, the nearby sentences.

Required keys:
- word
- base
- pos
- translation
- grammar
- hanja
- notes
- related_words { synonyms: [], antonyms: [] }
- examples

Keep the answer concise and specific to the word in context.`;

  const defaultFieldMapping = JSON.stringify({
    Front: '{{word}}',
    Back: '{{definition}}<br><br>{{translation}}<br><br>{{grammar}}'
  }, null, 2);

  chrome.storage.local.get(['apiKey', 'modelId', 'aiPrompt', 'ankiConnectUrl', 'ankiDeckName', 'ankiNoteType', 'ankiFieldMapping', 'ankiDefinitionField', 'ankiUpdateLastCard'], (result) => {
    if (result.apiKey) apiKeyInput.value = result.apiKey;
    if (result.modelId) modelIdInput.value = result.modelId;
    aiPromptInput.value = result.aiPrompt || defaultPrompt;
    ankiConnectUrlInput.value = result.ankiConnectUrl || 'http://127.0.0.1:8765';
    ankiDeckNameInput.value = result.ankiDeckName || 'Korean';
    ankiNoteTypeInput.value = result.ankiNoteType || 'Basic';
    ankiFieldMappingInput.value = result.ankiFieldMapping || defaultFieldMapping;
    ankiDefinitionFieldInput.value = result.ankiDefinitionField || 'Back';
    ankiUpdateLastCardInput.checked = Boolean(result.ankiUpdateLastCard);
  });

  resetButton.addEventListener('click', () => {
    apiKeyInput.value = '';
    modelIdInput.value = 'gemini-2.0-flash-lite';
    aiPromptInput.value = defaultPrompt;
    ankiConnectUrlInput.value = 'http://127.0.0.1:8765';
    ankiDeckNameInput.value = 'Korean';
    ankiNoteTypeInput.value = 'Basic';
    ankiFieldMappingInput.value = defaultFieldMapping;
    ankiDefinitionFieldInput.value = 'Back';
    ankiUpdateLastCardInput.checked = false;
    statusDiv.textContent = 'Defaults restored locally. Click Save to store them.';
    statusDiv.className = 'success';
  });

  saveButton.addEventListener('click', () => {
    const apiKey = apiKeyInput.value.trim();
    const modelId = modelIdInput.value.trim();
    const aiPrompt = aiPromptInput.value.trim();
    const ankiConnectUrl = ankiConnectUrlInput.value.trim();
    const ankiDeckName = ankiDeckNameInput.value.trim();
    const ankiNoteType = ankiNoteTypeInput.value.trim();
    const ankiFieldMapping = ankiFieldMappingInput.value.trim();
    const ankiDefinitionField = ankiDefinitionFieldInput.value.trim();
    const ankiUpdateLastCard = ankiUpdateLastCardInput.checked;

    if (!apiKey || !modelId) {
      statusDiv.textContent = 'API Key and Model ID are required.';
      statusDiv.className = 'error';
      return;
    }

    if (!ankiConnectUrl || !ankiDeckName || !ankiNoteType) {
      statusDiv.textContent = 'AnkiConnect URL, deck name, and note type are required.';
      statusDiv.className = 'error';
      return;
    }

    let parsedFieldMapping;
    try {
      parsedFieldMapping = JSON.parse(ankiFieldMapping || '{}');
    } catch (error) {
      statusDiv.textContent = `Invalid Anki field mapping JSON: ${error.message}`;
      statusDiv.className = 'error';
      return;
    }

    const dataToSave = {
      apiKey,
      modelId,
      aiPrompt,
      ankiConnectUrl,
      ankiDeckName,
      ankiNoteType,
      ankiFieldMapping: JSON.stringify(parsedFieldMapping, null, 2),
      ankiDefinitionField,
      ankiUpdateLastCard
    };

    chrome.storage.local.set(dataToSave, () => {
      if (chrome.runtime.lastError) {
        statusDiv.textContent = `Error saving settings: ${chrome.runtime.lastError.message}`;
        statusDiv.className = 'error';
      } else {
        statusDiv.textContent = 'Settings saved successfully!';
        statusDiv.className = 'success';
      }

      setTimeout(() => {
        statusDiv.textContent = '';
        statusDiv.className = '';
      }, 4000);
    });
  });
});
