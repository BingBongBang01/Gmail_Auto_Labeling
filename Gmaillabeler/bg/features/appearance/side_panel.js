// bg/features/appearance/side_panel.js
// ---------------- Startup Behavior (Side Panel) ----------------
// 사이드패널은 Gmail 탭에서만 열리도록 탭마다 켜고 끈다.

async function updateSidePanelForTab(tabId, url) {
  if (!url) return;
  let isGmail = false;
  try {
    const urlObj = new URL(url);
    isGmail = urlObj.protocol === "https:" && urlObj.hostname === "mail.google.com";
  } catch (e) {
    isGmail = false;
  }

  if (isGmail) {
    chrome.sidePanel.setOptions({ tabId, path: "sidepanel/sidepanel.html", enabled: true }).catch(() => {});
  } else {
    chrome.sidePanel.setOptions({ tabId, enabled: false }).catch(() => {});
    if (chrome.sidePanel.close) {
      chrome.sidePanel.close({ tabId }).catch(() => {});
    }
  }
}

function registerSidePanelBehavior() {
  // Allow opening the side panel on action click globally
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
  }

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" && tab.url) {
      try {
        await updateSidePanelForTab(tabId, tab.url);
      } catch (e) {
        console.error("SidePanel update failed", e);
      }
    }
  });

  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      if (tab && tab.url) {
        await updateSidePanelForTab(activeInfo.tabId, tab.url);
      }
    } catch (e) {
      console.error("SidePanel active tab check failed", e);
    }
  });
}

export { updateSidePanelForTab, registerSidePanelBehavior };
