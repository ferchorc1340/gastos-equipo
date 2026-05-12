// ─────────────────────────────────────────
//  CONFIGURACIÓN — reemplazá estos valores
//  con los de tu proyecto en Supabase
// ─────────────────────────────────────────
const SUPABASE_URL = 'lsrkyluiqwkiqzssirrx';
const SUPABASE_ANON_KEY = 'sb_publishable_gUDE_wEYa5qInfXPLlcTMQ_Kr24iUL3';
const ANTHROPIC_KEY = ''; // opcional — dejá vacío si no tenés key de Anthropic

// ─────────────────────────────────────────
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MEMBERS = {
  Cami:     { bg: '#D4A5C9', color: '#7A3B6E', init: 'CA' },
  Ale:      { bg: '#A5C9D4', color: '#1E5F6E', init: 'AL' },
  Kathy:    { bg: '#C9D4A5', color: '#4A5E1E', init: 'KA' },
  Fernando: { bg: '#D4BCA5', color: '#6E4A1E', init: 'FE' }
};

let purchases = [];
let weekOffset = 0;
let selectedMember = null;
let receiptDataUrl = null;

// ── Data ─────────────────────────────────

async function loadData() {
  try {
    const { data, error } = await db
      .from('purchases')
      .select('*')
      .order('date', { ascending: false });
    if (error) throw error;
    purchases = data || [];
  } catch (e) {
    showToast('Error cargando datos');
    purchases = [];
  }
  updateHeader();
}

async function saveData(entry) {
  const { error } = await db.from('purchases').insert([entry]);
  if (error) throw error;
}

// ── Week helpers ──────────────────────────

function getWeekRange(offset) {
  const now = new Date();
  const day = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
  mon.setHours(0, 0, 0, 0);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  sun.setHours(23, 59, 59, 999);
  return { start: mon, end: sun };
}

function weekLabel(offset) {
  if (offset === 0) return 'Esta semana';
  if (offset === -1) return 'Semana pasada';
  const { start, end } = getWeekRange(offset);
  return `${start.getDate()}/${start.getMonth() + 1} – ${end.getDate()}/${end.getMonth() + 1}`;
}

function weekPurchases(offset = 0) {
  const { start, end } = getWeekRange(offset);
  return purchases.filter(p => {
    const d = new Date(p.date);
    return d >= start && d <= end;
  });
}

function updateHeader() {
  const week = weekPurchases(0);
  const total = week.reduce((s, p) => s + Number(p.amount), 0);
  document.getElementById('hdr-total').textContent = '$' + total.toFixed(2);
  const { start, end } = getWeekRange(0);
  const fmt = d => d.toLocaleDateString('es-SV', { day: 'numeric', month: 'short' });
  document.getElementById('hdr-week').textContent = `${fmt(start)} – ${fmt(end)}`;
}

// ── Member picker ─────────────────────────

function selectMember(btn) {
  document.querySelectorAll('.member-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  selectedMember = btn.dataset.name;
}

// ── Receipt / AI ──────────────────────────

function handleFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    receiptDataUrl = e.target.result;
    document.getElementById('rp-img').src = receiptDataUrl;
    document.getElementById('rp').style.display = 'block';
    await readComercioFromReceipt(receiptDataUrl);
  };
  reader.readAsDataURL(file);
}

async function readComercioFromReceipt(dataUrl) {
  if (!ANTHROPIC_KEY) return; // sin key, solo se muestra la foto

  const reading = document.getElementById('ai-reading');
  const badge = document.getElementById('ai-badge');
  const input = document.getElementById('f-comercio');

  reading.classList.add('show');
  badge.classList.remove('visible');

  try {
    const base64 = dataUrl.split(',')[1];
    const mediaType = dataUrl.split(';')[0].split(':')[1];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 80,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: 'Esta es una foto de una factura o ticket de compra. Extrae ÚNICAMENTE el nombre del comercio o razón social. Responde solo con el nombre, sin explicaciones ni puntuación extra. Si no podés identificarlo claramente, responde con: ?' }
          ]
        }]
      })
    });

    const data = await response.json();
    const name = data?.content?.[0]?.text?.trim();
    if (name && name !== '?') {
      input.value = name;
      badge.classList.add('visible');
      showToast('✓ Comercio leído de la factura');
    } else {
      showToast('No se pudo leer el comercio — escríbelo manualmente');
    }
  } catch (err) {
    showToast('Error al leer factura');
  } finally {
    reading.classList.remove('show');
  }
}

// ── Save purchase ─────────────────────────

async function savePurchase() {
  const desc = document.getElementById('f-desc').value.trim();
  const amount = parseFloat(document.getElementById('f-amount').value);
  const comercio = document.getElementById('f-comercio').value.trim();

  if (!selectedMember) { showToast('Selecciona quién compró'); return; }
  if (!desc) { showToast('Escribe una descripción'); return; }
  if (!amount || amount <= 0) { showToast('Ingresa un monto válido'); return; }

  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    // Upload receipt image to Supabase Storage if present
    let receiptUrl = null;
    if (receiptDataUrl) {
      const blob = await (await fetch(receiptDataUrl)).blob();
      const filename = `receipt-${Date.now()}.${blob.type.split('/')[1] || 'jpg'}`;
      const { data: uploadData, error: uploadError } = await db.storage
        .from('receipts')
        .upload(filename, blob, { contentType: blob.type });
      if (!uploadError) {
        const { data: { publicUrl } } = db.storage.from('receipts').getPublicUrl(filename);
        receiptUrl = publicUrl;
      }
    }

    const entry = {
      buyer: selectedMember,
      description: desc,
      amount,
      comercio: comercio || null,
      receipt_url: receiptUrl,
      date: new Date().toISOString()
    };

    await saveData(entry);
    await loadData();

    // Reset form
    document.getElementById('f-desc').value = '';
    document.getElementById('f-amount').value = '';
    document.getElementById('f-comercio').value = '';
    document.getElementById('f-receipt').value = '';
    document.getElementById('rp').style.display = 'none';
    document.getElementById('ai-badge').classList.remove('visible');
    receiptDataUrl = null;
    document.querySelectorAll('.member-btn').forEach(b => b.classList.remove('selected'));
    selectedMember = null;

    updateHeader();
    showToast('✓ Compra guardada');
  } catch (e) {
    showToast('Error al guardar — intentá de nuevo');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Guardar compra';
  }
}

// ── Render list ───────────────────────────

function renderList() {
  const week = weekPurchases(weekOffset);
  document.getElementById('wn-label').textContent = weekLabel(weekOffset);

  const total = week.reduce((s, p) => s + Number(p.amount), 0);
  document.getElementById('mt-total').textContent = '$' + total.toFixed(2);
  document.getElementById('mt-count').textContent = week.length;
  document.getElementById('mt-avg').textContent = week.length
    ? '$' + (total / week.length).toFixed(2)
    : '$0';

  const list = document.getElementById('purchases-list');
  if (!week.length) {
    list.innerHTML = `<div class="empty-state"><i class="ti ti-shopping-cart-off"></i><p>Sin compras esta semana</p></div>`;
    return;
  }

  list.innerHTML = [...week].map(p => {
    const m = MEMBERS[p.buyer] || { bg: '#eee', color: '#333', init: '?' };
    const dateStr = new Date(p.date).toLocaleDateString('es-SV', { weekday: 'short', day: 'numeric', month: 'short' });
    const thumb = p.receipt_url
      ? `<img class="receipt-thumb" src="${p.receipt_url}" onclick="openModal('${p.receipt_url}')" alt="ver factura" />`
      : '';
    const comercioTag = p.comercio
      ? `<span class="comercio-tag">${p.comercio}</span>`
      : '';
    return `<div class="purchase-card">
      <div class="p-avatar" style="background:${m.bg};color:${m.color}">${m.init}</div>
      <div class="p-body">
        <div class="p-desc">${p.description}</div>
        <div class="p-meta">
          <span>${p.buyer} · ${dateStr}</span>
          ${comercioTag}
        </div>
      </div>
      ${thumb}
      <div class="p-right">
        <div class="p-amount">$${Number(p.amount).toFixed(2)}</div>
      </div>
    </div>`;
  }).join('');
}

// ── Render balance ────────────────────────

function renderBalance() {
  const week = weekPurchases(0);
  const names = Object.keys(MEMBERS);
  const total = week.reduce((s, p) => s + Number(p.amount), 0);
  const share = total / names.length;

  const spent = {};
  names.forEach(n => spent[n] = 0);
  week.forEach(p => { if (spent[p.buyer] !== undefined) spent[p.buyer] += Number(p.amount); });

  const net = {};
  names.forEach(n => net[n] = spent[n] - share);

  const maxSpent = Math.max(...Object.values(spent), 1);

  document.getElementById('person-bars').innerHTML = names.map(n => {
    const m = MEMBERS[n];
    const pct = Math.round((spent[n] / maxSpent) * 100);
    const diff = net[n];
    const badge = diff > 0.01
      ? `<span class="pb-badge" style="background:#E8F5E9;color:#2E7D32">le deben $${diff.toFixed(2)}</span>`
      : diff < -0.01
      ? `<span class="pb-badge" style="background:#FFEBEE;color:#C62828">debe $${Math.abs(diff).toFixed(2)}</span>`
      : `<span class="pb-badge" style="background:#F5F5F5;color:#666">al día ✓</span>`;
    return `<div class="person-bar">
      <div class="pb-header">
        <div class="p-avatar" style="background:${m.bg};color:${m.color};width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">${m.init}</div>
        <div class="pb-name">${n}</div>
        <div class="pb-spent">$${spent[n].toFixed(2)}</div>
      </div>
      <div class="pb-bar-wrap"><div class="pb-bar" style="width:${pct}%;background:${m.bg}"></div></div>
      <div class="pb-row"><span style="color:#999;font-size:12px">cuota: $${share.toFixed(2)}</span>${badge}</div>
    </div>`;
  }).join('');

  // Settlement
  const debtors = names.filter(n => net[n] < -0.01).map(n => ({ name: n, amt: -net[n] }));
  const creditors = names.filter(n => net[n] > 0.01).map(n => ({ name: n, amt: net[n] }));
  const transactions = [];
  const d = debtors.map(x => ({ ...x }));
  const c = creditors.map(x => ({ ...x }));
  let di = 0, ci = 0;
  while (di < d.length && ci < c.length) {
    const pay = Math.min(d[di].amt, c[ci].amt);
    if (pay > 0.01) transactions.push({ from: d[di].name, to: c[ci].name, amt: pay });
    d[di].amt -= pay; c[ci].amt -= pay;
    if (d[di].amt < 0.01) di++;
    if (c[ci].amt < 0.01) ci++;
  }

  const settle = document.getElementById('settle-section');
  if (!transactions.length) {
    settle.innerHTML = total > 0
      ? `<div class="empty-state" style="padding:20px"><i class="ti ti-checks" style="font-size:32px;color:#4CAF50;opacity:1"></i><p>¡Todo está al día!</p></div>`
      : `<div class="empty-state" style="padding:20px"><i class="ti ti-receipt-off"></i><p>Registra compras para ver el balance</p></div>`;
    return;
  }

  settle.innerHTML = `<p class="section-label" style="margin-bottom:10px">Cómo liquidar</p>` +
    transactions.map(t => {
      const from = MEMBERS[t.from] || {};
      const to = MEMBERS[t.to] || {};
      return `<div class="txn-card">
        <div class="p-avatar" style="background:${from.bg};color:${from.color};width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">${from.init}</div>
        <div class="txn-body"><strong>${t.from}</strong> le paga a <strong>${t.to}</strong></div>
        <div class="p-avatar" style="background:${to.bg};color:${to.color};width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">${to.init}</div>
        <div class="txn-amount">$${t.amt.toFixed(2)}</div>
      </div>`;
    }).join('');
}

// ── Navigation ────────────────────────────

function weekShift(dir) {
  weekOffset += dir;
  renderList();
}

function showView(name) {
  ['add', 'list', 'balance'].forEach(v => {
    document.getElementById('view-' + v).classList.toggle('active', v === name);
    document.getElementById('nav-' + v).classList.toggle('active', v === name);
  });
  if (name === 'list') renderList();
  if (name === 'balance') renderBalance();
}

function openModal(url) {
  document.getElementById('modal-img').src = url;
  document.getElementById('modal').classList.add('open');
}
function closeModal() { document.getElementById('modal').classList.remove('open'); }

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

// ── Init + realtime ───────────────────────

loadData();

// Realtime: re-render when anyone inserts a new purchase
db.channel('purchases-changes')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'purchases' }, async () => {
    await loadData();
    const active = document.querySelector('.view.active');
    if (active?.id === 'view-list') renderList();
    if (active?.id === 'view-balance') renderBalance();
  })
  .subscribe();
