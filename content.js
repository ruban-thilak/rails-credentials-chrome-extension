(() => {
  const DEBUG = false;
  const BTN_CLASS = "rails-creds-decrypt-btn";

  function log(...args) {
    if (DEBUG) console.log("[Rails Creds]", ...args);
  }

  function cleanPath(raw) {
    return raw.replace(/[\u200B-\u200F\u2028-\u202F\u2060\uFEFF]/g, "").trim().replace(/^\/+/, "");
  }

  function filePathToKeyId(filePath) {
    const normalized = cleanPath(filePath);
    const REGIONS = ["us", "euc", "au", "ind", "eun", "mec"];
    const prodMatch = normalized.match(/config\/credentials\/production\/[^/]+-([a-z]+)\.yml\.enc$/);
    if (prodMatch && REGIONS.includes(prodMatch[1])) return `key-production-${prodMatch[1]}`;
    const prodDirect = normalized.match(/config\/credentials\/production\/([a-z]+)\.yml\.enc$/);
    if (prodDirect && REGIONS.includes(prodDirect[1])) return `key-production-${prodDirect[1]}`;
    if (/config\/credentials\/staging\//.test(normalized)) return "key-staging";
    if (/config\/credentials\/development\.yml\.enc$/.test(normalized)) return "key-development";
    if (/config\/credentials\/test\.yml\.enc$/.test(normalized)) return "key-test";
    return null;
  }

  // Keys are retrieved via message passing to the service worker, which
  // validates sender origin before responding. This avoids granting content
  // scripts direct access to chrome.storage.session (least privilege).
  function getStoredKeys() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "GET_KEYS" }, (response) => {
          if (chrome.runtime.lastError) {
            log("Key request failed:", chrome.runtime.lastError.message);
            resolve({});
            return;
          }
          resolve(response?.keys || {});
        });
      } catch (e) {
        log("Extension context invalidated — please reload the page.");
        resolve({});
      }
    });
  }

  // Returns a DOM element rather than an HTML string, so all user-controlled
  // text is set via textContent — eliminating any innerHTML-based XSS vector.
  function buildYamlDiff(oldYaml, newYaml) {
    return renderDiffTable(computeLineDiff(
      oldYaml ? oldYaml.split("\n") : [],
      newYaml ? newYaml.split("\n") : []
    ));
  }

  function computeLineDiff(oldLines, newLines) {
    const m = oldLines.length, n = newLines.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        dp[i][j] = oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    const result = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        result.unshift({ type: "same", oldNum: i, newNum: j, text: oldLines[i - 1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        result.unshift({ type: "add", newNum: j, text: newLines[j - 1] });
        j--;
      } else {
        result.unshift({ type: "del", oldNum: i, text: oldLines[i - 1] });
        i--;
      }
    }
    return result;
  }

  function createDiffRow(line) {
    const tr = document.createElement("tr");
    if (line.type === "add") tr.className = "rails-creds-line-add";
    else if (line.type === "del") tr.className = "rails-creds-line-del";

    const tdOldNum = document.createElement("td");
    tdOldNum.className = "rails-creds-line-num";
    tdOldNum.textContent = line.oldNum ?? "";
    tr.appendChild(tdOldNum);

    const tdNewNum = document.createElement("td");
    tdNewNum.className = "rails-creds-line-num";
    tdNewNum.textContent = line.newNum ?? "";
    tr.appendChild(tdNewNum);

    const tdPrefix = document.createElement("td");
    tdPrefix.className = "rails-creds-line-prefix";
    tdPrefix.textContent = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
    tr.appendChild(tdPrefix);

    const tdContent = document.createElement("td");
    tdContent.className = "rails-creds-line-content";
    const pre = document.createElement("pre");
    pre.textContent = line.text;
    tdContent.appendChild(pre);
    tr.appendChild(tdContent);

    return tr;
  }

  function renderDiffTable(diff) {
    const table = document.createElement("table");
    table.className = "rails-creds-diff-table";
    for (const line of diff) {
      table.appendChild(createDiffRow(line));
    }
    return table;
  }

  function renderSingleFile(yaml, label) {
    const fragment = document.createDocumentFragment();
    const labelDiv = document.createElement("div");
    labelDiv.className = "rails-creds-single-label";
    labelDiv.textContent = label;
    fragment.appendChild(labelDiv);

    const table = document.createElement("table");
    table.className = "rails-creds-diff-table";
    const lines = yaml.split("\n");
    for (let i = 0; i < lines.length; i++) {
      table.appendChild(createDiffRow({
        type: "same", oldNum: i + 1, newNum: "", text: lines[i],
      }));
    }
    fragment.appendChild(table);
    return fragment;
  }

  function showToast(message, type) {
    const existing = document.querySelector(".rails-creds-toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.className = `rails-creds-toast rails-creds-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("rails-creds-toast-visible"));
    setTimeout(() => {
      toast.classList.remove("rails-creds-toast-visible");
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function getPrInfo() {
    const match = window.location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) return null;
    return { owner: match[1], repo: match[2], prNumber: match[3] };
  }

  function extractBranchNames() {
    const refs = { base: null, head: null };
    const selectors = [
      '.commit-ref a', '.commit-ref',
      '[class*="BranchName"]',
      'a[class*="branch-name"]',
    ];
    const refTexts = [];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const text = el.textContent.trim();
        if (text && !refTexts.includes(text)) refTexts.push(text);
      }
      if (refTexts.length >= 2) break;
    }
    if (refTexts.length >= 2) {
      refs.base = refTexts[0];
      refs.head = refTexts[1];
    } else if (refTexts.length === 1) {
      refs.head = refTexts[0];
    }
    if (!refs.base || !refs.head) {
      for (const link of document.querySelectorAll('a[href*="/tree/"]')) {
        const m = (link.getAttribute("href") || "").match(/\/tree\/([^?#]+)$/);
        if (m) {
          if (!refs.base) refs.base = m[1];
          else if (m[1] !== refs.base && !refs.head) refs.head = m[1];
        }
      }
    }
    log("Branch names:", refs);
    return refs;
  }

  /**
   * Find .yml.enc diff blocks that don't already have our decrypt button.
   */
  function findEncryptedFileDiffs() {
    const results = new Map();
    for (const diffBlock of document.querySelectorAll("[id^='diff-']")) {
      // Skip if this block already has our button in the DOM
      if (diffBlock.querySelector("." + BTN_CLASS)) continue;

      for (const link of diffBlock.querySelectorAll("a")) {
        const text = cleanPath(link.textContent);
        if (text.endsWith(".yml.enc") && text.includes("config/credentials/") && !results.has(text)) {
          results.set(text, { diffBlock, headerLink: link });
          log("Found:", text);
          break;
        }
      }
    }
    log(`Total: ${results.size} encrypted file diff(s)`);
    return results;
  }

  function extractContentFromDom(container) {
    const oldParts = [], newParts = [];
    const selectors = [
      "td.blob-code-inner", "td.blob-code", ".blob-code-inner",
      ".js-file-line", "[data-code-text]", ".diff-text-inner",
    ];
    let codeElements = [];
    for (const sel of selectors) {
      codeElements = container.querySelectorAll(sel);
      if (codeElements.length > 0) break;
    }
    for (const el of codeElements) {
      const row = el.closest("tr");
      const text = el.getAttribute("data-code-text") || el.textContent;
      if (!row) continue;
      const allClasses = (row.className || "") + " " + (el.className || "");
      if (allClasses.includes("deletion") || allClasses.includes("removed")) oldParts.push(text);
      else if (allClasses.includes("addition") || allClasses.includes("added")) newParts.push(text);
      else { oldParts.push(text); newParts.push(text); }
    }
    if (oldParts.length === 0 && newParts.length === 0) {
      for (const row of container.querySelectorAll("table tr")) {
        const cells = row.querySelectorAll("td");
        if (cells.length === 0) continue;
        const text = cells[cells.length - 1].textContent;
        if (!text?.trim()) continue;
        const cls = row.className + " " + Array.from(cells).map(c => c.className).join(" ");
        if (cls.includes("deletion") || cls.includes("removed")) oldParts.push(text);
        else if (cls.includes("addition") || cls.includes("added")) newParts.push(text);
        else { oldParts.push(text); newParts.push(text); }
      }
    }
    const result = {
      old: oldParts.join("").trim() || null,
      new: newParts.join("").trim() || null,
    };
    log("DOM content:", { oldLen: result.old?.length || 0, newLen: result.new?.length || 0 });
    return result;
  }

  // Hardcode origin and validate path components to prevent credential-
  // forwarded requests to unintended repositories via path traversal.
  async function fetchRawContent(owner, repo, ref, filePath) {
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo)) {
      throw new Error("Invalid owner or repo name");
    }
    if (/\.\./.test(ref) || /\.\./.test(filePath)) {
      throw new Error("Path traversal detected");
    }
    const url = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/raw/${ref}/${filePath}`;
    log("Fetching:", url);
    const resp = await fetch(url, { credentials: "same-origin" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
    return resp.text();
  }

  function createDecryptButton() {
    const btn = document.createElement("button");
    btn.className = BTN_CLASS;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
      </svg>
      <span>Decrypt</span>
    `;
    btn.title = "Decrypt credentials for review";
    return btn;
  }

  function createHideButton() {
    const btn = document.createElement("button");
    btn.className = "rails-creds-hide-btn";
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
      <span>Hide Secrets</span>
    `;
    btn.title = "Hide decrypted content";
    return btn;
  }

  async function handleDecrypt(filePath, diffBlock, prInfo, keys) {
    const keyId = filePathToKeyId(filePath);
    if (!keyId) { showToast(`No key mapping for: ${filePath}`, "error"); return; }
    const masterKey = keys[keyId];
    if (!masterKey) {
      showToast(`No key configured for ${keyId.replace("key-", "").replace(/-/g, " ").toUpperCase()}. Open extension popup.`, "warn");
      return;
    }

    const domContent = extractContentFromDom(diffBlock);
    const branches = extractBranchNames();
    let oldYaml = null, newYaml = null;

    if (domContent.new) {
      try { newYaml = await RailsDecryptor.decrypt(domContent.new, masterKey); log("Decrypted new from DOM"); }
      catch (e) { log("DOM decrypt (new) failed:", e.message); }
    }
    if (domContent.old && domContent.old !== domContent.new) {
      try { oldYaml = await RailsDecryptor.decrypt(domContent.old, masterKey); log("Decrypted old from DOM"); }
      catch (e) { log("DOM decrypt (old) failed:", e.message); }
    }
    if (!newYaml && branches.head) {
      try {
        log("Fetching head:", branches.head);
        newYaml = await RailsDecryptor.decrypt(await fetchRawContent(prInfo.owner, prInfo.repo, branches.head, filePath), masterKey);
      } catch (e) { log("Head fetch failed:", e.message); }
    }
    if (!oldYaml && branches.base) {
      try {
        log("Fetching base:", branches.base);
        oldYaml = await RailsDecryptor.decrypt(await fetchRawContent(prInfo.owner, prInfo.repo, branches.base, filePath), masterKey);
      } catch (e) { log("Base fetch failed:", e.message); }
    }
    if (!newYaml && !oldYaml) {
      try {
        log("Trying pull ref...");
        newYaml = await RailsDecryptor.decrypt(await fetchRawContent(prInfo.owner, prInfo.repo, `pull/${prInfo.prNumber}/head`, filePath), masterKey);
      } catch (e) { log("Pull ref failed:", e.message); }
    }
    if (!oldYaml && !newYaml) {
      showToast(`Decryption failed for ${filePath}. Check your master key.`, "error");
      return;
    }

    const decryptedDiv = document.createElement("div");
    decryptedDiv.className = "rails-creds-decrypted";

    const banner = document.createElement("div");
    banner.className = "rails-creds-banner";
    const bannerSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    bannerSvg.setAttribute("width", "14");
    bannerSvg.setAttribute("height", "14");
    bannerSvg.setAttribute("viewBox", "0 0 24 24");
    bannerSvg.setAttribute("fill", "none");
    bannerSvg.setAttribute("stroke", "currentColor");
    bannerSvg.setAttribute("stroke-width", "2");
    const svgPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    svgPath.setAttribute("d", "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z");
    bannerSvg.appendChild(svgPath);
    const svgCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    svgCircle.setAttribute("cx", "12");
    svgCircle.setAttribute("cy", "12");
    svgCircle.setAttribute("r", "3");
    bannerSvg.appendChild(svgCircle);
    banner.appendChild(bannerSvg);
    const bannerText = document.createElement("span");
    bannerText.textContent = "Decrypted credentials \u2014 for review only";
    banner.appendChild(bannerText);
    decryptedDiv.appendChild(banner);

    const contentDiv = document.createElement("div");
    contentDiv.className = "rails-creds-content";
    if (oldYaml && newYaml) contentDiv.appendChild(buildYamlDiff(oldYaml, newYaml));
    else if (newYaml) contentDiv.appendChild(renderSingleFile(newYaml, "Current"));
    else contentDiv.appendChild(renderSingleFile(oldYaml, "Previous"));
    decryptedDiv.appendChild(contentDiv);

    const diffBody = diffBlock.querySelector(".js-file-content, .blob-wrapper, .data, table");
    if (diffBody) { diffBody.style.display = "none"; diffBody.after(decryptedDiv); }
    else diffBlock.appendChild(decryptedDiv);

    showToast(`Decrypted: ${filePath.split("/").pop()}`, "success");
    return decryptedDiv;
  }

  async function processPage() {
    if (!isExtensionAlive()) return;
    const prInfo = getPrInfo();
    if (!prInfo) return;

    const keys = await getStoredKeys();
    if (Object.keys(keys).length === 0) return;

    const fileDiffs = findEncryptedFileDiffs();
    if (fileDiffs.size === 0) return;

    for (const [filePath, { diffBlock, headerLink }] of fileDiffs) {
      const keyId = filePathToKeyId(filePath);
      log(`Processing: ${filePath} → ${keyId}`);

      const decryptBtn = createDecryptButton();
      const hideBtn = createHideButton();
      hideBtn.style.display = "none";

      const btnContainer = document.createElement("div");
      btnContainer.className = "rails-creds-btn-container";
      btnContainer.appendChild(decryptBtn);
      btnContainer.appendChild(hideBtn);

      // Insert next to the file name <h3>
      const h3 = headerLink.closest("h3");
      const insertTarget = h3 ? h3.parentElement : headerLink.parentElement;

      if (insertTarget) {
        // Insert after the h3/link, not inside it (avoids React clobbering)
        if (h3 && h3.nextSibling) {
          insertTarget.insertBefore(btnContainer, h3.nextSibling);
        } else {
          insertTarget.appendChild(btnContainer);
        }
        log("Button added for:", filePath);
      }

      decryptBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        decryptBtn.disabled = true;
        decryptBtn.querySelector("span").textContent = "Decrypting...";
        try {
          const decryptedDiv = await handleDecrypt(filePath, diffBlock, prInfo, keys);
          if (decryptedDiv) {
            decryptBtn.style.display = "none";
            hideBtn.style.display = "";
            hideBtn.onclick = (e2) => {
              e2.preventDefault();
              e2.stopPropagation();
              const isHidden = decryptedDiv.style.display === "none";
              decryptedDiv.style.display = isHidden ? "" : "none";
              const db = diffBlock.querySelector(".js-file-content, .blob-wrapper, .data, table");
              if (db) db.style.display = isHidden ? "none" : "";
              hideBtn.querySelector("span").textContent = isHidden ? "Hide Secrets" : "Show Decrypted";
            };
          }
        } catch (err) {
          console.error("[Rails Creds]", err);
          showToast(`Error: ${err.message}`, "error");
        } finally {
          decryptBtn.disabled = false;
          decryptBtn.querySelector("span").textContent = "Decrypt";
        }
      });
    }
  }

  /**
   * Wait for the page to stop mutating (GitHub's React rendering is done).
   * Resolves once no DOM mutations have occurred for `quietMs` milliseconds.
   */
  function waitForIdle(quietMs = 2000) {
    return new Promise((resolve) => {
      let timer = setTimeout(resolve, quietMs);
      const obs = new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          obs.disconnect();
          resolve();
        }, quietMs);
      });
      obs.observe(document.body, { childList: true, subtree: true });
    });
  }

  async function initOnceStable() {
    if (!isExtensionAlive()) return;
    log("Waiting for page to finish rendering...");
    await waitForIdle(2000);
    if (!isExtensionAlive()) return;
    log("Page idle — injecting buttons");
    await processPage();
  }

  function isExtensionAlive() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  function init() {
    log("Initialized:", window.location.href);

    initOnceStable();

    document.addEventListener("turbo:load", () => initOnceStable());
    document.addEventListener("pjax:end", () => initOnceStable());

    const intervalId = setInterval(() => {
      if (!isExtensionAlive()) {
        log("Extension context invalidated — stopping periodic check.");
        clearInterval(intervalId);
        return;
      }
      const diffBlocks = document.querySelectorAll("[id^='diff-']");
      for (const block of diffBlocks) {
        if (block.querySelector("." + BTN_CLASS)) continue;
        for (const link of block.querySelectorAll("a")) {
          if (cleanPath(link.textContent).endsWith(".yml.enc")) {
            log("Button missing, re-adding...");
            processPage();
            return;
          }
        }
      }
    }, 5000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
