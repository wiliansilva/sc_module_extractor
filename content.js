// content.js - ScriptCase Module Extractor v4.0  (Grid + Form)

(function() {
    'use strict';

    if (window.__scModuleExtractorInjected) return;
    window.__scModuleExtractorInjected = true;

    // ─────────────────────────────────────────────
    // INJEÇÃO DE SCRIPT NA PÁGINA
    // ─────────────────────────────────────────────

    function injectAndRun(code) {
    return new Promise((resolve, reject) => {
        const requestId = '__sc_' + Date.now() + '_' + Math.random().toString(36).slice(2);
        chrome.runtime.sendMessage({ type: 'EXEC_IN_PAGE', code, requestId }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (res?.success) resolve(res.result);
        else reject(new Error(res?.error || 'EXEC_IN_PAGE falhou'));
        });
    });
    }

    // ─────────────────────────────────────────────
    // PAGE HELPERS (rodam dentro da página via injectAndRun)
    // ─────────────────────────────────────────────

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
        if (el.type === 'checkbox') return el.checked ? 'S' : 'N';
        if (el.type === 'radio') { const c = doc.querySelector('[name="' + name + '"]:checked'); return c ? c.value : ''; }
        if (el.tagName === 'SELECT') return el.options[el.selectedIndex]?.value || '';
        return el.value || '';
    }
    function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }
    async function _callMenu(leftWin, rightIframe, args, waitMs = 1800) {
        const snap0 = rightIframe.contentDocument
        .querySelector('form[name="form_edit"]')?.action || Math.random();
        leftWin.nm_update_menu(...args);
        const start = Date.now();
        while (Date.now() - start < waitMs + 2000) {
        await _delay(80);
        const snap = rightIframe.contentDocument
            .querySelector('form[name="form_edit"]')?.action || '';
        if (snap !== snap0) break;
        if (Date.now() - start > waitMs) break;
        }
        await _delay(200);
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
    const h = (html || '').toUpperCase();
    const s = (sql || '').toLowerCase();
    const d = (tipoDado || '').toUpperCase();
    const dateTypes = new Set(['DATA', 'HORA', 'DATAHORA']);
    const nonDateHtml = new Set(['TEXT', 'TEXTAREA', 'PASSWORD', 'CHECKBOX', 'CHKBOX', 'SELECT', 'RADIO', 'NUMEROEDT', 'DECIMALEDT', 'LOOKUP']);
    if (dateTypes.has(d) && !nonDateHtml.has(h)) {
        if (d === 'DATA') return 'date';
        if (d === 'HORA') return 'time';
        if (d === 'DATAHORA') return 'datetime';
    }
    if (h === 'CHECKBOX' || h === 'CHKBOX') return 'boolean';
    if (s === 'integer' || s === 'bigint' || s === 'int' || s === 'smallint') return 'integer';
    if (s === 'decimal' || s === 'float' || s === 'double' || s === 'numeric') return 'float';
    if (h === 'NUMEROEDT' || h === 'NUMERO') return 'integer';
    if (h === 'DECIMALEDT' || h === 'DECIMAL') return 'float';
    if (h === 'DATE') return 'date';
    if (h === 'DATETIME') return 'datetime';
    if (h === 'TIME') return 'time';
    if (d === 'NUMEROEDT' || d === 'NUMERO') return 'integer';
    if (d === 'DECIMAL' || d === 'VALOR') return 'float';
    if (d === 'DATA') return 'date';
    if (d === 'HORA') return 'time';
    if (d === 'DATAHORA') return 'datetime';
    return 'string';
    }

    /** Converte TipoDado/HtmlTipo do ScriptCase para type do JSON Grid */
    function mapGridColumnType(tipoDado, tipoSql) {
    const d = (tipoDado || '').toUpperCase();
    const s = (tipoSql || '').toLowerCase();
    if (d === 'DATA') return 'date';
    if (d === 'HORA') return 'time';
    if (d === 'DATAHORA') return 'datetime';
    if (d === 'NUMEROEDT' || d === 'NUMERO') return 'integer';
    if (d === 'DECIMAL' || d === 'VALOR' || d === 'PERCENT') return 'float';
    if (s === 'integer' || s === 'bigint' || s === 'int' || s === 'smallint') return 'integer';
    if (s === 'decimal' || s === 'float' || s === 'double' || s === 'numeric') return 'float';
    return 'text';
    }

    function mapInput(html, tipoDado) {
    const d = (tipoDado || '').toUpperCase();
    const semanticMap = {
        DATA: 'date', HORA: 'time', DATAHORA: 'datetime',
        NUMEROEDT: 'text', DECIMAL: 'text', VALOR: 'text',
        MULTITEXTO: 'textarea', CIC: 'text', CNPJ: 'text',
        CICCNPJ: 'text', TPCICCNPJ: 'text', CEP: 'text',
        EMAIL: 'text', URL: 'text', CORHTML: 'text',
        EDITOR_HTML: 'textarea', FORM_IMAGE_HTML: 'file',
        FORM_LABEL: 'label',
    };
    if (d && semanticMap[d]) return semanticMap[d];
    const map = {
        TEXT: 'text', TEXTAREA: 'textarea', PASSWORD: 'password',
        DATE: 'date', DATETIME: 'datetime', TIME: 'time',
        SELECT: 'select', RADIO: 'radio', CHECKBOX: 'checkbox', CHKBOX: 'checkbox',
        NUMEROEDT: 'text', NUMERO: 'text', DECIMALEDT: 'text', DECIMAL: 'text',
        LOOKUP: 'select2', CPFCNPJ: 'text', CEP: 'text',
        FILE: 'file', IMAGE: 'file', HIDDEN: 'hidden',
        LABEL: 'label', HYPERLINK: 'link', EMAIL: 'text', URL: 'text',
    };
    return map[(html || '').toUpperCase()] || 'text';
    }

    function sendProgress(v) {
    try { chrome.runtime.sendMessage({ type: 'progress', value: v }); } catch (e) {}
    }

    // ═════════════════════════════════════════════════════════════════
    //  EXTRAÇÃO DE GRID
    // ═════════════════════════════════════════════════════════════════

    async function extractGrid(config) {

    // ── 1. Verifica ScriptCase ───────────────────────────────────────
    const check = await injectAndRun(`
    ${PAGE_HELPERS}
        const ctx = _getCtx();
        if (!ctx) return { ok: false };
        return { ok: true, moduleName: ctx.moduleName };
    `);
    if (!check?.ok) throw new Error('ScriptCase não encontrado. Abra um módulo Grid no ScriptCase.');

    const moduleName     = check.moduleName;
    const moduleNamePascal = config.moduleName || toPascal(moduleName);
    const prefix         = config.prefix || toSnake(moduleNamePascal);
    sendProgress(5);

    // ── 2. Coleta lista de campos do tree (left panel) ───────────────
    const fieldItems = await injectAndRun(`
    ${PAGE_HELPERS}
        const ctx = _getCtx();
        if (!ctx) return [];
        const leftDoc = ctx.leftIframe.contentDocument;

        const fieldsTit = leftDoc.getElementById('fields_tit');
        if (fieldsTit && fieldsTit.getAttribute('aria-expanded') !== 'true') {
        const toggle = fieldsTit.querySelector('i.jstree-ocl');
        toggle && toggle.click();
        await _delay(1200);
        }

        return Array.from(leftDoc.querySelectorAll('li[id^="fields_tit_itens_"]')).map(li => {
        const anchor = li.querySelector('a.jstree-anchor');
        const href   = anchor?.getAttribute('href') || '';
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
            args,
        };
        }).filter(f => f.name && !f.name.startsWith('['));
    `);

    console.log('[GRID] Fields:', (fieldItems || []).map(f => `${f.id}:${f.name}`));
    sendProgress(12);

    // ── 3. FieldsEditionDef — colunas visíveis + labels + tipos + width ─
    const editionResult = await injectAndRun(`
    ${PAGE_HELPERS}
        const ctx = _getCtx();
        if (!ctx) return null;
        await _callMenu(ctx.leftIframe.contentWindow, ctx.rightIframe, ['app', 'FieldsEditionDef'], 2500);
        const rd = ctx.rightIframe.contentDocument;

        const allInputs = Array.from(rd.querySelectorAll(
        'input[name^="arr_fields_edition_def"], select[name^="arr_fields_edition_def"]'
        ));
        const raw = {};
        allInputs.forEach(el => {
        const m = el.name.match(/arr_fields_edition_def\\[(\\d+)\\]\\[(\\d+)\\]/);
        if (!m) return;
        const [, fId, idx] = m;
        if (!raw[fId]) raw[fId] = {};
        raw[fId][idx] = el.type === 'checkbox'
            ? (el.checked ? 'S' : 'N')
            : (el.tagName === 'SELECT' ? (el.options[el.selectedIndex]?.value || '') : el.value);
        });

        // Detecta páginas / blocos para saber a ordem das colunas na tela
        // Page "Fields not shown" marca campos ocultos
        const rows   = Array.from(rd.querySelectorAll('tr'));
        let visible  = true;            // dentro de "Fields not shown" = false
        const order  = [];              // ordem de exibição dos campos visíveis
        rows.forEach(tr => {
        const text = tr.textContent.trim();
        if (text.startsWith('Page:')) {
            visible = !text.includes('Fields not shown');
            return;
        }
        // Linha de campo: tem input hidden [1] com nome do campo
        const nameInput = tr.querySelector('input[name$="][1]"]');
        if (!nameInput) return;
        const mId = nameInput.name.match(/\\[(\\d+)\\]\\[1\\]/);
        if (!mId) return;
        if (visible) order.push(mId[1]);
        });

        // Monta resultado indexado por fId
        const fields = {};
        Object.entries(raw).forEach(([fId, d]) => {
        fields[fId] = {
            name:       d[1]  || '',
            label:      d[2]  || d[1] || '',
            tipoDado:   d[3]  || '',
            visible:    d[17] === 'S',
            visiblePDF: d[18] === 'S',
            titleAlign: d[19] || '',   // 1=Left 2=Right 3=Center 4=Justified
            textAlign:  d[20] || '',
            width:      parseInt(d[21] || '0') || 0,
        };
        });

        return { fields, order };
    `);

    sendProgress(30);

    // ── 4. Detalhes por campo (tipo SQL, largura da coluna) ──────────
    // Navega em cada campo para pegar Tipo_Sql e Char_Col_Largura
    const fieldDetails = {};
    const toCapture    = Array.isArray(fieldItems) ? fieldItems.slice(0, 60) : [];

    for (let i = 0; i < toCapture.length; i++) {
        const f = toCapture[i];
        const detail = await injectAndRun(`
    ${PAGE_HELPERS}
        const ctx = _getCtx();
        if (!ctx) return null;
        const args = ${JSON.stringify(f.args)};
        if (!args) return null;
        await _callMenu(ctx.leftIframe.contentWindow, ctx.rightIframe, args, 2000);
        const rd = ctx.rightIframe.contentDocument;

        const tipoDado = _domGet(rd, 'Tipo_Dado_P') || _domGet(rd, 'hid_sel_type_aux') || '';
        const tipoSql  = _domGet(rd, 'Tipo_Sql') || '';
        const label    = (_domGet(rd, 'Label') || ${JSON.stringify(f.name)}).replace(/[{}]/g, '');
        const colWidth = parseInt(_domGet(rd, 'Char_Col_Largura') || '0') || 0;

        // Lookup options (SELECT / RADIO / LOOKUP manual)
        const OPTION_TYPES = new Set(['SELECT','RADIO','CHECKBOX','CHKBOX','LOOKUP']);
        let options   = null;
        let lookupSql = null;

        if (OPTION_TYPES.has(tipoDado.toUpperCase())) {
            const method = _domGet(rd, 'Lookup_Cons');
            if (method === 'M') {
            const listSel = rd.querySelector('[name="def_cons_js_list"]');
            if (listSel && listSel.options.length > 0) {
                options = Array.from(listSel.options).map(opt => {
                const parts = opt.value.split('?#?');
                return { label: (parts[0] || '').replace(/[{}]/g,'').trim(), value: (parts[1] || '').trim() };
                }).filter(o => o.value !== '');
            }
            } else if (method === 'A') {
            const sqlEl = rd.querySelector('[name="def_cons_select"]');
            if (sqlEl?.value?.trim()) lookupSql = sqlEl.value.trim();
            }
        }

        return { tipoDado, tipoSql, label, colWidth, options, lookupSql };
        `);

        if (detail) {
        fieldDetails[f.name] = detail;
        console.log('[GRID] field', f.name, '| tipo:', detail.tipoDado, '| sql:', detail.tipoSql, '| colW:', detail.colWidth);
        }
        sendProgress(30 + Math.round((i + 1) / toCapture.length * 30));
    }

    // ── 5. SQL Settings ──────────────────────────────────────────────
    const sqlResult = await injectAndRun(`
    ${PAGE_HELPERS}
        const ctx = _getCtx();
        if (!ctx) return null;
        await _callMenu(ctx.leftIframe.contentWindow, ctx.rightIframe, ['app', 'sql'], 2000);
        const rd = ctx.rightIframe.contentDocument;
        return {
        sql:        _domGet(rd, 'ComandoSelect') || '',
        connection: _domGet(rd, 'NomeConexao')   || '',
        formParams: _domGet(rd, 'FormParams')    || '',
        };
    `);
    console.log('[GRID] SQL connection:', sqlResult?.connection);
    sendProgress(65);

    // ── 6. Settings (cons) — paginação, quickSearch, selectable ─────
    const consResult = await injectAndRun(`
    ${PAGE_HELPERS}
        const ctx = _getCtx();
        if (!ctx) return null;
        await _callMenu(ctx.leftIframe.contentWindow, ctx.rightIframe, ['app', 'cons'], 2000);
        const rd = ctx.rightIframe.contentDocument;

        // GridLinhasPagina: 1=server-side, 2=client-side, 3=lazy-load
        const paginaMode   = _domGet(rd, 'GridLinhasPagina')     || '1';
        const paginaNumero = _domGet(rd, 'GridLinhasPaginaNumero') || '20';
        const modulesCons  = _domGet(rd, 'modules_cons')          || '';    // ex: "filter;cons"

        // rules_group contém a config serializada do Group By (PHP serialize)
        const rulesGroupRaw = rd.querySelector('input[name="rules_group"]')?.value || '';

        return { paginaMode, paginaNumero, modulesCons, rulesGroupRaw };
    `);
    sendProgress(72);

    // ── 7. Toolbar — detecta QuickSearch e botões ativos ────────────
    const toolbarResult = await injectAndRun(`
    ${PAGE_HELPERS}
        const ctx = _getCtx();
        if (!ctx) return null;
        await _callMenu(ctx.leftIframe.contentWindow, ctx.rightIframe, ['app', 'toolbar'], 2000);
        const rd = ctx.rightIframe.contentDocument;

        // toolbars_top_block contém os botões na ordem da toolbar superior
        const topBlock = rd.querySelector('select[name="toolbars_top_block"]');
        const topItems = topBlock ? Array.from(topBlock.options).map(o => o.value) : [];

        const hasQuickSearch = topItems.some(v => v.includes('qks') || v.includes('QuickSearch'));

        // Detecta se há "select all" / checkbox de seleção na toolbar
        const hasSelectAll = topItems.some(v => v.includes('selec') || v.includes('select_all'));

        return { topItems, hasQuickSearch, hasSelectAll };
    `);
    sendProgress(80);

    // ── 8. Application Links — rowActions ───────────────────────────
    // Os links de aplicação do ScriptCase correspondem aos rowActions do Grid JSON
    const appLinksResult = await injectAndRun(`
    ${PAGE_HELPERS}
        const ctx = _getCtx();
        if (!ctx) return [];
        // nm_app_link2 carrega a lista de links existentes
        try { ctx.leftIframe.contentWindow.nm_app_link2('new', '', ''); } catch(e) {}
        await _delay(2200);
        const rd = ctx.rightIframe.contentDocument;

        // Os links são renderizados como linhas em uma tabela
        // Cada linha tem células: icon | label | target_module | params
        const rows = Array.from(rd.querySelectorAll('tr[id^="row_link_"], tr[class*="link_row"], tr[data-link]'));
        if (rows.length === 0) {
        // Tenta seletor alternativo: tabela dentro de #form_links ou similar
        const linkRows = Array.from(rd.querySelectorAll('table tr')).filter(tr => {
            const tds = tr.querySelectorAll('td');
            return tds.length >= 3 && tr.querySelector('img, [class*="fa-"], [data-icon]');
        });
        return linkRows.map(tr => {
            const tds = Array.from(tr.querySelectorAll('td'));
            const iconEl = tr.querySelector('img, i[class*="fa"]');
            const icon   = iconEl?.getAttribute('src')?.split('/').pop()?.replace(/\\.\\w+$/, '') 
                        || iconEl?.className?.match(/fa-([\\w-]+)/)?.[1] || '';
            const label  = tds[1]?.textContent?.trim() || '';
            const target = tds[2]?.textContent?.trim() || '';
            return { icon, label, target };
        }).filter(l => l.label || l.target);
        }
        return rows.map(tr => {
        const tds = Array.from(tr.querySelectorAll('td'));
        const iconEl = tr.querySelector('img, i[class*="fa"]');
        const icon   = iconEl?.getAttribute('src')?.split('/').pop()?.replace(/\\.\\w+$/, '')
                    || iconEl?.className?.match(/fa-([\\w-]+)/)?.[1] || '';
        const label  = tds[1]?.textContent?.trim() || '';
        const target = tds[2]?.textContent?.trim() || '';
        return { icon, label, target };
        }).filter(l => l.label || l.target);
    `);

    console.log('[GRID] AppLinks:', appLinksResult);
    sendProgress(88);

    // ── 9. Group By — grouplabels ────────────────────────────────────
    const groupByResult = await injectAndRun(`
    ${PAGE_HELPERS}
        const ctx = _getCtx();
        if (!ctx) return null;
        await _callMenu(ctx.leftIframe.contentWindow, ctx.rightIframe, ['app', 'grouplabels'], 2500);
        const rd = ctx.rightIframe.contentDocument;

        // Tenta ler os grupos configurados
        // A página tem select "sort_advanced_fields_block" ou similar com os campos de grupo
        const groupFieldsSel = rd.querySelector('select[name="sort_advanced_fields_block"]')
                            || rd.querySelector('select[name="group_fields_block"]')
                            || rd.querySelector('select[name="grouplabels_block"]');
        const groupFields = groupFieldsSel
        ? Array.from(groupFieldsSel.options)
            .filter(o => o.value && !o.value.startsWith('__blc__'))
            .map(o => ({
                fieldId: o.value.split('_#fld#_')[0] || o.value,
                name:    o.text.trim(),
            }))
        : [];

        // Verifica se Group By está habilitado (regra sc_free_group_by)
        // Este flag fica no hidden rules_group da página cons
        // Aqui na grouplabels, tenta ler o título padrão
        const titulo = _domGet(rd, 'txt_titulo') || '';

        return { groupFields, titulo };
    `);

    console.log('[GRID] GroupBy:', groupByResult);
    sendProgress(94);

    // ── 10. Monta o JSON final ───────────────────────────────────────

    const base   = config.servicesPath || ('modules/' + moduleNamePascal);
    const sp     = toSnake(moduleNamePascal);
    const params = config.params
        ? config.params.split(',').map(p => p.trim()).filter(Boolean)
        : (sqlResult?.formParams || '').split(',').map(p => p.trim()).filter(Boolean);

    // Paginação
    const paginaMode = consResult?.paginaMode || '1';
    // 1=server, 2=client, 3=lazy
    const paginationMap = { '1': 'server', '2': 'client', '3': 'lazy' };
    const pagination    = paginationMap[paginaMode] || 'server';

    // Campos visíveis na ordem da FieldsEditionDef
    const edition = editionResult || { fields: {}, order: [] };
    const visibleFieldIds = edition.order.filter(fId => edition.fields[fId]?.visible);

    // Monta columns — usa detalhe por campo para tipo
    const columns = visibleFieldIds.map(fId => {
        const ed   = edition.fields[fId] || {};
        const name = ed.name || fId;
        const det  = fieldDetails[name] || {};

        const type = mapGridColumnType(det.tipoDado || ed.tipoDado, det.tipoSql);

        // Width: prioridade → Char_Col_Largura do detalhe → width do FieldsEditionDef
        const width = (det.colWidth && det.colWidth > 0) ? det.colWidth
                    : (ed.width && ed.width > 0)         ? ed.width
                    : undefined;

        const col = {
        dataIndex: name,
        title:     (det.label || ed.label || name).replace(/[{}]/g, ''),
        type,
        };
        if (width) col.width = width;
        if (det.options?.length) col.options = det.options;
        if (det.lookupSql)       col.lookupSql = det.lookupSql;
        return col;
    });

    // rowKey — primeiro campo com isPK ou primeiro campo numérico (ID-like)
    let rowKey = config.rowKey || '';
    if (!rowKey) {
        // Heurística: campo chamado "Id", "*Codigo*", "*Code*", primeiro inteiro
        const intFields = Object.values(edition.fields)
        .filter(f => mapGridColumnType(fieldDetails[f.name]?.tipoDado, fieldDetails[f.name]?.tipoSql) === 'integer');
        const pkCandidate = intFields.find(f => /^id$/i.test(f.name))
                        || intFields.find(f => /id$|codigo$|code$|key$/i.test(f.name))
                        || intFields[0];
        rowKey = pkCandidate?.name || (columns[0]?.dataIndex || 'Id');
    }

    // rowActions
    const rowActions = (Array.isArray(appLinksResult) ? appLinksResult : []).map(lnk => {
        // Tenta mapear label/icon para o padrão do JSON alvo
        const label = lnk.label || '';
        const iconGuess = lnk.icon
        ? (lnk.icon.startsWith('fa') ? lnk.icon : `fa${lnk.icon.replace(/[^a-zA-Z]/g,'').replace(/^./, c => c.toUpperCase())}`)
        : (label.toLowerCase().includes('edit')    ? 'faEdit'
        : label.toLowerCase().includes('detalhes') || label.toLowerCase().includes('ver') ? 'faSearch'
        : label.toLowerCase().includes('excluir')  || label.toLowerCase().includes('delet') ? 'faTrash'
        : 'faLink');
        return {
        icon:    iconGuess,
        tooltip: label,
        opens:   lnk.target || '',
        };
    });

    // quickSearch — detectado pela presença do botão na toolbar
    const quickSearchEnabled = toolbarResult?.hasQuickSearch ?? false;

    // filter — se "filter" está em modules_cons
    const filterEnabled = (consResult?.modulesCons || '').includes('filter');

    // selectable — se toolbar tem select-all ou config indica
    const selectable = toolbarResult?.hasSelectAll ?? false;

    // groupBy — monta array a partir dos campos de grupo detectados
    const groupBy = (groupByResult?.groupFields || []).map(g => ({
        key: g.name || g.fieldId,
    }));

    // schema — todos os campos (para uso em forms filhos, relatórios etc.)
    const schema = (Array.isArray(fieldItems) ? fieldItems : []).map(f => {
        const det  = fieldDetails[f.name] || {};
        const ed   = edition.fields[
        Object.keys(edition.fields).find(k => edition.fields[k].name === f.name)
        ] || {};
        const type = mapGridColumnType(det.tipoDado || ed.tipoDado, det.tipoSql);
        return {
        field:   f.name,
        type,
        visible: ed.visible ?? true,
        };
    });

    sendProgress(100);

    return {
        kind: 'grid',
        module: {
        name:       moduleNamePascal,
        title:      config.title || moduleNamePascal,
        prefix,
        connection: sqlResult?.connection || '',
        params,
        assets: config.assets
            ? config.assets.split(',').map(a => a.trim()).filter(Boolean)
            : [],
        },
        service: {
        name:       sp + '_list',
        path:       base + '/' + sp + '_list',
        resultType: config.resultType || (moduleNamePascal + 'Result'),
        },
        pagination,
        rowKey,
        rowActions: rowActions.length ? rowActions : undefined,
        columns,
        filter: {
        enabled: filterEnabled,
        },
        quickSearch: {
        enabled: quickSearchEnabled,
        },
        groupBy:   groupBy.length ? groupBy : undefined,
        selectable,
        schema,
    };
    }

    // ═════════════════════════════════════════════════════════════════
    //  EXTRAÇÃO DE FORM (código original — preservado integralmente)
    // ═════════════════════════════════════════════════════════════════

    async function extract(config) {

        // ── 1. Verifica se ScriptCase está aberto ─────────────────────────────────
  const check = await injectAndRun(`
${PAGE_HELPERS}
    const ctx = _getCtx();
    if (!ctx) return { ok: false };
    return { ok: true, moduleName: ctx.moduleName };
  `);
  if (!check?.ok) throw new Error('ScriptCase não encontrado. Abra um módulo no ScriptCase.');

        const moduleName = check.moduleName;
  const moduleNamePascal = config.moduleName || toPascal(moduleName);
        const prefix = config.prefix || toSnake(moduleNamePascal);
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
  const OPTION_INPUT_TYPES = new Set(['SELECT', 'RADIO', 'CHECKBOX', 'CHKBOX', 'SELECT2', 'LOOKUP']);

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

      // Nomes reais no DOM: Html_Tipo, Tipo_Sql, Tipo_Dado_P, Val_Inicial, form_val_tipo
      const htmlTipo   = _domGet(rd, 'Html_Tipo')    || _domGet(rd, 'hid_sel_type_aux') || 'TEXT';
      const tipoSql    = _domGet(rd, 'Tipo_Sql')     || 'varchar';
      const tipoDado   = _domGet(rd, 'Tipo_Dado_P')  || _domGet(rd, 'Tipo_Dado_S') || '';
      const label      = (_domGet(rd, 'Label') || ${JSON.stringify(f.name)}).replace(/[{}]/g, '');
      const valInicial = _domGet(rd, 'Val_Inicial')  || '';
      const required   = _domGet(rd, 'form_val_tipo') === 'S';

      // ── Captura options para SELECT / SELECT2 / RADIO / CHECKBOX ──────
      const OPTION_TYPES = new Set(['SELECT','RADIO','CHECKBOX','CHKBOX','SELECT2','LOOKUP']);
      let options   = null;
      let lookupSql = null;

      if (OPTION_TYPES.has(htmlTipo.toUpperCase()) || OPTION_TYPES.has(tipoDado.toUpperCase())) {
        const lookupMethod = _domGet(rd, 'Lookup_Edit'); // 'M' = Manual, 'A' = Automático

        if (lookupMethod === 'M') {
          // Lookup manual: lê def_edit_js_list
          // Formato do value: "label?#?value?#?image?#?isDefault(S/N)?#?groupname?#?"
          const listSel = rd.querySelector('[name="def_edit_js_list"]');
          if (listSel && listSel.options.length > 0) {
            options = Array.from(listSel.options).map(opt => {
              const parts = opt.value.split('?#?');
              return {
                label:     (parts[0] || '').replace(/[{}]/g, '').trim(),
                value:     (parts[1] || '').trim(),
                isDefault: (parts[3] || 'N') === 'S',
              };
            }).filter(o => o.value !== '');
          }

        } else if (lookupMethod === 'A') {
          // Lookup automático: captura a query SQL
          const sqlEl = rd.querySelector('[name="def_edit_select"]');
          if (sqlEl && sqlEl.value.trim()) {
            lookupSql = sqlEl.value.trim();
          }
        }
      }

      return { htmlTipo, tipoSql, tipoDado, label, valInicial, required, options, lookupSql };
    `);

    if (fieldData) {
                details[f.name] = {
                    name: f.name,
                    ...fieldData
                };
                console.log(
                    '[EXTRACTOR]', f.name,
                    '| label:', fieldData.label,
                    '| tipo:', fieldData.htmlTipo,
                    '| options:', fieldData.options ? fieldData.options.length + 'x' : '-',
                    '| sql:', fieldData.lookupSql ? 'SQL' : '-'
                );
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
            const {
                blockSeq,
                fieldMap
            } = editionResult;

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
                const cleanSeqTitle = seq.title.replace(/<[^>]+>/g, '').replace(/\s*\*\s*$/, '').trim();
                const key = cleanSeqTitle;

                const candidates = blockdefByTitle[key] || [];
                const useIdx = usageCount[key] || 0;
                const blkDef = candidates[useIdx] || null;
                usageCount[key] = useIdx + 1;

                return {
                    name: blkDef?.name || cleanSeqTitle || seq.title,
                    title: blkDef?.cleanTitle || seq.title,
                    rawTitle: blkDef?.title || seq.title,
                    columns: blkDef?.columns || 2,
                    largura: blkDef?.largura || '100%',
                    fields: seq.fields.map(f => ({
                        rawId: f,
                        name: f
                    })),
                };
            });

        } else {
            // Fallback
            blockData = [{
                name: 'Dados',
                title: 'Dados',
                columns: 2,
                fields: fieldItems.map(f => ({
                    rawId: f.id,
                    name: f.name
                })),
            }];
        }

        // ── 7. Schema — usa fieldMap para enriquecer tipos ────────────────────────
        // (mantém a lógica atual de details[] + adiciona isRequired do fieldMap)
        const fieldMap = editionResult?.fieldMap || {};

        const schema = fieldItems.map(f => {
            const d = details[f.name] || {};
            const ed = fieldMap[f.name] || {};
            const type = mapType(d.htmlTipo, d.tipoSql, d.tipoDado);
            let def = d.valInicial || '';
            if (type === 'boolean') def = (def === 'S' || def === 'true' || def === '1');
            else if (type === 'integer') def = def ? (parseInt(def) || 0) : 0;
            else if (type === 'float') def = def ? (parseFloat(def) || 0.0) : 0.0;

            const entry = {
                field: f.name,
                type,
                required: ed.isRequired || d.required || false,
                default: type === 'string' ? (def || '') : def,
            };
            if (d.options && d.options.length > 0) entry.options = d.options;
            if (d.lookupSql) entry.lookupSql = d.lookupSql;
            return entry;
        });

        // ── 8. Monta blocks com label e input do fieldMap + details ──────────────
        const blocks = blockData.map(blk => ({
            name: blk.name,
            title: blk.title,
            columns: blk.columns,
            fields: blk.fields.map(bf => {
                const d = details[bf.name] || {};
                const ed = fieldMap[bf.name] || {};
                const input = mapInput(d.htmlTipo || 'TEXT', d.tipoDado);
                const label = (ed.label || d.label || bf.name).replace(/[{}]/g, '');
                const fObj = {
                    name: bf.name,
                    label,
                    input
                };
                if (ed.isRequired || d.required) fObj.required = true;
                if (ed.isReadOnly) fObj.readOnly = true;
                if (ed.isPK) fObj.pk = true;
                if (d.options && d.options.length > 0) fObj.options = d.options;
                if (d.lookupSql) fObj.lookupSql = d.lookupSql;
                return fObj;
            }),
        }));

        const base = config.servicesPath || ('modules/' + moduleNamePascal);
        const sp = toSnake(moduleNamePascal);
        const params = config.params ?
            config.params.split(',').map(p => p.trim()).filter(Boolean) :
            (sqlResult?.formParams || '').split(',').map(p => p.trim()).filter(Boolean);

        sendProgress(100);

        return {
            kind: config.kind || 'form',
            module: {
                name: moduleNamePascal,
                title: config.title || moduleNamePascal,
                subtitle: config.subtitle || '',
                prefix,
                connection: sqlResult?.connection || '',
                table: sqlResult?.table || '',
                params,
                parentModule: config.parentModule || '',
                assets: config.assets ? config.assets.split(',').map(a => a.trim()).filter(Boolean) : [],
            },
            services: {
                get: {
                    name: sp + '_get',
                    path: base + '/' + sp + '_get'
                },
                insert: {
                    name: sp + '_insert',
                    path: base + '/' + sp + '_insert'
                },
                update: {
                    name: sp + '_update',
                    path: base + '/' + sp + '_update'
                },
                delete: {
                    name: sp + '_delete',
                    path: base + '/' + sp + '_delete'
                },
            },
            schema,
            blocks,
            tabs: {
                enabled: false
            },
        };
    }

    // ─────────────────────────────────────────────
    // LISTENER
    // ─────────────────────────────────────────────

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.type === 'PING') {
            sendResponse({
                success: true
            });
            return true;
        }
        if (msg.type === 'GET_MODULE_NAME') {
            injectAndRun(`
        ${PAGE_HELPERS}
        const ctx = _getCtx();
        return ctx ? { ok: true, moduleName: ctx.moduleName } : { ok: false };
      `).then(r => {
                if (r?.ok) sendResponse({
                    success: true,
                    name: toPascal(r.moduleName),
                    raw: r.moduleName
                });
                else sendResponse({
                    success: false,
                    error: 'ScriptCase não encontrado'
                });
            }).catch(e => sendResponse({
                success: false,
                error: e.message
            }));
            return true;
        }
        if (msg.type === 'EXTRACT') {
            const extractor = msg.config?.kind === 'grid' ? extractGrid : extract;
            extractor(msg.config || {})
                .then(data => sendResponse({
                    success: true,
                    data
                }))
                .catch(err => sendResponse({
                    success: false,
                    error: err.message
                }));
            return true;
        }
    });
})();
