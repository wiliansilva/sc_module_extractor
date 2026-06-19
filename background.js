chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // ── Content script pede para executar código na página ───────────────────
  if (msg.type === 'EXEC_IN_PAGE') {
    const tabId = sender.tab?.id;

    if (!tabId) {
      sendResponse({ success: false, error: 'Aba de origem não encontrada' });
      return false;
    }

    // Injeta o runner no contexto MAIN da página
    chrome.scripting.executeScript({
      target: { tabId },
      world:  'MAIN',
      func:   pageRunner,
      args:   [msg.code],
    }).then(results => {
      const payload = results?.[0]?.result;
      if (payload?.success) {
        sendResponse({ success: true, result: payload.result });
      } else {
        sendResponse({ success: false, error: payload?.error || 'EXEC_IN_PAGE falhou' });
      }
    }).catch(err => {
      sendResponse({ success: false, error: err?.message || String(err) });
    });

    return true; // mantém a porta aberta
  }

  // ... outros handlers existentes ...
});

// Função injetada na página — executa o código no contexto MAIN e devolve o
// resultado pelo próprio chrome.scripting.executeScript.
async function pageRunner(code) {
  try {
    const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
    const result = await (new AsyncFunction(code))();
    return { success: true, result };
  } catch (e) {
    return { success: false, error: e?.message || String(e) };
  }
}
