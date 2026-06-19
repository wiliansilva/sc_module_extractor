// content.js - ScriptCase Module Extractor v3.0
(function () {
  'use strict';

  if (window.__scModuleExtractorInjected) return;
  window.__scModuleExtractorInjected = true;

  // ─────────────────────────────────────────────
  // INJEÇÃO DE SCRIPT NA PÁGINA
  // O content script roda em contexto isolado e não pode chamar
  // funções da página (como nm_update_menu). A solução é injetar
  // um <script> na página principal que executa no contexto correto
  // e retorna o resultado via window.postMessage.
  // ─────────────────────────────────────────────

    function injectAndRun(code) {
  return new Promise((resolve, reject) => {
    const requestId = '__sc_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    chrome.runtime.sendMessage(
      { type: 'EXEC_IN_PAGE', code, requestId },
      (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (res?.success) resolve(res.result);
        else reject(new Error(res?.error || 'EXEC_IN_PAGE falhou'));
      }
    );
  });
}

  // ─────────────────────────────────────────────
  // HELPERS que rodam DENTRO da página via injectAndRun
  // ─────────────────────────────────────────────

  // Retorna os dados básicos dos iframes (executa na página)
  const PAGE_HELPERS = `
    function _getCtx() {
      const main = document.getElementById('nmFrmScase');
      if (!main) return null;
      const mainDoc = main.contentDocument;
      const activeLi = mainDoc.querySelector('li.nmAbaAppOn');
      if (!activeLi) return null;
      const tabId = activeLi.id?.replace('sys_aba_page_', '') || '1';
      const editorIframe = mainDoc.getElementById('id_ifr_bottom' + tabId)
                        || mainDoc.getElementById('id_ifr_bottom1');
      if (!editorIframe) return null;
      const editorDoc = editorIframe.contentDocument;
      return {
        editorDoc,
        leftIframe:  editorDoc.getElementById('id_ifr_left_1'),
        rightIframe: editorDoc.getElementById('id_ifr_right_1'),
        moduleName:  activeLi.querySelector('.nmAbaAppText')?.textContent?.trim() || '',
      };
    }
    function _domGet(doc, name) {
      const el = doc.querySelector('[name="' + name + '"]');
      if (!el) return '';
      if (el.type === 'radio') { const c = doc.querySelector('[name="' + name + '"]:checked'); return c ? c.value : ''; }
      if (el.tagName === 'SELECT') return el.options[el.selectedIndex]?.value || '';
      return el.value || '';
    }
    function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
    async function _callMenu(leftWin, rightIframe, args, waitMs = 1800) {
      const rd0 = rightIframe.contentDocument;
      const snap0 = _domGet(rd0,'Label') + '|' + _domGet(rd0,'form_edit') + '|' + _domGet(rd0,'NomeTabela');
      leftWin.nm_update_menu(...args);
      const start = Date.now();
      while (Date.now() - start < waitMs + 2000) {
        await _delay(80);
        const rd = rightIframe.contentDocument;
        const snap = _domGet(rd,'Label') + '|' + _domGet(rd,'form_edit') + '|' + _domGet(rd,'NomeTabela');
        if (snap !== snap0 || Date.now() - start > waitMs) break;
      }
      await _delay(150);
    }
  `;

  // ─────────────────────────────────────────────
  // UTILITÁRIOS (content script)
  // ─────────────────────────────────────────────

  function toPascal(s) {
    if (!s) return '';
    return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
  }
  function toSnake(s) {
    if (!s) return '';
    return s.replace(/([A-Z])/g, (m, c, i) => (i > 0 ? '_' : '') + c.toLowerCase());
  }

  function mapType(html, sql, tipoDado) {
    const h = (html     || '').toUpperCase();
    const s = (sql      || '').toLowerCase();
    const d = (tipoDado || '').toUpperCase();
    const dateTypes   = new Set(['DATA','HORA','DATAHORA']);
    const nonDateHtml = new Set(['TEXT','TEXTAREA','PASSWORD','CHECKBOX','CHKBOX','SELECT','RADIO','NUMEROEDT','DECIMALEDT','LOOKUP']);
    if (dateTypes.has(d) && !nonDateHtml.has(h)) {
      if (d === 'DATA')     return 'date';
      if (d === 'HORA')     return 'time';
      if (d === 'DATAHORA') return 'datetime';
    }
    if (h === 'CHECKBOX' || h === 'CHKBOX')                                     return 'boolean';
    if (s === 'integer' || s === 'bigint' || s === 'int' || s === 'smallint')   return 'integer';
    if (s === 'decimal' || s === 'float'  || s === 'double' || s === 'numeric') return 'float';
    if (h === 'NUMEROEDT'  || h === 'NUMERO')                                   return 'integer';
    if (h === 'DECIMALEDT' || h === 'DECIMAL')                                  return 'float';
    if (h === 'DATE')                                                            return 'date';
    if (h === 'DATETIME')                                                        return 'datetime';
    if (h === 'TIME')                                                            return 'time';
    if (d === 'NUMEROEDT'  || d === 'NUMERO')                                   return 'integer';
    if (d === 'DECIMAL'    || d === 'VALOR')                                    return 'float';
    return 'string';
  }

  function mapInput(html, tipoDado) {
    const d = (tipoDado || '').toUpperCase();
    const semanticMap = {
      DATA:'date', HORA:'time', DATAHORA:'datetime',
      NUMEROEDT:'text', DECIMAL:'text', VALOR:'text',
      MULTITEXTO:'textarea', CIC:'text', CNPJ:'text',
      CICCNPJ:'text', TPCICCNPJ:'text', CEP:'text',
      EMAIL:'text', URL:'text', CORHTML:'text',
      EDITOR_HTML:'textarea', FORM_IMAGE_HTML:'file', FORM_LABEL:'label',
    };
    if (d && semanticMap[d]) return semanticMap[d];
    const map = {
      TEXT:'text', TEXTAREA:'textarea', PASSWORD:'password',
      DATE:'date', DATETIME:'datetime', TIME:'time',
      SELECT:'select', RADIO:'radio', CHECKBOX:'checkbox', CHKBOX:'checkbox',
      NUMEROEDT:'text', NUMERO:'text', DECIMALEDT:'text', DECIMAL:'text',
      LOOKUP:'select2', CPFCNPJ:'text', CEP:'text', FILE:'file', IMAGE:'file',
      HIDDEN:'hidden', LABEL:'label', HYPERLINK:'link', EMAIL:'text', URL:'text',
    };
    return map[(html || '').toUpperCase()] || 'text';
  }

  function sendProgress(v) {
    try { chrome.runtime.sendMessage({ type: 'progress', value: v }); } catch(e) {}
  }

  // ─────────────────────────────────────────────
  // EXTRAÇÃO PRINCIPAL — tudo via injectAndRun
  // ─────────────────────────────────────────────

  async function extract(config) {

    // ── 1. Verifica se ScriptCase está aberto ─────────────────────────────────
    const check = await injectAndRun(`
      ${PAGE_HELPERS}
      const ctx = _getCtx();
      if (!ctx) return { ok: false };
      return { ok: true, moduleName: ctx.moduleName };
    `);
    if (!check?.ok) throw new Error('ScriptCase não encontrado. Abra um módulo no ScriptCase.');

    const moduleName      = check.moduleName;
    const moduleNamePascal = config.moduleName || toPascal(moduleName);
    const prefix          = config.prefix || toSnake(moduleNamePascal);
    sendProgress(5);

    // ── 2. Expande fields_tit e coleta lista de campos ────────────────────────
    const fieldsResult = await injectAndRun(`
      ${PAGE_HELPERS}
      const ctx = _getCtx();
      if (!ctx) return [];
      const leftDoc = ctx.leftIframe.contentDocument;

      // Expande fields_tit se fechado
      const fieldsTit = leftDoc.getElementById('fields_tit');
      if (fieldsTit && fieldsTit.getAttribute('aria-expanded') !== 'true') {
        const toggle = fieldsTit.querySelector('i.jstree-ocl');
        toggle && toggle.click();
        await _delay(1200);
      }

      // Lê os filhos
      return Array.from(leftDoc.querySelectorAll('li[id^="fields_tit_itens_"]')).map(li => {
        const anchor = li.querySelector('a.jstree-anchor');
        const href   = anchor?.getAttribute('href') || '';
        // Extrai args do nm_update_menu do href: nm_update_menu('fld', '40', 'N', 'N', 'form', null, 'form_40')
        const match  = href.match(/nm_update_menu\\((.+?)\\)\\s*$/);
        const args   = match ? match[1].split(',').map(s => {
          s = s.trim();
          if (s === 'null') return null;
          if (s.startsWith("'") || s.startsWith('"')) return s.slice(1, -1);
          return s;
        }) : null;
        return {
          id:   li.id.replace('fields_tit_itens_', ''),
          name: (anchor?.title || anchor?.textContent || '').trim(),
          args, // args completos do nm_update_menu para este campo
        };
      }).filter(f => f.name && !f.name.startsWith('['));
    `);

    const fieldItems = Array.isArray(fieldsResult) ? fieldsResult : [];
    console.log('[EXTRACTOR] Campos:', fieldItems.map(f => `${f.id}:${f.name}`));
    sendProgress(12);

    // ── 3. Coleta detalhes de cada campo via nm_update_menu ───────────────────
    const details = {};
    const toCapture = fieldItems.slice(0, 60);

    for (let i = 0; i < toCapture.length; i++) {
      const f = toCapture[i];
      const fieldData = await injectAndRun(`
        ${PAGE_HELPERS}
        const ctx = _getCtx();
        if (!ctx) return null;
        const leftWin  = ctx.leftIframe.contentWindow;
        const rightIfr = ctx.rightIframe;
        const args = ${JSON.stringify(f.args)};
        if (!args) return null;
        await _callMenu(leftWin, rightIfr, args, 2000);
        const rd = rightIfr.contentDocument;
        return {
          htmlTipo:   _domGet(rd, 'Html_Tipo')   || 'TEXT',
          tipoSql:    _domGet(rd, 'Tipo_Sql')    || 'varchar',
          tipoDado:   _domGet(rd, 'Tipo_Dado_P') || _domGet(rd, 'hid_sel_type_aux') || '',
          label:      (_domGet(rd, 'Label') || ${JSON.stringify(f.name)}).replace(/[{}]/g, ''),
          valInicial: _domGet(rd, 'Val_Inicial') || '',
          required:   _domGet(rd, 'form_val_tipo') === 'S',
        };
      `);
      if (fieldData) {
        details[f.name] = { name: f.name, ...fieldData };
        console.log('[EXTRACTOR]', f.name, '| label:', fieldData.label, '| tipo:', fieldData.htmlTipo, '| tipoDado:', fieldData.tipoDado);
      }
      sendProgress(12 + Math.round((i + 1) / toCapture.length * 50));
    }

    // ── 4. Blocks Settings: nm_update_menu('app', 'blockdef') ────────────────
    const blockResult = await injectAndRun(`
        ${PAGE_HELPERS}
        const ctx = _getCtx();
        if (!ctx) return null;
        await _callMenu(ctx.leftIframe.contentWindow, ctx.rightIframe, ['app', 'blockdef'], 2500);
        const rd = ctx.rightIframe.contentDocument;

        // Lê todos os blocos: t_nome[N] existe para cada bloco
        // Os índices N NÃO são sequenciais (ex: 14, 0, 24, 25...) — são IDs internos
        // Precisamos varrer os inputs com name="t_nome[*]"
        const blocks = [];
        const nomeEls = Array.from(rd.querySelectorAll('input[name^="t_nome["]'));
        nomeEls.forEach(nomeEl => {
            const match = nomeEl.name.match(/t_nome\[(\d+)\]/);
            if (!match) return;
            const idx = match[1];
            blocks.push({
            idx,                   // índice interno do ScriptCase
            name:    nomeEl.value || ('Bloco_' + idx),
            title:   _domGet(rd, 't_texto[' + idx + ']') || nomeEl.value,
            columns: parseInt(_domGet(rd, 'l_colunas[' + idx + ']') || '2') || 2,
            exibe:   _domGet(rd, 't_exibe[' + idx + ']')    || 'S',
            largura: _domGet(rd, 'b_width[' + idx + ']')    || '100%',
            colapsa: _domGet(rd, 't_collapse[' + idx + ']') || 'N',
            fields:  [],   // preenchido no próximo passo
            });
        });

        return blocks;
    `);

    // ── 5. Fields Configuration: nm_update_menu('app', 'FieldsEditionDef') ──
    // Captura bloco de cada campo + label + datatype + flags (new/update/required/pk)
    const editionResult = await injectAndRun(`
        ${PAGE_HELPERS}
        const ctx = _getCtx();
        if (!ctx) return null;
        await _callMenu(ctx.leftIframe.contentWindow, ctx.rightIframe, ['app', 'FieldsEditionDef'], 3000);
        const rd = ctx.rightIframe.contentDocument;
        const rows = Array.from(rd.querySelectorAll('tr'));

        // Percorre linhas em ordem: Block: aparece antes dos campos do bloco
        let blockSeq = [];       // sequência de blocos na ordem de aparição
        let currentBlockTitle = null;
        const fieldMap = {};     // fieldName -> dados do campo

        rows.forEach(tr => {
            // Detecta linha de bloco pelo td que contém "Block:"
            const blockTd = Array.from(tr.querySelectorAll('td'))
            .find(td => td.textContent.trim().startsWith('Block:'));
            if (blockTd) {
            currentBlockTitle = blockTd.textContent.replace('Block:', '').trim();
            // Adiciona bloco à sequência (apenas se não for duplicado consecutivo)
            if (!blockSeq.length || blockSeq[blockSeq.length-1].title !== currentBlockTitle) {
                blockSeq.push({ title: currentBlockTitle, fields: [] });
            }
            return;
            }

            // Detecta linha de campo
            const nameInput = tr.querySelector('input[name$="][1]"]');
            if (!nameInput || !currentBlockTitle) return;
            const idMatch = nameInput.name.match(/\\[(\\d+)\\]\\[1\\]/);
            if (!idMatch) return;
            const fId = idMatch[1];

            const get = idx => {
            const el = rd.querySelector('[name="arr_fields_edition_def[' + fId + '][' + idx + ']"]');
            if (!el) return '';
            if (el.tagName === 'SELECT') return el.options[el.selectedIndex]?.value || '';
            return el.value || '';
            };

            const fieldName = get(1);
            if (!fieldName) return;

            // Adiciona campo ao bloco atual
            const curBlk = blockSeq[blockSeq.length - 1];
            if (curBlk) curBlk.fields.push(fieldName);

            fieldMap[fieldName] = {
            blockTitle: currentBlockTitle,
            label:      get(2),
            datatype:   get(3),
            isNew:      get(4) === 'S',
            isUpdate:   get(5) === 'S',
            isReadOnly: get(6) === 'S',
            isRequired: get(7) === 'S',
            isPK:       get(8) === 'S',
            };
        });

        return { blockSeq, fieldMap };
    `);

    
    const blockdefResult = await injectAndRun(`
        ${PAGE_HELPERS}
        const ctx = _getCtx();
        if (!ctx) return null;
        await _callMenu(ctx.leftIframe.contentWindow, ctx.rightIframe, ['app', 'blockdef'], 3000);
        const rd = ctx.rightIframe.contentDocument;

        const nomeEls = Array.from(rd.querySelectorAll('input[name^="t_nome["]'));
        return nomeEls.map(el => {
            const m = el.name.match(/t_nome\\[(\\d+)\\]/);
            if (!m) return null;
            const idx = m[1];
            const getV = field => {
            const e = rd.querySelector('[name="' + field + '[' + idx + ']"]');
            if (!e) return '';
            if (e.tagName === 'SELECT') return e.options[e.selectedIndex]?.value || '';
            return e.value || '';
            };
            // Limpa o título removendo HTML (ex: <span>*</span>)
            const rawTitle = getV('t_texto');
            const cleanTitle = rawTitle.replace(/<[^>]+>/g, '').trim();
            return {
            idx,
            name:    el.value,
            title:   rawTitle,
            cleanTitle,
            columns: parseInt(getV('l_colunas')) || 2,
            largura: getV('b_width') || '100%',
            colapsa: getV('t_collapse') || 'N',
            };
        }).filter(Boolean);
    `);


    sendProgress(70);

    // ── 5. Coleta SQL ─────────────────────────────────────────────────────────
    const sqlResult = await injectAndRun(`
      ${PAGE_HELPERS}
      const ctx = _getCtx();
      if (!ctx) return null;
      const leftWin  = ctx.leftIframe.contentWindow;
      const rightIfr = ctx.rightIframe;
      await _callMenu(leftWin, rightIfr, ['app', 'sql'], 2000);
      const rd = rightIfr.contentDocument;
      return {
        table:      _domGet(rd, 'NomeTabela')  || '',
        connection: _domGet(rd, 'NomeConexao') || '',
        formParams: _domGet(rd, 'Form_Params') || '',
      };
    `);
    console.log('[EXTRACTOR] SQL:', sqlResult);
    sendProgress(82);

    // ── 6. Monta blockData cruzando blockResult + editionResult ──────────────
   let blockData = [];

    if (editionResult?.blockSeq?.length > 0 && blockdefResult?.length > 0) {
        const { blockSeq, fieldMap } = editionResult;

        // Monta mapa de titulo limpo -> lista de blocos do blockdef
        // (pode haver títulos duplicados, por isso é array)
        const blockdefByTitle = {};
        blockdefResult.forEach(b => {
            const key = b.cleanTitle || b.name;
            if (!blockdefByTitle[key]) blockdefByTitle[key] = [];
            blockdefByTitle[key].push(b);
        });

        // Contador de uso por título para desambiguar duplicatas
        const usageCount = {};

        blockData = blockSeq.map(seq => {
            // Limpa o título do FieldsEditionDef (remove * e espaços extras)
            const cleanSeqTitle = seq.title.replace(/<[^>]+>/g,'').replace(/\s*\*\s*$/, '').trim();
            const key = cleanSeqTitle;

            const candidates = blockdefByTitle[key] || [];
            const useIdx = usageCount[key] || 0;
            const blkDef = candidates[useIdx] || null;
            usageCount[key] = useIdx + 1;

            return {
            name:    blkDef?.name    || cleanSeqTitle || seq.title,
            title:   blkDef?.cleanTitle || seq.title,
            rawTitle: blkDef?.title  || seq.title,
            columns: blkDef?.columns || 2,
            largura: blkDef?.largura || '100%',
            fields:  seq.fields.map(f => ({ rawId: f, name: f })),
            };
        });

        } else {
        // Fallback
        blockData = [{
            name: 'Dados', title: 'Dados', columns: 2,
            fields: fieldItems.map(f => ({ rawId: f.id, name: f.name })),
        }];
    }

    // ── 7. Schema — usa fieldMap para enriquecer tipos ────────────────────────
// (mantém a lógica atual de details[] + adiciona isRequired do fieldMap)
const fieldMap = editionResult?.fieldMap || {};

const schema = fieldItems.map(f => {
  const d   = details[f.name] || {};
  const ed  = fieldMap[f.name] || {};
  const type = mapType(d.htmlTipo, d.tipoSql, d.tipoDado);
  let def = d.valInicial || '';
  if (type === 'boolean') def = (def === 'S' || def === 'true' || def === '1');
  else if (type === 'integer') def = def ? (parseInt(def)   || 0)   : 0;
  else if (type === 'float')   def = def ? (parseFloat(def) || 0.0) : 0.0;
  return {
    field:    f.name,
    type,
    required: ed.isRequired || d.required || false,
    default:  type === 'string' ? (def || '') : def,
  };
});

// ── 8. Monta blocks com label e input do fieldMap + details ──────────────
const blocks = blockData.map(blk => ({
  name:    blk.name,
  title:   blk.title,
  columns: blk.columns,
  fields:  blk.fields.map(bf => {
    const d   = details[bf.name]  || {};
    const ed  = fieldMap[bf.name] || {};
    const input = mapInput(d.htmlTipo || 'TEXT', d.tipoDado);
    // Label: prefere o do FieldsEditionDef (ed.label), depois o do campo individual (d.label)
    const label = (ed.label || d.label || bf.name).replace(/[{}]/g, '');
    const fObj = { name: bf.name, label, input };
    if (ed.isRequired || d.required) fObj.required  = true;
    if (ed.isReadOnly)               fObj.readOnly   = true;
    if (ed.isPK)                     fObj.pk         = true;
    return fObj;
  }),
}));

    const base   = config.servicesPath || ('modules/' + moduleNamePascal);
    const sp     = toSnake(moduleNamePascal);
    const params = config.params
      ? config.params.split(',').map(p => p.trim()).filter(Boolean)
      : (sqlResult?.formParams || '').split(',').map(p => p.trim()).filter(Boolean);

    sendProgress(100);

    return {
      kind: config.kind || 'form',
      module: {
        name:         moduleNamePascal,
        title:        config.title    || moduleNamePascal,
        subtitle:     config.subtitle || '',
        prefix,
        connection:   sqlResult?.connection || '',
        table:        sqlResult?.table      || '',
        params,
        parentModule: config.parentModule || '',
        assets:       config.assets ? config.assets.split(',').map(a => a.trim()).filter(Boolean) : [],
      },
      services: {
        get:    { name: sp + '_get',    path: base + '/' + sp + '_get'    },
        insert: { name: sp + '_insert', path: base + '/' + sp + '_insert' },
        update: { name: sp + '_update', path: base + '/' + sp + '_update' },
        delete: { name: sp + '_delete', path: base + '/' + sp + '_delete' },
      },
      schema,
      blocks,
      tabs: { enabled: false },
    };
  }

  // ─────────────────────────────────────────────
  // LISTENER
  // ─────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'PING') { sendResponse({ success: true }); return true; }
    if (msg.type === 'GET_MODULE_NAME') {
      injectAndRun(`
        ${PAGE_HELPERS}
        const ctx = _getCtx();
        return ctx ? { ok: true, moduleName: ctx.moduleName } : { ok: false };
      `).then(r => {
        if (r?.ok) sendResponse({ success: true, name: toPascal(r.moduleName), raw: r.moduleName });
        else       sendResponse({ success: false, error: 'ScriptCase não encontrado' });
      }).catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
    if (msg.type === 'EXTRACT') {
      extract(msg.config)
        .then(data => sendResponse({ success: true, data }))
        .catch(err  => sendResponse({ success: false, error: err.message }));
      return true;
    }
  });

})();