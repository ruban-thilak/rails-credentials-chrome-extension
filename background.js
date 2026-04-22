const STORAGE_KEY = "railsCredentialKeys";
const TABS_KEY = "railsCredentialTabs";

// Least-privilege: session storage defaults to TRUSTED_CONTEXTS only (service
// worker + popup). Content scripts retrieve keys via message passing below,
// which lets us validate the sender origin before handing out secret material.

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const result = await chrome.storage.session.get(TABS_KEY);
  const tabSet = result[TABS_KEY] || [];

  if (!tabSet.includes(tabId)) return;

  const remaining = tabSet.filter((id) => id !== tabId);

  if (remaining.length === 0) {
    await chrome.storage.session.remove([STORAGE_KEY, TABS_KEY]);
  } else {
    await chrome.storage.session.set({ [TABS_KEY]: remaining });
  }
});

// Validate that messages originate from our own content scripts running on
// GitHub PR pages before returning any key material.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "GET_KEYS") return;

  const senderUrl = sender.tab?.url || sender.url || "";
  const isOwnExtension = sender.id === chrome.runtime.id;
  const isGitHubPr = /^https:\/\/github\.com\/.+\/pull\//.test(senderUrl);

  if (!isOwnExtension || !isGitHubPr) {
    sendResponse({ keys: {} });
    return;
  }

  chrome.storage.session.get(STORAGE_KEY, (result) => {
    sendResponse({ keys: result[STORAGE_KEY] || {} });
  });
  return true;
});

// Reconcile tracked tabs on service worker startup to prune IDs for tabs that
// closed while the worker was inactive (MV3 workers are ephemeral).
async function reconcileTabs() {
  const result = await chrome.storage.session.get(TABS_KEY);
  const tabSet = result[TABS_KEY] || [];
  if (tabSet.length === 0) return;

  const openTabs = await chrome.tabs.query({});
  const openIds = new Set(openTabs.map((t) => t.id));
  const valid = tabSet.filter((id) => openIds.has(id));

  if (valid.length === 0) {
    await chrome.storage.session.remove([STORAGE_KEY, TABS_KEY]);
  } else if (valid.length !== tabSet.length) {
    await chrome.storage.session.set({ [TABS_KEY]: valid });
  }
}

chrome.runtime.onStartup.addListener(reconcileTabs);
chrome.runtime.onInstalled.addListener(reconcileTabs);
