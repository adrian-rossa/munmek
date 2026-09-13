document.addEventListener('DOMContentLoaded', async () => {
  const openSettingsButton = document.getElementById('open-settings');
  const inactiveCard = document.getElementById('inactiveCard');
  const loadingCard = document.getElementById('loadingCard');
  const activeCard = document.getElementById('activeCard');

  const startSessionBtn = document.getElementById('startSessionBtn');
  const startSessionNoContextBtn = document.getElementById('startSessionNoContextBtn');
  const stopSessionBtn = document.getElementById('stopSessionBtn');
  const refreshContextBtn = document.getElementById('refreshContextBtn');

  const loadingTitle = document.getElementById('loadingTitle');
  const loadingStatus = document.getElementById('loadingStatus');

  const siteBadge = document.getElementById('siteBadge');
  const contextLength = document.getElementById('contextLength');
  const contextMediaTitle = document.getElementById('contextMediaTitle');
  const contextSummaryPreview = document.getElementById('contextSummaryPreview');

  const netflixKeyWarning = document.getElementById('netflixKeyWarning');
  const openSettingsWarningBtn = document.getElementById('openSettingsWarningBtn');

  const uploadFileBtn = document.getElementById('uploadFileBtn');
  const contextFileInput = document.getElementById('contextFileInput');
  const clearContextBtn = document.getElementById('clearContextBtn');

  let activeTab = null;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab;

  if (openSettingsButton) {
    openSettingsButton.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  }

  if (openSettingsWarningBtn) {
    openSettingsWarningBtn.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
  }

  function showInactiveState() {
    if (inactiveCard) inactiveCard.style.display = 'block';
    if (loadingCard) loadingCard.style.display = 'none';
    if (activeCard) activeCard.style.display = 'none';
  }

  function showLoadingState(title = 'Starting Munmek Session...', status = 'Extracting context & analyzing scene...') {
    if (inactiveCard) inactiveCard.style.display = 'none';
    if (loadingCard) loadingCard.style.display = 'block';
    if (activeCard) activeCard.style.display = 'none';

    if (loadingTitle) loadingTitle.textContent = title;
    if (loadingStatus) loadingStatus.textContent = status;
  }

  function showActiveState(context = null) {
    if (inactiveCard) inactiveCard.style.display = 'none';
    if (loadingCard) loadingCard.style.display = 'none';
    if (activeCard) activeCard.style.display = 'block';

    const tabUrl = (activeTab && activeTab.url) ? activeTab.url.toLowerCase() : '';
    const isNetflixUrl = tabUrl.includes('netflix.com');
    const isYouTubeUrl = tabUrl.includes('youtube.com') || tabUrl.includes('youtu.be');

    const siteType = (context && context.siteType && context.siteType !== 'generic')
      ? context.siteType
      : (isNetflixUrl ? 'netflix' : (isYouTubeUrl ? 'youtube' : (context?.siteType || 'generic')));

    if (siteBadge) {
      siteBadge.className = 'site-badge';
      if (siteType === 'netflix') {
        siteBadge.classList.add('netflix-badge');
        siteBadge.textContent = '🎬 Netflix';
      } else if (siteType === 'youtube') {
        siteBadge.classList.add('youtube-badge');
        siteBadge.textContent = '📺 YouTube';
      } else {
        siteBadge.classList.add('generic-badge');
        siteBadge.textContent = '📄 Webpage';
      }
    }

    if (context && (context.summary || context.text)) {
      const summaryText = context.summary || context.text;
      const rawText = context.text || '';
      if (contextMediaTitle) contextMediaTitle.textContent = context.title || context.name || (activeTab ? activeTab.title : 'Active Tab Context');
      if (contextSummaryPreview) contextSummaryPreview.textContent = summaryText;
      if (contextLength) contextLength.textContent = `${rawText.length.toLocaleString()} chars raw`;
    } else {
      if (contextMediaTitle) contextMediaTitle.textContent = activeTab ? (activeTab.title || 'Active Tab') : 'Active Tab';
      if (contextSummaryPreview) contextSummaryPreview.textContent = 'No media context extracted yet. Click "Refresh Context" to analyze page or subtitles.';
      if (contextLength) contextLength.textContent = '0 chars';
    }

    // Check if Netflix and missing TMDB Key
    if (netflixKeyWarning) {
      if (isNetflixUrl || siteType === 'netflix') {
        chrome.storage.local.get(['tmdbApiKey'], (res) => {
          if (!res.tmdbApiKey || !res.tmdbApiKey.trim()) {
            netflixKeyWarning.style.display = 'block';
          } else {
            netflixKeyWarning.style.display = 'none';
          }
        });
      } else {
        netflixKeyWarning.style.display = 'none';
      }
    }
  }

  async function checkInitialSessionStatus() {
    if (!activeTab || !activeTab.id) {
      showInactiveState();
      return;
    }

    chrome.runtime.sendMessage({ type: 'getTabSessionStatus', tabId: activeTab.id }, (res) => {
      if (chrome.runtime.lastError || !res || !res.isActive) {
        showInactiveState();
      } else {
        showActiveState(res.context);
      }
    });
  }

  checkInitialSessionStatus();

  // Start Session Button Handler
  if (startSessionBtn) {
    startSessionBtn.addEventListener('click', () => {
      if (!activeTab || !activeTab.id) return;

      const tabUrl = (activeTab.url || '').toLowerCase();
      let initMsg = 'Extracting webpage context...';
      if (tabUrl.includes('netflix.com')) {
        initMsg = 'Searching TMDB & extracting Netflix show overview...';
      } else if (tabUrl.includes('youtube.com') || tabUrl.includes('youtu.be')) {
        initMsg = 'Fetching YouTube transcript & video metadata...';
      }

      showLoadingState('Starting Munmek Session...', initMsg);

      chrome.runtime.sendMessage({ type: 'startTabSession', tabId: activeTab.id }, (startRes) => {
        if (chrome.runtime.lastError || !startRes || !startRes.success) {
          showInactiveState();
          return;
        }

        // Auto-fetch context for this tab
        if (loadingStatus) loadingStatus.textContent = 'Generating concise AI context summary...';

        chrome.runtime.sendMessage({
          type: 'fetchAndSummarizeContext',
          tabId: activeTab.id,
          tabUrl: activeTab.url,
          tabTitle: activeTab.title
        }, (ctxRes) => {
          if (ctxRes && ctxRes.context) {
            showActiveState(ctxRes.context);
          } else {
            showActiveState(null);
          }
        });
      });
    });
  }

  // Start Session (No Context) Button Handler
  if (startSessionNoContextBtn) {
    startSessionNoContextBtn.addEventListener('click', () => {
      if (!activeTab || !activeTab.id) return;

      chrome.runtime.sendMessage({ type: 'startTabSession', tabId: activeTab.id }, (startRes) => {
        if (chrome.runtime.lastError || !startRes || !startRes.success) {
          showInactiveState();
          return;
        }
        showActiveState(null);
      });
    });
  }

  // Stop Session Button Handler
  if (stopSessionBtn) {
    stopSessionBtn.addEventListener('click', () => {
      if (!activeTab || !activeTab.id) return;

      chrome.runtime.sendMessage({ type: 'stopTabSession', tabId: activeTab.id }, () => {
        showInactiveState();
      });
    });
  }

  // Refresh Context Button Handler
  if (refreshContextBtn) {
    refreshContextBtn.addEventListener('click', () => {
      if (!activeTab || !activeTab.id) return;

      const tabUrl = (activeTab.url || '').toLowerCase();
      let refreshMsg = 'Scraping page & subtitle text...';
      if (tabUrl.includes('netflix.com')) {
        refreshMsg = 'Re-querying TMDB & scene context...';
      } else if (tabUrl.includes('youtube.com') || tabUrl.includes('youtu.be')) {
        refreshMsg = 'Re-fetching YouTube transcript & captions...';
      }

      showLoadingState('Refreshing Context...', refreshMsg);

      chrome.runtime.sendMessage({
        type: 'fetchAndSummarizeContext',
        tabId: activeTab.id,
        tabUrl: activeTab.url,
        tabTitle: activeTab.title
      }, (ctxRes) => {
        if (ctxRes && ctxRes.context) {
          showActiveState(ctxRes.context);
        } else {
          showActiveState(null);
        }
      });
    });
  }

  // Manual File Upload Handler
  if (uploadFileBtn && contextFileInput) {
    uploadFileBtn.addEventListener('click', () => {
      contextFileInput.click();
    });

    contextFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file || !activeTab) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target.result || '';
        showLoadingState('Summarizing Uploaded File...', 'Running concise AI summarizer...');

        chrome.runtime.sendMessage(
          {
            type: 'summarizeContext',
            text: text,
            title: file.name,
            siteType: 'file'
          },
          (sumRes) => {
            const summary = sumRes && sumRes.summary ? sumRes.summary : text.slice(0, 300);
            const contextObj = {
              name: file.name,
              title: file.name,
              text: text,
              summary: summary,
              siteType: 'file'
            };

            chrome.runtime.sendMessage(
              {
                type: 'setTabContext',
                tabId: activeTab.id,
                ...contextObj
              },
              () => {
                showActiveState(contextObj);
              }
            );
          }
        );
      };
      reader.readAsText(file);
    });
  }

  // Clear Context Button Handler
  if (clearContextBtn) {
    clearContextBtn.addEventListener('click', () => {
      if (!activeTab || !activeTab.id) return;

      chrome.runtime.sendMessage({ type: 'clearTabContext', tabId: activeTab.id }, () => {
        showActiveState(null);
      });
    });
  }
});

