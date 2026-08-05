document.addEventListener('DOMContentLoaded', async () => {
  const openSettingsButton = document.getElementById('open-settings');
  const contextStatus = document.getElementById('contextStatus');
  const extractPageBtn = document.getElementById('extractPageBtn');
  const uploadFileBtn = document.getElementById('uploadFileBtn');
  const contextFileInput = document.getElementById('contextFileInput');
  const clearContextBtn = document.getElementById('clearContextBtn');
  const extensionToggleCheck = document.getElementById('extensionToggleCheck');
  const toggleStateLabel = document.getElementById('toggleStateLabel');

  let activeTab = null;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab;

  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(['extensionEnabled'], (res) => {
      const isEnabled = res.extensionEnabled !== undefined ? Boolean(res.extensionEnabled) : true;
      if (extensionToggleCheck) extensionToggleCheck.checked = isEnabled;
      if (toggleStateLabel) toggleStateLabel.textContent = isEnabled ? 'Enabled' : 'Disabled (Paused)';
    });

    if (extensionToggleCheck) {
      extensionToggleCheck.addEventListener('change', (e) => {
        const val = e.target.checked;
        chrome.storage.local.set({ extensionEnabled: val }, () => {
          if (toggleStateLabel) toggleStateLabel.textContent = val ? 'Enabled' : 'Disabled (Paused)';
        });
      });
    }
  }

  openSettingsButton.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  async function updateContextStatus() {
    if (!activeTab || !activeTab.id) {
      contextStatus.textContent = 'No active tab found.';
      return;
    }

    chrome.runtime.sendMessage({ type: 'getTabContext', tabId: activeTab.id }, (res) => {
      const ctx = res && res.context;
      if (ctx && ctx.text) {
        contextStatus.innerHTML = `<strong>Context Active:</strong> ${escapeHtml(ctx.name || 'Tab Context')}<br><span style="font-size:0.8rem; color:#666;">Length: ${ctx.text.length.toLocaleString()} chars</span>`;
        clearContextBtn.style.display = 'block';
      } else {
        contextStatus.innerHTML = `<em>No context set for this tab yet.</em>`;
        clearContextBtn.style.display = 'none';
      }
    });
  }

  updateContextStatus();

  uploadFileBtn.addEventListener('click', () => {
    contextFileInput.click();
  });

  contextFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file || !activeTab) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result || '';
      chrome.runtime.sendMessage(
        {
          type: 'setTabContext',
          tabId: activeTab.id,
          name: file.name,
          text: text
        },
        () => {
          updateContextStatus();
        }
      );
    };
    reader.readAsText(file);
  });

  extractPageBtn.addEventListener('click', () => {
    if (!activeTab || !activeTab.id) return;

    contextStatus.innerHTML = '⏳ <em>Scraping page & subtitle text...</em>';

    chrome.tabs.sendMessage(activeTab.id, { type: 'extractPageContext' }, (res) => {
      if (chrome.runtime.lastError || !res || !res.text) {
        contextStatus.textContent = 'Failed to extract context from active page.';
        return;
      }

      chrome.storage.local.get(['useFullContext'], (config) => {
        const useFull = Boolean(config && config.useFullContext);

        if (useFull) {
          const finalContextText = res.text;
          const contextName = `Full Page Context: ${res.name || activeTab.title}`;
          chrome.runtime.sendMessage(
            {
              type: 'setTabContext',
              tabId: activeTab.id,
              name: contextName,
              text: finalContextText
            },
            () => {
              updateContextStatus();
            }
          );
        } else {
          contextStatus.innerHTML = '🤖 <em>Summarizing context with Gemini...</em>';
          chrome.runtime.sendMessage({ type: 'summarizeContext', text: res.text }, (summaryRes) => {
            const finalContextText = (summaryRes && summaryRes.summary) ? summaryRes.summary : res.text;
            const contextName = summaryRes && summaryRes.summary ? `AI Summary: ${res.name || activeTab.title}` : (res.name || activeTab.title || 'Page Context');

            chrome.runtime.sendMessage(
              {
                type: 'setTabContext',
                tabId: activeTab.id,
                name: contextName,
                text: finalContextText
              },
              () => {
                updateContextStatus();
              }
            );
          });
        }
      });
    });
  });

  clearContextBtn.addEventListener('click', () => {
    if (!activeTab || !activeTab.id) return;

    chrome.runtime.sendMessage({ type: 'clearTabContext', tabId: activeTab.id }, () => {
      updateContextStatus();
    });
  });

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
});
