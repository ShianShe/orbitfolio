(() => {
  const HOLDINGS_KEY = 'orbitfolio.holdings.v1';
  const TRADES_KEY = 'orbitfolio.trades.v1';
  const PLANS_KEY = 'orbitfolio.exitPlans.v1';
  const FINMIND_API = 'https://api.finmindtrade.com/api/v4/data';
  const QUOTE_SOURCE = 'FinMind';
  const DEFAULT_HOLDINGS = [{ id: 'holding-00631L', symbol: '00631L', name: '元大台灣50正2', type: 'ETF', shares: 1200, cost: 25.5, purchaseDate: '', notes: '', price: null, createdAt: new Date().toISOString() }];
  const cloudConfig = window.ORBITFOLIO_SUPABASE || {};
  const cloudConfigured = Boolean(cloudConfig.url && cloudConfig.publishableKey);
  let cloudClient = null;
  if (cloudConfigured && window.supabase?.createClient) {
    cloudClient = window.supabase.createClient(cloudConfig.url, cloudConfig.publishableKey);
  }
  let currentUser = null;
  const $ = (selector) => document.querySelector(selector);
  const holdingsBody = $('#holdingsBody');
  const holdingDialog = $('#holdingDialog');
  const holdingForm = $('#holdingForm');
  const toast = $('#toast');
  let holdings = readJson(HOLDINGS_KEY, null);
  let trades = readJson(TRADES_KEY, []);
  let plans = readJson(PLANS_KEY, null);
  let deleteTarget = null;
  let quoteLookupSequence = 0;
  let quoteRefreshInFlight = false;
  let symbolLookupPromise = Promise.resolve();
  const stockInfoCache = new Map();
  const quoteCache = new Map();
  const expandedTradeDetails = new Set();
  if (!Array.isArray(holdings)) { holdings = DEFAULT_HOLDINGS; saveHoldings(); }
  if (!Array.isArray(trades)) { trades = []; saveTrades(); }
  if (!plans || !plans['00631L']) { plans = { ...(plans || {}), '00631L': { totalShares: 1200, batches: [400, 400, 400] } }; savePlans(); }

  function readJson(key, fallback) { try { const value = localStorage.getItem(key); return value === null ? fallback : JSON.parse(value); } catch { return fallback; } }
  function saveHoldings() { localStorage.setItem(HOLDINGS_KEY, JSON.stringify(holdings)); }
  function saveTrades() { localStorage.setItem(TRADES_KEY, JSON.stringify(trades)); }
  function savePlans() { localStorage.setItem(PLANS_KEY, JSON.stringify(plans)); }
  function clearPortfolioCache() {
    localStorage.removeItem(HOLDINGS_KEY);
    localStorage.removeItem(TRADES_KEY);
    localStorage.removeItem(PLANS_KEY);
  }
  function isUuid(value) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '')); }
  function fromHoldingRow(row) {
    return { id: row.id, symbol: row.symbol, name: row.name, type: row.asset_type, shares: Number(row.shares), cost: Number(row.average_cost), purchaseDate: row.purchase_date || '', notes: row.notes || '', price: row.latest_price == null ? null : Number(row.latest_price), createdAt: row.created_at };
  }
  function toHoldingRow(item) {
    return { user_id: currentUser.id, symbol: item.symbol, name: item.name, asset_type: item.type, shares: item.shares, average_cost: item.cost, purchase_date: item.purchaseDate || null, notes: item.notes || '', latest_price: item.price ?? null, updated_at: new Date().toISOString() };
  }
  async function persistQuote(item, quote) {
    if (!cloudClient || !currentUser) return;
    const { error } = await cloudClient.from('holdings').update({
      latest_price: quote.price,
      updated_at: new Date().toISOString()
    }).eq('id', item.id);
    if (error) throw error;
  }
  async function persistHolding(item) {
    if (!cloudClient) return item;
    if (!currentUser) throw new Error('請先登入再儲存持股。');
    const row = toHoldingRow(item);
    const request = isUuid(item.id)
      ? cloudClient.from('holdings').update(row).eq('id', item.id).select().single()
      : cloudClient.from('holdings').insert(row).select().single();
    const { data, error } = await request;
    if (error) throw error;
    return fromHoldingRow(data);
  }
  function rowToTrade(row) {
    return { id: row.id, symbol: row.symbol, side: row.side, shares: Number(row.shares), price: Number(row.execution_price), tradedAt: row.traded_at, fees: Number(row.fees), notes: row.notes || '' };
  }
  async function persistTrade(item, trade) {
    if (!cloudClient) return { ...trade, id: trade.id || `trade-${Date.now()}`, holdingId: item.id };
    if (!currentUser) throw new Error('請先登入再新增買進紀錄。');
    const { data, error } = await cloudClient.from('trades').insert({
      user_id: currentUser.id,
      holding_id: item.id,
      symbol: item.symbol,
      side: trade.side,
      shares: trade.shares,
      execution_price: trade.price,
      traded_at: trade.tradedAt,
      fees: trade.fees,
      notes: trade.notes
    }).select().single();
    if (error) throw error;
    return rowToTrade(data);
  }
  async function loadCloudData(user) {
    const [holdingResult, tradeResult, planResult] = await Promise.all([
      cloudClient.from('holdings').select('*').order('symbol'),
      cloudClient.from('trades').select('*').order('traded_at'),
      cloudClient.from('exit_plans').select('*').order('symbol')
    ]);
    for (const result of [holdingResult, tradeResult, planResult]) if (result.error) throw result.error;
    let cloudHoldings = holdingResult.data || [];
    let cloudTrades = tradeResult.data || [];
    let cloudPlans = planResult.data || [];
    const isNewAccount = !cloudHoldings.length && !cloudTrades.length && !cloudPlans.length;
    if (isNewAccount) {
      const localHoldings = readJson(HOLDINGS_KEY, null);
      const seed = Array.isArray(localHoldings) && localHoldings.length ? localHoldings : DEFAULT_HOLDINGS;
      const { data, error } = await cloudClient.from('holdings').upsert(seed.map((item) => toHoldingRowForUser(item, user)), { onConflict: 'user_id,symbol' }).select();
      if (error) throw error;
      cloudHoldings = data || [];
    }
    const hasPlan = cloudPlans.some((plan) => plan.symbol === '00631L');
    if (!hasPlan && (isNewAccount || cloudHoldings.some((item) => item.symbol === '00631L'))) {
      const { data, error } = await cloudClient.from('exit_plans').upsert({ user_id: user.id, symbol: '00631L', initial_shares: 1200, batches: [400, 400, 400] }, { onConflict: 'user_id,symbol' }).select();
      if (error) throw error;
      cloudPlans = [...cloudPlans.filter((plan) => plan.symbol !== '00631L'), ...(data || [])];
    }
    holdings = cloudHoldings.map(fromHoldingRow);
    trades = cloudTrades.map(rowToTrade);
    plans = Object.fromEntries(cloudPlans.map((plan) => [plan.symbol, { totalShares: Number(plan.initial_shares), batches: Array.isArray(plan.batches) ? plan.batches.map(Number) : [400, 400, 400] }]));
    if (!plans['00631L']) plans['00631L'] = { totalShares: 1200, batches: [400, 400, 400] };
    saveHoldings(); saveTrades(); savePlans();
    currentUser = user;
    $('#accountEmail').textContent = user.email || '已登入';
    $('#accountEmail').hidden = false; $('#signOut').hidden = false;
    $('#syncTitle').textContent = '雲端同步中'; $('#syncDetail').textContent = '已同步至你的帳號';
    $('#syncDot').classList.add('cloud-sync-dot');
    $('#localModeNotice').hidden = true;
    $('#authGate').hidden = true; $('#appShell').hidden = false;
    render();
    refreshHoldingQuotes({ quiet: true });
  }
  function toHoldingRowForUser(item, user) {
    return { user_id: user.id, symbol: item.symbol, name: item.name, asset_type: item.type, shares: item.shares, average_cost: item.cost, purchase_date: item.purchaseDate || null, notes: item.notes || '', latest_price: item.price ?? null };
  }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char])); }
  function number(value) { return Number(value).toLocaleString('zh-TW', { maximumFractionDigits: 4 }); }
  function money(value) { return `NT$ ${Number(value).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
  function taipeiDateString(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  }
  function dateDaysAgo(days) {
    const [year, month, day] = taipeiDateString().split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day - days));
    return date.toISOString().slice(0, 10);
  }
  function formatTaipeiTime(value) {
    if (!value) return '更新時間未知';
    return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
  }
  async function fetchFinMind(params) {
    const url = new URL(FINMIND_API);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error(`行情服務回覆 ${response.status}`);
    const payload = await response.json();
    if (payload.status !== 200 || !Array.isArray(payload.data)) throw new Error(payload.msg || '行情資料格式異常');
    return payload.data;
  }
  async function lookupStock(symbol) {
    const normalized = symbol.trim().toUpperCase();
    if (!normalized) throw new Error('請先輸入股票代號。');
    if (stockInfoCache.has(normalized)) return stockInfoCache.get(normalized);
    const rows = await fetchFinMind({ dataset: 'TaiwanStockInfo', data_id: normalized });
    const found = rows.find((row) => String(row.stock_id).toUpperCase() === normalized);
    if (!found) throw new Error('查無此代號，請確認後手動輸入名稱。');
    const info = { symbol: normalized, name: found.stock_name, type: found.industry_category === 'ETF' ? 'ETF' : '個股' };
    stockInfoCache.set(normalized, info);
    return info;
  }
  async function fetchLatestQuote(symbol) {
    const normalized = symbol.trim().toUpperCase();
    const rows = await fetchFinMind({ dataset: 'TaiwanStockPrice', data_id: normalized, start_date: dateDaysAgo(10) });
    const latest = rows.filter((row) => String(row.stock_id).toUpperCase() === normalized && Number.isFinite(Number(row.close)) && Number(row.close) > 0).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!latest) throw new Error('資料來源目前沒有此代號的近期收盤行情。');
    return { price: Number(latest.close), quoteDate: latest.date, quoteUpdatedAt: new Date().toISOString(), quoteSource: QUOTE_SOURCE };
  }
  function quoteDescription(item) {
    if (!item.quoteDate) return '尚無行情資料日期';
    return `${item.quoteDate} 收盤 · 更新 ${formatTaipeiTime(item.quoteUpdatedAt)}`;
  }
  async function refreshHoldingQuotes({ quiet = false } = {}) {
    if (quoteRefreshInFlight || !holdings.length) return;
    quoteRefreshInFlight = true;
    const button = $('#refreshQuotes');
    if (button) { button.disabled = true; button.textContent = '更新中…'; }
    const refreshUserId = currentUser?.id || null;
    const itemsToRefresh = [...holdings];
    let updated = 0; let failures = 0;
    try {
      for (const item of itemsToRefresh) {
        if ((currentUser?.id || null) !== refreshUserId) return;
        try {
          const quote = await fetchLatestQuote(item.symbol);
          if ((currentUser?.id || null) !== refreshUserId) return;
          const currentItem = holdings.find((holding) => holding.id === item.id);
          if (!currentItem) continue;
          Object.assign(currentItem, quote);
          quoteCache.set(item.symbol.toUpperCase(), quote);
          await persistQuote(currentItem, quote);
          updated++;
        } catch (error) {
          failures++;
          console.warn(`行情更新失敗：${item.symbol}`, error);
        }
      }
      if ((currentUser?.id || null) !== refreshUserId) return;
      saveHoldings(); render();
      const latestDate = holdings.map((item) => item.quoteDate).filter(Boolean).sort().at(-1);
      const status = failures
        ? `行情更新 ${updated} 項，${failures} 項失敗${latestDate ? ` · 最新資料日 ${latestDate}` : ''}`
        : `最新收盤行情 · 資料日 ${latestDate || '—'} · 更新 ${formatTaipeiTime(new Date().toISOString())} · 資料來源 FinMind`;
      $('#quoteStatus').textContent = status;
      $('#quoteStatus').classList.toggle('quote-warning', failures > 0);
      if (!quiet) showToast(failures ? `行情更新完成，${failures} 筆未能更新` : '持股行情已更新');
    } finally {
      quoteRefreshInFlight = false;
      if (button) { button.disabled = false; button.innerHTML = '↻ 更新行情'; }
    }
  }
  function showToast(message) { toast.textContent = message; toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400); }
  function setToday() { const now = new Date(); $('#todayLabel').textContent = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' }).format(now); }
  const pageLabels = { overview: '投資總覽', holdings: '我的持股', plans: '持股計劃' };
  function showCurrentPage() {
    let page = window.location.hash.slice(1);
    if (!Object.hasOwn(pageLabels, page)) page = 'overview';
    document.querySelectorAll('[data-page-view]').forEach((view) => { view.hidden = view.dataset.pageView !== page; });
    document.querySelectorAll('.nav-item[data-route]').forEach((link) => {
      const active = link.dataset.route === page;
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
    $('#currentPageLabel').textContent = pageLabels[page];
    if (window.location.hash !== `#${page}`) history.replaceState(null, '', `#${page}`);
  }
  window.addEventListener('hashchange', showCurrentPage);
  function tradesFor(symbol) { return trades.filter((trade) => trade.symbol === symbol); }
  function renderTradeDetails(item) {
    const rows = [...tradesFor(item.symbol)].sort((a, b) => String(b.tradedAt).localeCompare(String(a.tradedAt)));
    if (!rows.length) return '<div class="transaction-empty">這檔持股目前沒有成交紀錄。</div>';
    const details = rows.map((trade) => {
      const date = trade.tradedAt ? new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(trade.tradedAt)) : '—';
      const totalCost = Number(trade.shares) * Number(trade.price) + Number(trade.fees || 0);
      return `<tr><td>${date}</td><td>${trade.side === 'buy' ? '買進' : '賣出'}</td><td class="numeric">${number(trade.shares)} 股</td><td class="numeric">${unitMoney(trade.price)}</td><td class="numeric">${money(Number(trade.fees || 0))}</td><td class="numeric">${money(totalCost)}</td><td>${escapeHtml(trade.notes || '—')}</td></tr>`;
    }).join('');
    return `<div class="transaction-detail"><div class="transaction-detail-heading"><strong>${escapeHtml(item.symbol)} ${escapeHtml(item.name)} · 交易明細</strong><span>${rows.length} 筆</span></div><div class="transaction-detail-scroll"><table><thead><tr><th>日期</th><th>方向</th><th class="numeric">股數</th><th class="numeric">成交單價</th><th class="numeric">手續費</th><th class="numeric">本次總成本</th><th>備註</th></tr></thead><tbody>${details}</tbody></table></div></div>`;
  }
  function soldShares(symbol) { return tradesFor(symbol).filter((trade) => trade.side === 'sell').reduce((sum, trade) => sum + Number(trade.shares || 0), 0); }
  function getDisplayCost(item) {
    const baselineShares = Number(item.initialShares ?? item.shares) || 0;
    const baselineCost = Number(item.cost) || 0;
    const buys = tradesFor(item.symbol).filter((trade) => trade.side === 'buy');
    const boughtShares = buys.reduce((sum, trade) => sum + Number(trade.shares || 0), 0);
    const buyCost = buys.reduce((sum, trade) => sum + Number(trade.shares || 0) * Number(trade.price || 0) + Number(trade.fees || 0), 0);
    const totalShares = baselineShares + boughtShares;
    return totalShares > 0 ? (baselineShares * baselineCost + buyCost) / totalShares : baselineCost;
  }
  function unitMoney(value) { return `NT$ ${Number(value).toLocaleString('zh-TW', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`; }
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
      const cost = getDisplayCost(item);
      const totalCost = shares * cost;
      const hasPrice = Number.isFinite(Number(item.price)) && item.price !== null && item.price !== '';
      const price = hasPrice ? Number(item.price) : null;
      const market = hasPrice ? shares * price : null;
      const pnl = hasPrice ? market - totalCost : null;
      const icon = escapeHtml(item.symbol.slice(0, 4));
      const itemTrades = tradesFor(item.symbol);
      const detailsOpen = expandedTradeDetails.has(item.id);
      return `<tr>
        <td class="check-cell"><input type="checkbox" aria-label="選取 ${escapeHtml(item.symbol)}" disabled></td>
        <td><div class="asset-cell"><div class="ticker-icon ${item.type === 'ETF' ? 'etf' : 'stock'}">${icon}</div><div class="asset-name"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.symbol)}${item.purchaseDate ? ` · ${escapeHtml(item.purchaseDate)}` : ''}</small></div></div></td>
        <td><span class="type-badge">${escapeHtml(item.type)}</span></td>
        <td class="numeric amount">${number(shares)}</td><td class="numeric amount">${unitMoney(cost)}</td><td class="numeric amount">${money(totalCost)}</td>
        <td class="numeric ${hasPrice ? 'amount' : 'na'}">${hasPrice ? `${money(price)}<small class="quote-meta">${escapeHtml(quoteDescription(item))}</small>` : '尚無行情'}</td><td class="numeric ${hasPrice ? 'amount' : 'na'}">${hasPrice ? money(market) : '—'}</td>
        <td class="numeric ${hasPrice ? (pnl >= 0 ? 'positive' : 'negative') : 'na'}">${hasPrice ? `${pnl >= 0 ? '+' : ''}${money(pnl)}<small class="return"> ${pnl >= 0 ? '+' : ''}${(pnl / totalCost * 100).toFixed(2)}%</small>` : '—'}</td>
        <td><div class="row-actions"><button data-action="buy" data-id="${escapeHtml(item.id)}">新增買進</button><button data-action="details" data-id="${escapeHtml(item.id)}" aria-expanded="${detailsOpen}">交易明細${itemTrades.length ? ` ${itemTrades.length}` : ''}</button><button data-action="edit" data-id="${escapeHtml(item.id)}">編輯</button><button data-action="delete" data-id="${escapeHtml(item.id)}">刪除</button></div></td>
      </tr>${detailsOpen ? `<tr class="transaction-detail-row"><td colspan="10">${renderTradeDetails(item)}</td></tr>` : ''}`;
    }).join('');
    $('#emptyState').hidden = filtered.length > 0;
    $('#holdingCount').textContent = holdings.length;
    $('#navCount').textContent = holdings.length;
    $('#assetCount').textContent = `${holdings.length} 項資產`;
    $('#tableSummary').textContent = `顯示 ${filtered.length} 項資產`;
    const totalCost = holdings.reduce((sum, item) => sum + getDisplayShares(item) * getDisplayCost(item), 0);
    const priced = holdings.filter((item) => item.price !== null && item.price !== '' && Number.isFinite(Number(item.price)));
    const allPriced = holdings.length > 0 && priced.length === holdings.length;
    const marketValue = priced.reduce((sum, item) => sum + getDisplayShares(item) * Number(item.price), 0);
    const unrealized = marketValue - priced.reduce((sum, item) => sum + getDisplayShares(item) * getDisplayCost(item), 0);
    $('#totalCost').textContent = money(totalCost);
    $('#marketValue').textContent = allPriced ? money(marketValue) : '尚無行情';
    $('#marketNote').textContent = allPriced ? `${priced.length} 項資產已取得價格` : `${holdings.length - priced.length} 項資產尚無行情`;
    $('#unrealized').textContent = allPriced ? `${unrealized >= 0 ? '+' : ''}${money(unrealized)}` : '尚無行情';
    $('#unrealized').className = `metric${allPriced && unrealized < 0 ? ' negative' : allPriced ? ' positive' : ''}`;
    const etfCost = holdings.filter((item) => item.type === 'ETF').reduce((sum, item) => sum + getDisplayShares(item) * getDisplayCost(item), 0);
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
    holdingForm.reset(); $('#holdingId').value = ''; $('#dialogTitle').textContent = '新增持股'; delete $('#name').dataset.autoSymbol; $('#shares').disabled = false; $('#cost').disabled = false; symbolLookupPromise = Promise.resolve();
    document.querySelectorAll('.field-error').forEach((el) => el.textContent = '');
  }
  function openEditor(item = null) {
    resetForm();
    if (item) {
      $('#dialogTitle').textContent = '編輯持股'; $('#holdingId').value = item.id;
      $('#symbol').value = item.symbol; $('#name').value = item.name; $('#assetType').value = item.type;
      $('#shares').value = getDisplayShares(item); $('#cost').value = getDisplayCost(item); $('#purchaseDate').value = item.purchaseDate || ''; $('#notes').value = item.notes || '';
      if (tradesFor(item.symbol).length) { $('#shares').disabled = true; $('#cost').disabled = true; $('#costLockHint').hidden = false; } else $('#costLockHint').hidden = true;
      $('#quoteLookupStatus').textContent = item.price != null ? `最近收盤 ${money(item.price)} · ${quoteDescription(item)}` : '尚無行情，輸入代號後可查詢。';
    } else { $('#costLockHint').hidden = true; $('#shares').disabled = false; $('#quoteLookupStatus').textContent = '輸入代號後自動帶入名稱及最近收盤價。'; }
    holdingDialog.showModal();
  }
  $('#symbol').addEventListener('input', () => {
    quoteLookupSequence++;
    const autoSymbol = $('#name').dataset.autoSymbol;
    if (autoSymbol && autoSymbol !== $('#symbol').value.trim().toUpperCase()) { $('#name').value = ''; delete $('#name').dataset.autoSymbol; }
    symbolLookupPromise = Promise.resolve();
  });
  $('#name').addEventListener('input', () => { delete $('#name').dataset.autoSymbol; });
  $('#symbol').addEventListener('blur', () => {
    const symbol = $('#symbol').value.trim().toUpperCase();
    if (!symbol) return;
    $('#symbol').value = symbol;
    const sequence = ++quoteLookupSequence;
    $('#quoteLookupStatus').textContent = '查詢代號與行情中…';
    symbolLookupPromise = (async () => {
      try {
        const [info, quote] = await Promise.all([lookupStock(symbol), fetchLatestQuote(symbol)]);
        if (sequence !== quoteLookupSequence || $('#symbol').value.trim().toUpperCase() !== symbol) return;
        if (!$('#name').value.trim() || $('#name').dataset.autoSymbol) { $('#name').value = info.name; $('#name').dataset.autoSymbol = symbol; }
        $('#assetType').value = info.type;
        quoteCache.set(symbol, quote);
        $('#quoteLookupStatus').textContent = `已帶入「${info.name}」｜最近收盤 ${money(quote.price)} · ${quote.quoteDate} · FinMind`;
      } catch (error) {
        if (sequence === quoteLookupSequence) $('#quoteLookupStatus').textContent = `${error.message || '行情查詢失敗'}；可手動輸入名稱，價格不會填入假資料。`;
      }
    })();
    return symbolLookupPromise;
  });
  $('#refreshQuotes').addEventListener('click', () => refreshHoldingQuotes());
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
  holdingForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await symbolLookupPromise;
    if (!validateForm()) return;
    const id = $('#holdingId').value;
    const previous = holdings.find((item) => item.id === id);
    const normalizedSymbol = $('#symbol').value.trim().toUpperCase();
    const sameSymbol = previous?.symbol.toUpperCase() === normalizedSymbol;
    const fetchedQuote = quoteCache.get(normalizedSymbol);
    const item = { id: id || `holding-${Date.now()}`, symbol: normalizedSymbol, name: $('#name').value.trim(), type: $('#assetType').value, shares: previous && tradesFor(previous.symbol).length ? previous.shares : Number($('#shares').value), cost: previous && tradesFor(previous.symbol).length ? previous.cost : Number($('#cost').value), purchaseDate: $('#purchaseDate').value, notes: $('#notes').value.trim(), price: sameSymbol ? (fetchedQuote?.price ?? previous.price) : (fetchedQuote?.price ?? null), quoteDate: sameSymbol ? (fetchedQuote?.quoteDate ?? previous.quoteDate) : (fetchedQuote?.quoteDate ?? ''), quoteUpdatedAt: sameSymbol ? (fetchedQuote?.quoteUpdatedAt ?? previous.quoteUpdatedAt) : (fetchedQuote?.quoteUpdatedAt ?? ''), quoteSource: sameSymbol ? (fetchedQuote?.quoteSource ?? previous.quoteSource) : (fetchedQuote?.quoteSource ?? ''), createdAt: previous?.createdAt || new Date().toISOString() };
    const saveButton = holdingForm.querySelector('[type="submit"]'); saveButton.disabled = true;
    try {
      const saved = await persistHolding(item);
      if (previous) {
        if (previous.initialShares != null) saved.initialShares = previous.initialShares;
        holdings = holdings.map((row) => row.id === id ? saved : row);
      } else holdings.push(saved);
      saveHoldings(); holdingDialog.close(); render(); showToast(cloudClient ? '持股已儲存並同步' : previous ? '持股資料已更新' : '持股已新增');
    } catch (error) { showMessage('儲存失敗', error.message || '請確認網路與雲端資料庫設定。'); }
    finally { saveButton.disabled = false; }
  });
  $('#addHolding').addEventListener('click', () => openEditor());
  function openBuyDialog(item) {
    $('#buyForm').reset();
    $('#buyHoldingId').value = item.id;
    $('#buySymbolLabel').textContent = `${item.symbol} ${item.name}`;
    $('#buyShares').value = '';
    $('#buyPrice').value = '';
    $('#buyFees').value = '0';
    $('#buyDate').value = taipeiDateString();
    $('#buyNotes').value = '';
    updateBuyTotalPreview();
    $('#buyDialog').showModal();
  }
  function updateBuyTotalPreview() {
    const shares = Number($('#buyShares').value);
    const price = Number($('#buyPrice').value);
    const fees = Number($('#buyFees').value || 0);
    const total = shares > 0 && price > 0 && fees >= 0 ? shares * price + fees : 0;
    $('#buyTotalPreview').textContent = money(total);
  }
  ['#buyShares', '#buyPrice', '#buyFees'].forEach((selector) => $(selector).addEventListener('input', updateBuyTotalPreview));
  $('#buyForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const item = holdings.find((holding) => holding.id === $('#buyHoldingId').value);
    if (!item) return;
    const shares = Number($('#buyShares').value);
    const price = Number($('#buyPrice').value);
    const fees = Number($('#buyFees').value || 0);
    if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(price) || price <= 0 || !Number.isFinite(fees) || fees < 0) {
      showMessage('資料需確認', '股數與成交單價必須大於 0，手續費不可小於 0。'); return;
    }
    const date = $('#buyDate').value;
    if (!date || Number.isNaN(new Date(`${date}T12:00:00+08:00`).getTime())) { showMessage('資料需確認', '請選擇有效的成交日期。'); return; }
    const trade = { symbol: item.symbol, side: 'buy', shares, price, fees, tradedAt: new Date(`${date}T12:00:00+08:00`).toISOString(), notes: $('#buyNotes').value.trim() };
    const keepAdding = event.submitter?.id === 'buySaveContinue';
    const buttons = [$('#buySubmit'), $('#buySaveContinue')]; buttons.forEach((button) => { button.disabled = true; });
    try {
      const saved = await persistTrade(item, trade);
      trades.push(saved); saveTrades(); expandedTradeDetails.add(item.id); render();
      if (keepAdding) {
        $('#buyShares').value = ''; $('#buyPrice').value = ''; $('#buyFees').value = '0'; $('#buyNotes').value = '';
        updateBuyTotalPreview(); $('#buyShares').focus();
        showToast(`本筆已儲存；目前持有 ${number(getDisplayShares(item))} 股，均價 ${unitMoney(getDisplayCost(item))}`);
      } else {
        $('#buyDialog').close();
        showToast(`買進紀錄已新增，持有 ${number(getDisplayShares(item))} 股，均價 ${unitMoney(getDisplayCost(item))}`);
      }
    } catch (error) { showMessage('買進紀錄儲存失敗', error.message || '請確認雲端連線後重試。'); }
    finally { buttons.forEach((button) => { button.disabled = false; }); }
  });
  holdingsBody.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]'); if (!button) return;
    const item = holdings.find((row) => row.id === button.dataset.id); if (!item) return;
    if (button.dataset.action === 'details') { if (expandedTradeDetails.has(item.id)) expandedTradeDetails.delete(item.id); else expandedTradeDetails.add(item.id); render(); return; }
    if (button.dataset.action === 'buy') openBuyDialog(item);
    if (button.dataset.action === 'edit') openEditor(item);
    if (button.dataset.action === 'delete') { deleteTarget = item.id; $('#confirmDialog').showModal(); }
  });
  $('#confirmDelete').addEventListener('click', async () => {
    const item = holdings.find((row) => row.id === deleteTarget);
    if (item && tradesFor(item.symbol).length) { $('#confirmDialog').close(); showMessage('無法刪除持股', '這筆持股已有交易紀錄。為保留交易歷史，請勿刪除；目前系統僅支援新增買進紀錄，尚未開放賣出記帳。'); deleteTarget = null; return; }
    const button = $('#confirmDelete'); button.disabled = true;
    try {
      if (cloudClient && item) { const { error } = await cloudClient.from('holdings').delete().eq('id', item.id); if (error) throw error; }
      holdings = holdings.filter((row) => row.id !== deleteTarget); saveHoldings(); $('#confirmDialog').close(); deleteTarget = null; render(); showToast('持股已刪除');
    } catch (error) { $('#confirmDialog').close(); showMessage('刪除失敗', error.message || '請確認雲端連線後重試。'); }
    finally { button.disabled = false; }
  });
  function showMessage(title, message) { $('#messageTitle').textContent = title; $('#messageText').textContent = message; $('#messageDialog').showModal(); }
  $('#searchInput').addEventListener('input', render);
  $('#typeFilter').addEventListener('change', render);
  document.addEventListener('keydown', (event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#searchInput').focus(); } });
  document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); }));
  $('#exitLearnMore').addEventListener('click', () => $('#exitInfoDialog').showModal());

  function csvCell(value) {
    let text = String(value ?? '');
    // Prevent spreadsheet formula execution when user-controlled text is opened in Excel/Sheets.
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }
  $('#exportCsv').addEventListener('click', () => {
    const headers = ['股票代號', '股票名稱', '資產類型', '持有股數', '平均成本', '買進日期', '備註'];
    const rows = holdings.map((item) => [item.symbol, item.name, item.type, getDisplayShares(item), getDisplayCost(item), item.purchaseDate, item.notes]);
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
      let added = 0; let updated = 0; let ledgerProtected = 0; const nextHoldings = [...holdings];
      for (const incoming of imported) {
        const existingIndex = nextHoldings.findIndex((item) => item.symbol.toUpperCase() === incoming.symbol);
        const existing = existingIndex >= 0 ? nextHoldings[existingIndex] : null;
        const hasLedger = Boolean(existing && tradesFor(existing.symbol).length);
        const candidate = { ...incoming, ...(hasLedger ? { shares: existing.shares, cost: existing.cost } : {}), id: existing?.id || `holding-${Date.now()}-${added}`, price: existing?.price ?? null, createdAt: existing?.createdAt || new Date().toISOString() };
        const saved = await persistHolding(candidate);
        if (existing?.initialShares != null) saved.initialShares = existing.initialShares;
        if (existingIndex >= 0) { nextHoldings[existingIndex] = saved; updated++; if (hasLedger) ledgerProtected++; }
        else { nextHoldings.push(saved); added++; }
      }
      holdings = nextHoldings;
      saveHoldings(); render(); showToast(`匯入完成：新增 ${added} 筆，更新 ${updated} 筆${ledgerProtected ? `；${ledgerProtected} 筆含成交紀錄，股數與均價依紀錄保留` : ''}`);
    } catch (error) { showMessage('CSV 匯入失敗', error.message || '請檢查檔案格式。'); }
    event.target.value = '';
  });
  let authMode = 'signin';
  function setAuthMode(mode) {
    authMode = mode;
    const signup = mode === 'signup';
    $('#authTitle').textContent = signup ? '建立 Orbitfolio 帳號' : '登入 Orbitfolio';
    $('#authIntro').textContent = signup ? '建立帳號後，你可以在不同裝置登入並同步持股。' : '登入後即可在不同裝置查看與管理同一份持股資料。';
    $('#authSubmit').textContent = signup ? '建立帳號' : '登入';
    $('#authPassword').autocomplete = signup ? 'new-password' : 'current-password';
    $('#authToggle').textContent = signup ? '已經有帳號？返回登入' : '還沒有帳號？建立帳號';
    $('#authFeedback').textContent = ''; $('#authFeedback').classList.remove('success');
  }
  function showAuthGate(message = '') {
    if (currentUser) clearPortfolioCache();
    currentUser = null; $('#appShell').hidden = true; $('#authGate').hidden = false;
    $('#accountEmail').hidden = true; $('#signOut').hidden = true;
    $('#authFeedback').textContent = message; $('#authFeedback').classList.remove('success');
  }
  async function activateUser(user) {
    try { await loadCloudData(user); }
    catch (error) { showAuthGate(`無法載入雲端資料：${error.message || '請確認 Supabase 資料表與 RLS 設定。'}`); }
  }
  $('#authToggle').addEventListener('click', () => setAuthMode(authMode === 'signin' ? 'signup' : 'signin'));
  $('#authForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!cloudClient) return;
    const email = $('#authEmail').value.trim(); const password = $('#authPassword').value;
    const submit = $('#authSubmit'); const feedback = $('#authFeedback');
    submit.disabled = true; feedback.textContent = '連線中…'; feedback.classList.remove('success');
    try {
      if (authMode === 'signup') {
        const { data, error } = await cloudClient.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` } });
        if (error) throw error;
        if (data.session) await activateUser(data.session.user);
        else { feedback.textContent = '帳號建立成功。請先到電子郵件點擊確認連結，再回來登入。'; feedback.classList.add('success'); }
      } else {
        const { data, error } = await cloudClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data.user) await activateUser(data.user);
      }
    } catch (error) { feedback.textContent = error.message || '登入失敗，請檢查電子郵件與密碼。'; }
    finally { submit.disabled = false; }
  });
  $('#signOut').addEventListener('click', async () => {
    if (!cloudClient) return;
    const { error } = await cloudClient.auth.signOut();
    if (error) showMessage('登出失敗', error.message);
    else showAuthGate('已安全登出。');
  });

  setToday();
  showCurrentPage();
  if (!cloudConfigured) {
    $('#syncTitle').textContent = '尚未連接雲端';
    $('#syncDetail').textContent = '資料保存在此瀏覽器';
    $('#localModeNotice').hidden = false;
    render();
    refreshHoldingQuotes({ quiet: true });
  } else if (!cloudClient) {
    showAuthGate('無法載入 Supabase 用戶端。請確認網路連線，或重新部署網站。');
  } else {
    $('#localModeNotice').hidden = true; showAuthGate(); setAuthMode('signin');
    cloudClient.auth.onAuthStateChange((event) => { if (event === 'SIGNED_OUT') showAuthGate(); });
    cloudClient.auth.getSession().then(({ data, error }) => {
      if (error) { showAuthGate(`登入狀態讀取失敗：${error.message}`); return; }
      if (data.session?.user) activateUser(data.session.user);
    }).catch((error) => showAuthGate(`連線失敗：${error.message || '請稍後重試。'}`));
  }
})();
