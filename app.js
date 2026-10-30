(() => {
  const HOLDINGS_KEY = 'orbitfolio.holdings.v1';
  const TRADES_KEY = 'orbitfolio.trades.v1';
  const PLANS_KEY = 'orbitfolio.exitPlans.v1';
  const DEFAULT_HOLDINGS = [{ id: 'holding-00631L', symbol: '00631L', name: '元大台灣50正2', type: 'ETF', shares: 1200, cost: 25.5, purchaseDate: '', notes: '', price: null, createdAt: new Date().toISOString() }];
  const $ = (selector) => document.querySelector(selector);
  const holdingsBody = $('#holdingsBody');
  const holdingDialog = $('#holdingDialog');
  const holdingForm = $('#holdingForm');
  const toast = $('#toast');
  let holdings = readJson(HOLDINGS_KEY, null);
  let trades = readJson(TRADES_KEY, []);
  let plans = readJson(PLANS_KEY, null);
  let deleteTarget = null;
  if (!Array.isArray(holdings)) { holdings = DEFAULT_HOLDINGS; saveHoldings(); }
  if (!Array.isArray(trades)) { trades = []; saveTrades(); }
  if (!plans || !plans['00631L']) { plans = { ...(plans || {}), '00631L': { totalShares: 1200, batches: [400, 400, 400] } }; savePlans(); }

  function readJson(key, fallback) { try { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); } catch { return fallback; } }
  function saveHoldings() { localStorage.setItem(HOLDINGS_KEY, JSON.stringify(holdings)); }
  function saveTrades() { localStorage.setItem(TRADES_KEY, JSON.stringify(trades)); }
  function savePlans() { localStorage.setItem(PLANS_KEY, JSON.stringify(plans)); }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char])); }
  function number(value) { return Number(value).toLocaleString('zh-TW', { maximumFractionDigits: 4 }); }
  function money(value) { return `NT$ ${Number(value).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
  function showToast(message) { toast.textContent = message; toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400); }
  function setToday() { const now = new Date(); $('#todayLabel').textContent = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(now); }
  function tradesFor(symbol) { return trades.filter((trade) => trade.symbol === symbol); }
  function soldShares(symbol) { return tradesFor(symbol).filter((trade) => trade.side === 'sell').reduce((sum, trade) => sum + Number(trade.shares || 0), 0); }
  function getDisplayShares(item) {
    // A transaction ledger is the source of truth once transactions exist. Initial positions remain editable until then.
    const rows = tradesFor(item.symbol);
    if (!rows.length) return Number(item.shares) || 0;
    const buys = rows.filter((trade) => trade.side === 'buy').reduce((sum, trade) => sum + Number(trade.shares || 0), 0);
    const initial = item.initialShares ?? item.shares;
    return Math.max(0, Number(initial) + buys - soldShares(item.symbol));
  }
  function render() {
    const query = $('#searchInput').value.trim().toLocaleLowerCase();
    const filter = $('#typeFilter').value;
    const filtered = holdings.filter((item) => (filter === 'all' || item.type === filter) && `${item.symbol} ${item.name}`.toLocaleLowerCase().includes(query));
    holdingsBody.innerHTML = filtered.map((item) => {
      const shares = getDisplayShares(item);
      const cost = Number(item.cost) || 0;
      const totalCost = shares * cost;
      const hasPrice = Number.isFinite(Number(item.price)) && item.price !== null && item.price !== '';
      const price = hasPrice ? Number(item.price) : null;
      const market = hasPrice ? shares * price : null;
      const pnl = hasPrice ? market - totalCost : null;
      const icon = escapeHtml(item.symbol.slice(0, 4));
      return `<tr>
        <td class="check-cell"><input type="checkbox" aria-label="選取 ${escapeHtml(item.symbol)}" disabled></td>
        <td><div class="asset-cell"><div class="ticker-icon ${item.type === 'ETF' ? 'etf' : 'stock'}">${icon}</div><div class="asset-name"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.symbol)}${item.purchaseDate ? ` · ${escapeHtml(item.purchaseDate)}` : ''}</small></div></div></td>
        <td><span class="type-badge">${escapeHtml(item.type)}</span></td>
        <td class="numeric amount">${number(shares)}</td><td class="numeric amount">${money(cost)}</td><td class="numeric amount">${money(totalCost)}</td>
        <td class="numeric ${hasPrice ? 'amount' : 'na'}">${hasPrice ? money(price) : '尚無行情'}</td><td class="numeric ${hasPrice ? 'amount' : 'na'}">${hasPrice ? money(market) : '—'}</td>
        <td class="numeric ${hasPrice ? (pnl >= 0 ? 'positive' : 'negative') : 'na'}">${hasPrice ? `${pnl >= 0 ? '+' : ''}${money(pnl)}<small class="return"> ${pnl >= 0 ? '+' : ''}${(pnl / totalCost * 100).toFixed(2)}%</small>` : '—'}</td>
        <td><div class="row-actions"><button data-action="edit" data-id="${escapeHtml(item.id)}">編輯</button><button data-action="delete" data-id="${escapeHtml(item.id)}">刪除</button></div></td>
      </tr>`;
    }).join('');
    $('#emptyState').hidden = filtered.length > 0;
    $('#holdingCount').textContent = holdings.length;
    $('#navCount').textContent = holdings.length;
    $('#assetCount').textContent = `${holdings.length} 項資產`;
    $('#tableSummary').textContent = `顯示 ${filtered.length} 項資產`;
    const totalCost = holdings.reduce((sum, item) => sum + getDisplayShares(item) * (Number(item.cost) || 0), 0);
    const priced = holdings.filter((item) => item.price !== null && item.price !== '' && Number.isFinite(Number(item.price)));
    const allPriced = holdings.length > 0 && priced.length === holdings.length;
    const marketValue = priced.reduce((sum, item) => sum + getDisplayShares(item) * Number(item.price), 0);
    const unrealized = marketValue - priced.reduce((sum, item) => sum + getDisplayShares(item) * Number(item.cost), 0);
    $('#totalCost').textContent = money(totalCost);
    $('#marketValue').textContent = allPriced ? money(marketValue) : '尚無行情';
    $('#marketNote').textContent = allPriced ? `${priced.length} 項資產已取得價格` : `${holdings.length - priced.length} 項資產尚無行情`;
    $('#unrealized').textContent = allPriced ? `${unrealized >= 0 ? '+' : ''}${money(unrealized)}` : '尚無行情';
    $('#unrealized').className = `metric${allPriced && unrealized < 0 ? ' negative' : allPriced ? ' positive' : ''}`;
    const etfCost = holdings.filter((item) => item.type === 'ETF').reduce((sum, item) => sum + getDisplayShares(item) * Number(item.cost), 0);
    const stockCost = totalCost - etfCost;
    const etfPct = totalCost ? Math.round(etfCost / totalCost * 100) : 0;
    $('#allocationCount').textContent = holdings.length;
    $('#allocationTypes').textContent = stockCost > 0 ? `ETF ${etfPct}% · 個股 ${100 - etfPct}%` : `ETF ${etfPct}%`;
    renderPlan();
  }
  function renderPlan() {
    const plan = plans['00631L'];
    const position = holdings.find((item) => item.symbol.toUpperCase() === '00631L');
    const totalSold = soldShares('00631L');
    const initial = plan.totalShares || 1200;
    const progress = Math.min(100, totalSold / initial * 100);
    $('#exitProgressText').textContent = `${number(totalSold)} / ${number(initial)} 股已賣出`;
    $('#exitProgressBar').style.width = `${progress}%`;
    $('#batchGrid').innerHTML = plan.batches.map((shares, index) => {
      const prior = plan.batches.slice(0, index).reduce((sum, amount) => sum + amount, 0);
      const executed = Math.max(0, Math.min(shares, totalSold - prior));
      const complete = executed >= shares;
      return `<article class="batch-card"><div class="batch-top"><strong>第 ${index + 1} 批</strong><span class="batch-label">${complete ? '已完成' : '待執行'}</span></div><small><b>${number(shares)}</b> 股${executed ? ` · 已成交 ${number(executed)} 股` : ''}</small></article>`;
    }).join('');
    if (position && position.initialShares == null && Number(position.shares) !== initial) { position.initialShares = Number(position.shares); saveHoldings(); }
  }
  function resetForm() {
    holdingForm.reset(); $('#holdingId').value = ''; $('#dialogTitle').textContent = '新增持股';
    document.querySelectorAll('.field-error').forEach((el) => el.textContent = '');
  }
  function openEditor(item = null) {
    resetForm();
    if (item) {
      $('#dialogTitle').textContent = '編輯持股'; $('#holdingId').value = item.id;
      $('#symbol').value = item.symbol; $('#name').value = item.name; $('#assetType').value = item.type;
      $('#shares').value = getDisplayShares(item); $('#cost').value = item.cost; $('#purchaseDate').value = item.purchaseDate || ''; $('#notes').value = item.notes || '';
      if (tradesFor(item.symbol).length) $('#shares').disabled = true;
    } else $('#shares').disabled = false;
    holdingDialog.showModal();
  }
  function validateForm() {
    let valid = true;
    const symbol = $('#symbol').value.trim(); const name = $('#name').value.trim();
    const shares = Number($('#shares').value); const cost = Number($('#cost').value);
    document.querySelectorAll('.field-error').forEach((el) => el.textContent = '');
    const symbolError = $('[data-error="symbol"]'); const nameError = $('[data-error="name"]');
    if (!symbol) { symbolError.textContent = '請輸入股票代號。'; valid = false; }
    if (!name) { nameError.textContent = '請輸入股票名稱。'; valid = false; }
    if (!Number.isFinite(shares) || shares <= 0) { $('#shares').setCustomValidity('股數必須大於 0'); $('#shares').reportValidity(); valid = false; } else $('#shares').setCustomValidity('');
    if (!Number.isFinite(cost) || cost <= 0) { $('#cost').setCustomValidity('平均成本必須大於 0'); $('#cost').reportValidity(); valid = false; } else $('#cost').setCustomValidity('');
    const existing = holdings.find((item) => item.symbol.toUpperCase() === symbol.toUpperCase() && item.id !== $('#holdingId').value);
    if (existing) { symbolError.textContent = '此代號已存在，請編輯既有持股。'; valid = false; }
    return valid;
  }
  holdingForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!validateForm()) return;
    const id = $('#holdingId').value;
    const previous = holdings.find((item) => item.id === id);
    const item = { id: id || `holding-${Date.now()}`, symbol: $('#symbol').value.trim().toUpperCase(), name: $('#name').value.trim(), type: $('#assetType').value, shares: Number($('#shares').value), cost: Number($('#cost').value), purchaseDate: $('#purchaseDate').value, notes: $('#notes').value.trim(), price: previous?.price ?? null, createdAt: previous?.createdAt || new Date().toISOString() };
    if (previous) {
      if (previous.initialShares != null) item.initialShares = previous.initialShares;
      holdings = holdings.map((row) => row.id === id ? item : row);
    } else holdings.push(item);
    saveHoldings(); holdingDialog.close(); render(); showToast(previous ? '持股資料已更新' : '持股已新增');
  });
  $('#addHolding').addEventListener('click', () => openEditor());
  holdingsBody.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]'); if (!button) return;
    const item = holdings.find((row) => row.id === button.dataset.id); if (!item) return;
    if (button.dataset.action === 'edit') openEditor(item);
    if (button.dataset.action === 'delete') { deleteTarget = item.id; $('#confirmDialog').showModal(); }
  });
  $('#confirmDelete').addEventListener('click', () => {
    const item = holdings.find((row) => row.id === deleteTarget);
    if (item && tradesFor(item.symbol).length) { $('#confirmDialog').close(); showMessage('無法刪除持股', '這筆持股已有交易紀錄。為保留交易歷史，請勿刪除；如需結清，請新增賣出交易。'); deleteTarget = null; return; }
    holdings = holdings.filter((row) => row.id !== deleteTarget); saveHoldings(); $('#confirmDialog').close(); deleteTarget = null; render(); showToast('持股已刪除');
  });
  function showMessage(title, message) { $('#messageTitle').textContent = title; $('#messageText').textContent = message; $('#messageDialog').showModal(); }
  $('#searchInput').addEventListener('input', render);
  $('#typeFilter').addEventListener('change', render);
  document.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#searchInput').focus(); } });
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); }));
  $('#exitLearnMore').addEventListener('click', () => $('#exitInfoDialog').showModal());

  function csvCell(value) { const text = String(value ?? ''); return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }
  $('#exportCsv').addEventListener('click', () => {
    const headers = ['股票代號', '股票名稱', '資產類型', '持有股數', '平均成本', '買進日期', '備註'];
    const rows = holdings.map((item) => [item.symbol, item.name, item.type, getDisplayShares(item), item.cost, item.purchaseDate, item.notes]);
    const csv = '\ufeff' + [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `持股清單-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url); showToast('CSV 已匯出');
  });
  function parseCsv(text) {
    const rows = []; let row = []; let cell = ''; let quoted = false;
    for (let i = 0; i < text.length; i++) { const char = text[i];
      if (quoted) { if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (char === '"') quoted = false; else cell += char; }
      else if (char === '"') quoted = true; else if (char === ',') { row.push(cell); cell = ''; } else if (char === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; } else cell += char;
    }
    if (cell.length || row.length) { row.push(cell.replace(/\r$/, '')); rows.push(row); }
    return rows.filter((line) => line.some((value) => value.trim()));
  }
  $('#importCsv').addEventListener('change', async (event) => {
    const file = event.target.files[0]; if (!file) return;
    try {
      const text = await file.text(); const rows = parseCsv(text.replace(/^\ufeff/, ''));
      const headings = rows.shift().map((value) => value.trim());
      const aliases = { '股票代號':'symbol', '代號':'symbol', '股票名稱':'name', '名稱':'name', '資產類型':'type', '類型':'type', '持有股數':'shares', '股數':'shares', '平均成本':'cost', '成本':'cost', '買進日期':'purchaseDate', '備註':'notes' };
      const positions = {}; headings.forEach((heading, index) => { if (aliases[heading]) positions[aliases[heading]] = index; });
      if (positions.symbol == null || positions.name == null || positions.shares == null || positions.cost == null) throw new Error('CSV 至少需要股票代號、股票名稱、持有股數及平均成本欄位。');
      const imported = rows.map((values, index) => {
        const item = { symbol: (values[positions.symbol] || '').trim().toUpperCase(), name: (values[positions.name] || '').trim(), type: (values[positions.type] || 'ETF').trim(), shares: Number(values[positions.shares]), cost: Number(values[positions.cost]), purchaseDate: values[positions.purchaseDate] || '', notes: values[positions.notes] || '' };
        if (!item.symbol || !item.name || !Number.isFinite(item.shares) || item.shares <= 0 || !Number.isFinite(item.cost) || item.cost <= 0) throw new Error(`第 ${index + 2} 列資料不完整或股數／成本無效。`);
        if (!['ETF', '個股'].includes(item.type)) item.type = 'ETF';
        return item;
      });
      const seen = new Set();
      imported.forEach((item) => { if (seen.has(item.symbol)) throw new Error(`CSV 中代號 ${item.symbol} 重複。`); seen.add(item.symbol); });
      let added = 0; let updated = 0;
      imported.forEach((incoming) => {
        const existing = holdings.find((item) => item.symbol.toUpperCase() === incoming.symbol);
        if (existing) { Object.assign(existing, incoming); updated++; }
        else { holdings.push({ ...incoming, id: `holding-${Date.now()}-${added}`, price: null, createdAt: new Date().toISOString() }); added++; }
      });
      saveHoldings(); render(); showToast(`匯入完成：新增 ${added} 筆，更新 ${updated} 筆`);
    } catch (error) { showMessage('CSV 匯入失敗', error.message || '請檢查檔案格式。'); }
    event.target.value = '';
  });
  setToday(); render();
})();
