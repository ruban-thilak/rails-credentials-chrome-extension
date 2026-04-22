const STORAGE_KEY = "railsCredentialKeys";
const TABS_KEY = "railsCredentialTabs";

chrome.storage.session.setAccessLevel({
  accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS",
});

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
