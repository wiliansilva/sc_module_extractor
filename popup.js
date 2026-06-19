// popup.js - ScriptCase Module Extractor
let capturedData = null;
let currentTab = null;

chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
  currentTab = tabs[0];
  autoDetectModule();
});

function sendMessageAsync(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, resp => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(resp);
    });
  });
}

function isInjectableUrl(url) {
  return /^https?:\/\//i.test(url || '');
}

// Sends a message to the tab's content script, injecting content.js first if it
// isn't there yet (e.g. the page was open before the extension was loaded).
async function sendToTab(tabId, message) {
  try {
    return await sendMessageAsync(tabId, message);
  } catch (e) {
    if (!/Receiving end does not exist|Could not establish connection/i.test(e.message)) throw e;

    const tab = await chrome.tabs.get(tabId);
    if (!isInjectableUrl(tab?.url)) {
      throw new Error('Abra uma página HTTP/HTTPS do ScriptCase antes de capturar.');
    }

    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      return await sendMessageAsync(tabId, message);
    } catch (injectErr) {
      throw new Error('Não consegui conectar ao conteúdo da página. Recarregue a aba do ScriptCase e tente novamente.');
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });
  document.getElementById('btnCapture').addEventListener('click', startCapture);
  document.getElementById('btnCopyJSON').addEventListener('click', copyJSON);
  document.getElementById('btnDownloadJSON').addEventListener('click', downloadJSON);
});

async function autoDetectModule() {
  if (!currentTab) return;
  if (!isInjectableUrl(currentTab.url)) {
    document.getElementById('moduleNameDisplay').textContent = 'Abra uma aba do ScriptCase';
    return;
  }
  try {
    const resp = await sendToTab(currentTab.id, { type: 'GET_MODULE_NAME' });
    if (resp && resp.success) {
      document.getElementById('moduleName').value = resp.name;
      document.getElementById('moduleNameDisplay').textContent = 'Módulo: ' + resp.name;
    } else {
      document.getElementById('moduleNameDisplay').textContent = 'ScriptCase não detectado';
    }
  } catch (e) {
    document.getElementById('moduleNameDisplay').textContent = 'ScriptCase não detectado';
  }
}

function showTab(tab) {
  ['capture', 'config', 'output'].forEach(t => {
    document.getElementById('tab-' + t).style.display = t === tab ? '' : 'none';
  });
  document.querySelectorAll('.tab-btn').forEach((btn, i) => {
    btn.classList.toggle('active', ['capture', 'config', 'output'][i] === tab);
  });
}

function setStatus(msg, type = 'info') {
  const el = document.getElementById('statusMsg');
  el.textContent = msg;
  el.className = 'status ' + type;
}

function setProgress(v) {
  document.getElementById('progressBar').style.width = v + '%';
}

async function startCapture() {
  if (!currentTab) { setStatus('Nenhuma aba ativa encontrada.', 'error'); return; }
  if (!isInjectableUrl(currentTab.url)) {
    setStatus('Abra uma página HTTP/HTTPS do ScriptCase antes de capturar.', 'error');
    return;
  }

  const config = {
    kind:         document.getElementById('kindSelect').value,
    moduleName:   document.getElementById('moduleName').value,
    title:        document.getElementById('moduleTitle').value,
    subtitle:     document.getElementById('moduleSubtitle').value,
    params:       document.getElementById('moduleParams').value,
    assets:       document.getElementById('moduleAssets').value,
    parentModule: document.getElementById('parentModule').value,
    servicesPath: document.getElementById('servicesPath').value,
  };

  document.getElementById('btnCapture').disabled = true;
  setStatus('Capturando dados... isso pode levar alguns instantes.', 'info');
  setProgress(0);

  const progressListener = msg => {
    if (msg.type === 'progress') setProgress(msg.value);
  };
  chrome.runtime.onMessage.addListener(progressListener);

  try {
    const resp = await sendToTab(currentTab.id, { type: 'EXTRACT', config });
    if (!resp || !resp.success) {
      setStatus('Erro: ' + (resp?.error || 'Resposta inválida'), 'error');
      return;
    }
    capturedData = resp.data;
    setStatus('✅ Captura concluída! ' + resp.data.schema.length + ' campos encontrados.', 'success');
    setProgress(100);
    renderConfig(resp.data);
    renderOutput(resp.data);
    showTab('output');
  } catch (e) {
    setStatus('Erro: ' + e.message, 'error');
  } finally {
    chrome.runtime.onMessage.removeListener(progressListener);
    document.getElementById('btnCapture').disabled = false;
  }
}

function renderConfig(data) {
  document.getElementById('schemaCount').textContent = data.schema.length;
  document.getElementById('schemaList').innerHTML = data.schema.map(s =>
    `<div class="field-item">
      <span class="field-chip">${s.type}</span>
      <span>${s.field}</span>
      ${s.required ? '<span style="color:#e94560;font-size:10px">*req</span>' : ''}
    </div>`
  ).join('');

  let totalFields = data.blocks.reduce((acc, b) => acc + b.fields.length, 0);
  document.getElementById('blockCount').textContent = totalFields;
  document.getElementById('blockList').innerHTML = data.blocks.map(b =>
    `<div style="font-size:11px;color:#7ab3f5;padding:4px 0;border-bottom:1px solid #1a2a3a;font-weight:600">${b.name} (${b.fields.length} campos)</div>` +
    b.fields.map(f =>
      `<div class="field-item" style="padding-left:12px">
        <span class="field-chip">${f.input}</span>
        <span>${f.name}</span>
      </div>`
    ).join('')
  ).join('');
}

function renderOutput(data) {
  const output = document.getElementById('jsonOutput');
  output.style.display = 'block';
  output.textContent = JSON.stringify(data, null, 2);
}

function copyJSON() {
  if (!capturedData) { setStatus('Nenhum dado capturado ainda.', 'error'); return; }
  const text = JSON.stringify(capturedData, null, 2);
  navigator.clipboard.writeText(text)
    .then(() => setStatus('✅ JSON copiado para a área de transferência!', 'success'))
    .catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      setStatus('✅ JSON copiado!', 'success');
    });
}

function downloadJSON() {
  if (!capturedData) { setStatus('Nenhum dado capturado ainda.', 'error'); return; }
  const text = JSON.stringify(capturedData, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (capturedData.module?.name || 'module') + '.json';
  a.click();
  URL.revokeObjectURL(url);
}
