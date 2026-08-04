// Handles popup logic for the BROWSER ACTION (extension icon)
// This is NOT the hover tooltip.
// This can be used for quick settings access or status.

document.addEventListener('DOMContentLoaded', () => {
  const openSettingsButton = document.getElementById('open-settings');
  openSettingsButton.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});
