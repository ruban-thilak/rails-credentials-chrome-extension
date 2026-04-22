const KEY_IDS = [
  "key-production-us",
  "key-production-euc",
  "key-production-au",
  "key-production-ind",
  "key-production-eun",
  "key-production-mec",
  "key-staging",
  "key-development",
  "key-test",
];

const STORAGE_KEY = "railsCredentialKeys";

function showStatus(message, type) {
  const el = document.getElementById("status");
  el.textContent = message;
  el.className = `status ${type}`;
  setTimeout(() => {
    el.className = "status hidden";
  }, 3000);
}

function collectKeys() {
  const keys = {};
  for (const id of KEY_IDS) {
    const val = document.getElementById(id).value.trim();
    if (val) {
      keys[id] = val;
    }
  }
  return keys;
}

function populateFields(keys) {
  for (const id of KEY_IDS) {
    if (keys[id]) {
      document.getElementById(id).value = keys[id];
    }
  }
}

function validateKeys(keys) {
  for (const [id, val] of Object.entries(keys)) {
    if (!/^[0-9a-fA-F]{32}$/.test(val)) {
      const label = document.querySelector(`label[for="${id}"]`).textContent;
      return `${label}: key must be exactly 32 hex characters.`;
    }
  }
  return null;
}

document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.local.get(STORAGE_KEY, (result) => {
    if (result[STORAGE_KEY]) {
      populateFields(result[STORAGE_KEY]);
    }
  });

  document.getElementById("save-btn").addEventListener("click", () => {
    const keys = collectKeys();
    const error = validateKeys(keys);
    if (error) {
      showStatus(error, "error");
      return;
    }

    chrome.storage.local.set({ [STORAGE_KEY]: keys }, () => {
      showStatus(
        Object.keys(keys).length
          ? `Saved ${Object.keys(keys).length} key(s).`
          : "No keys to save.",
        "success"
      );
    });
  });

  document.getElementById("clear-btn").addEventListener("click", () => {
    for (const id of KEY_IDS) {
      document.getElementById(id).value = "";
    }
    chrome.storage.local.remove(STORAGE_KEY, () => {
      showStatus("All keys cleared.", "success");
    });
  });

  document.querySelectorAll(".toggle-vis").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.target);
      input.type = input.type === "password" ? "text" : "password";
    });
  });
});
