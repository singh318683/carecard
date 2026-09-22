/* CareCard prototype. Plain JS, no build step. Data lives in localStorage. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);
const money = n => '$' + (Number(n) || 0).toFixed(2);
const num = v => parseFloat(String(v).replace(/[^0-9.]/g, '')) || 0;
const fmtDate = d => d ? new Date(d + (d.length === 10 ? 'T12:00' : '')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const KEY = 'carecard-demo-v1';

let state = load();
let tab = 'cards';
let pendingImg = null;
let verifyDraft = null;

function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.cards) return s; } catch (e) {}
  return { cards: [], proofs: [], bills: [] };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { toast('Browser storage is full. Delete a card photo to free space.'); }
}
const cardById = id => state.cards.find(c => c.id === id);
const proofById = id => state.proofs.find(p => p.id === id);
const billById = id => state.bills.find(b => b.id === id);

/* Plain-English code dictionary (small demo set) */
const CODES = {
  '99202': 'New patient office visit, short', '99203': 'New patient office visit, moderate', '99204': 'New patient office visit, long',
  '99212': 'Office visit, returning patient, brief', '99213': 'Office visit, returning patient, standard',
  '99214': 'Office visit, returning patient, detailed', '99215': 'Office visit, returning patient, complex',
  '99243': 'Specialist consultation', '99283': 'Emergency room visit, moderate', '99285': 'Emergency room visit, severe',
  '36415': 'Blood draw from a vein', '85025': 'Complete blood count (CBC)', '80053': 'Comprehensive metabolic panel (blood chemistry)',
  '80061': 'Cholesterol panel', '83036': 'A1C blood sugar test', '81003': 'Urine test', '93000': 'Heart rhythm test (ECG)',
  '71046': 'Chest X-ray, 2 views', '76700': 'Abdominal ultrasound', '96372': 'Injection given by staff', '90686': 'Flu vaccine',
  '90471': 'Vaccine administration', 'J1100': 'Steroid injection (dexamethasone)'
};

/* ---------- Rendering ---------- */
const views = {
  cards() {
    const head = `<div class="head"><h1>Family cards</h1>${state.cards.length ? '<button class="btn primary sm" data-action="add-card">Add card</button>' : ''}</div>`;
    if (!state.cards.length) return head + empty('No cards yet', 'Scan an insurance card and CareCard reads the plan details for you.',
      '<button class="btn primary" data-action="add-card">Scan a card</button><button class="btn ghost" data-action="load-demo">Load demo family</button>');
    return head + state.cards.map(c => `
      <button class="ins-card" data-action="card-detail" data-id="${c.id}">
        <span class="payer">${esc(c.payer || 'Insurance card')}${c.plan ? `<span class="plan">${esc(c.plan)}</span>` : ''}</span>
        <span class="who">${esc(c.holder)}<small>${esc(c.relation)}</small></span>
        <span class="ids"><span>ID ${esc(c.memberId || 'not set')}</span><span>Group ${esc(c.group || 'not set')}</span></span>
      </button>`).join('');
  },
  verify() {
    const head = `<div class="head"><h1>Verify</h1>${state.proofs.length ? '<button class="btn primary sm" data-action="new-verify">New call</button>' : ''}</div>
      <p class="muted">Call the office before your visit. CareCard gives you the script and keeps a record you can use if a bill goes wrong.</p>`;
    if (!state.proofs.length) return head + empty('No calls logged yet', 'Before your next appointment, confirm the doctor takes your plan and save the proof here.',
      '<button class="btn primary" data-action="new-verify">Start a verification call</button>');
    return head + [...state.proofs].reverse().map(receiptHTML).join('');
  },
  bills() {
    const head = `<div class="head"><h1>Bills</h1>${state.bills.length ? '<button class="btn primary sm" data-action="new-bill">Check a bill</button>' : ''}</div>
      <p class="muted">Enter the bill and your insurer's EOB. CareCard compares them line by line.</p>`;
    if (!state.bills.length) return head + empty('No bills checked yet', 'When a medical bill arrives, check it against your EOB before you pay.',
      '<button class="btn primary" data-action="new-bill">Check a bill</button>');
    return head + [...state.bills].reverse().map(b => {
      const a = analyze(b);
      return `<button class="list-item" data-action="bill-detail" data-id="${b.id}">
        <h3>${esc(b.provider)}</h3><p>Service on ${fmtDate(b.serviceDate)}, ${b.items.length} line${b.items.length === 1 ? '' : 's'}</p>
        ${a.flags.length ? `<span class="pill bad">${a.flags.length} issue${a.flags.length === 1 ? '' : 's'} found</span>` : '<span class="pill ok">Matches your EOB</span>'}
      </button>`;
    }).join('');
  },
  appeals() {
    const flagged = state.bills.filter(b => analyze(b).flags.length);
    const head = `<div class="head"><h1>Appeals</h1></div><p class="muted">Letters for bills with problems, with your call proof attached.</p>`;
    if (!flagged.length) return head + empty('Nothing to dispute yet', 'When a bill check finds a problem, it shows up here with a letter ready to send.',
      '<button class="btn ghost" data-action="goto" data-tab="bills">Go to bills</button>');
    return head + flagged.map(b => {
      const d = deadline(b);
      return `<button class="list-item" data-action="letter" data-id="${b.id}">
        <h3>${esc(b.provider)}</h3><p>${analyze(b).flags.length} issue(s), service on ${fmtDate(b.serviceDate)}</p>
        <span class="pill ${d.days < 30 ? 'bad' : 'warn'}">${d.days >= 0 ? d.days + ' days left to appeal' : 'Appeal window may have passed'}</span>
      </button>`;
    }).join('');
  }
};

function empty(title, text, actions) {
  return `<div class="empty"><h2>${title}</h2><p>${text}</p><div class="row">${actions}</div></div>`;
}

function render() {
  $$('.tab').forEach(b => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
  $('#view').innerHTML = views[tab]();
  $('#view').scrollTop = 0;
}

function openSheet(html) {
  $('#sheet-body').innerHTML = html;
  $('#sheet-wrap').hidden = false;
  $('.sheet').scrollTop = 0;
  const first = $('.sheet input, .sheet select, .sheet button:not(.close)');
  if (first) setTimeout(() => first.focus({ preventScroll: true }), 50);
}
function closeSheet() { $('#sheet-wrap').hidden = true; $('#sheet-body').innerHTML = ''; }

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ---------- Cards + OCR ---------- */
const FIELDS = [['payer', 'Insurance company'], ['plan', 'Plan type'], ['memberId', 'Member ID'], ['group', 'Group number'], ['rxbin', 'RxBIN (pharmacy)']];

function fieldInputs(v = {}, missing = []) {
  return FIELDS.map(([k, label]) => {
    const miss = missing.includes(k);
    const hint = miss ? '<span class="hint"> Couldn\'t read this. Type it in.</span>' : '';
    if (k === 'plan') return `<label class="${miss ? 'missing' : ''}">${label}${hint}<select id="f-plan">
      ${['', 'PPO', 'HMO', 'EPO', 'POS', 'HDHP', 'Other'].map(o => `<option ${v.plan === o ? 'selected' : ''} value="${o}">${o || 'Choose one'}</option>`).join('')}</select></label>`;
    return `<label class="${miss ? 'missing' : ''}">${label}${hint}<input id="f-${k}" value="${esc(v[k] || '')}" autocomplete="off"></label>`;
  }).join('');
}

function addCardSheet() {
  pendingImg = null;
  openSheet(`<h2>Add a card</h2>
    <p class="muted">Take a photo of the front of the card. CareCard reads the details, and you can fix anything it misses.</p>
    <label>Card holder<input id="f-holder" placeholder="Full name"></label>
    <label>Relationship<select id="f-rel">${['Self', 'Spouse', 'Child', 'Parent', 'Other'].map(o => `<option>${o}</option>`).join('')}</select></label>
    <div class="scan">
      <label class="btn teal" style="margin:0">Scan card photo<input type="file" id="f-photo" accept="image/*" capture="environment" hidden></label>
      <button class="btn ghost" data-action="sample-card">Use sample card</button>
    </div>
    <div id="ocr" class="ocr" hidden><div class="bar"><span></span></div><p>Starting scanner…</p></div>
    <img id="f-preview" class="preview" hidden alt="Photo of the insurance card">
    <div id="fields">${fieldInputs()}</div>
    <button class="btn primary wide" data-action="save-card">Save card</button>`);
  $('#f-photo').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => runOCR(r.result); r.readAsDataURL(f);
  });
}

function shrink(src, max, q = 0.85) {
  return new Promise(res => {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / img.width), c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => res(src);
    img.src = src;
  });
}

async function runOCR(src) {
  const box = $('#ocr'), bar = $('#ocr .bar span'), msg = $('#ocr p');
  box.hidden = false; bar.style.width = '5%'; msg.textContent = 'Reading your card…';
  pendingImg = await shrink(src, 520, 0.7);
  const pv = $('#f-preview'); pv.src = pendingImg; pv.hidden = false;
  if (!window.Tesseract) { msg.textContent = 'The scanner didn\'t load. Check your internet connection, or type the details below.'; return; }
  try {
    const big = await shrink(src, 1400, 0.92);
    const { data } = await Tesseract.recognize(big, 'eng', {
      logger: m => {
        if (m.status === 'recognizing text') { bar.style.width = Math.max(15, m.progress * 100) + '%'; msg.textContent = 'Reading text on the card…'; }
        else if (/load/.test(m.status)) msg.textContent = 'Loading the scanner (first time only)…';
      }
    });
    const p = parseCard(data.text);
    const missing = FIELDS.map(f => f[0]).filter(k => !p[k]);
    if (!$('#fields')) return;
    $('#fields').innerHTML = fieldInputs(p, missing);
    if (p.holder && !$('#f-holder').value) $('#f-holder').value = p.holder;
    bar.style.width = '100%';
    const found = FIELDS.length - missing.length;
    msg.textContent = found === FIELDS.length ? 'Read all 5 fields. Check them, then save.' : `Read ${found} of 5 fields. Fill in the highlighted ones.`;
  } catch (e) {
    msg.textContent = 'The scanner couldn\'t read this photo. Try again in better light, or type the details below.';
  }
}

function titleCase(s) { return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()); }

function parseCard(text) {
  const T = text.replace(/[|]/g, ' '), flat = T.toUpperCase().replace(/[^A-Z]/g, ''), r = {};
  const payers = ['Riverstone Health', 'Blue Cross Blue Shield', 'Arkansas Blue Cross', 'Aetna', 'Cigna', 'UnitedHealthcare', 'United Healthcare',
    'Humana', 'Ambetter', 'Kaiser Permanente', 'Anthem', 'Oscar', 'Molina', 'Centene', 'Highmark', 'Medicare', 'Medicaid'];
  for (const p of payers) if (flat.includes(p.toUpperCase().replace(/[^A-Z]/g, ''))) { r.payer = p; break; }
  if (!r.payer && /BLUECROSS|BCBS/.test(flat)) r.payer = 'Blue Cross Blue Shield';
  const plan = T.toUpperCase().match(/\b(PPO|HMO|EPO|POS|HDHP)\b/); if (plan) r.plan = plan[1];
  const mid = T.match(/(?:member|subscriber|identification)\s*(?:id|#|no\.?|number)\s*[:#.]?\s*([A-Z0-9]{6,17})/i)
    || T.match(/\bID\s*[:#]\s*([A-Z0-9]{6,17})/i);
  if (mid) r.memberId = mid[1].toUpperCase();
  const grp = T.match(/(?:group|grp)\s*(?:#|no\.?|number)?\s*[:#.]?\s*([A-Z0-9][A-Z0-9-]{2,15})/i); if (grp) r.group = grp[1].toUpperCase();
  const rx = T.match(/rx\s*bin\s*[:#.]?\s*(\d{6})/i); if (rx) r.rxbin = rx[1];
  const nm = T.match(/(?:member(?:\s*name)?|name)\s*:\s*([A-Za-z]+(?:[ \t]+[A-Za-z]+){1,2})/i); if (nm) r.holder = titleCase(nm[1]);
  return r;
}

function sampleCardImage() {
  const c = document.createElement('canvas'); c.width = 1000; c.height = 630;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 1000, 630);
  g.fillStyle = '#13263A'; g.fillRect(0, 0, 1000, 130);
  g.fillStyle = '#0E9384'; g.fillRect(0, 130, 1000, 14);
  g.fillStyle = '#ffffff'; g.font = 'bold 58px Arial'; g.fillText('RIVERSTONE HEALTH', 50, 90);
  g.fillStyle = '#13263A'; g.font = 'bold 44px Arial'; g.fillText('PPO', 850, 215);
  g.font = '38px Arial';
  const rows = [['Member: ', 'ALEX MORGAN'], ['Member ID: ', 'RSH482915307'], ['Group: ', '70412AR'], ['RxBIN: ', '610014']];
  rows.forEach(([k, v], i) => { g.font = '36px Arial'; g.fillText(k, 50, 250 + i * 80); const w = g.measureText(k).width; g.font = 'bold 40px Arial'; g.fillText(v, 50 + w, 250 + i * 80); });
  g.font = '26px Arial'; g.fillStyle = '#555'; g.fillText('Sample card for demo use only', 50, 600);
  return c.toDataURL('image/png');
}

function saveCard() {
  const v = k => ($('#f-' + k)?.value || '').trim();
  const holder = v('holder');
  if (!holder) { toast('Add the card holder\'s name.'); $('#f-holder').focus(); return; }
  if (!v('payer') && !v('memberId')) { toast('Add the insurance company or member ID.'); return; }
  state.cards.push({ id: uid(), holder, relation: $('#f-rel').value, payer: v('payer'), plan: $('#f-plan').value,
    memberId: v('memberId').toUpperCase(), group: v('group').toUpperCase(), rxbin: v('rxbin'), img: pendingImg });
  save(); closeSheet(); tab = 'cards'; render(); toast('Card saved');
}

function cardDetail(id) {
  const c = cardById(id); if (!c) return;
  openSheet(`<h2>${esc(c.holder)}</h2><p class="muted">${esc(c.relation)}</p>
    ${c.img ? `<img class="photo" src="${c.img}" alt="Photo of ${esc(c.holder)}'s insurance card">` : ''}
    <div class="kv">${FIELDS.map(([k, l]) => `<div><span>${l}</span><b>${esc(c[k] || 'Not set')}</b></div>`).join('')}</div>
    <div class="row"><button class="btn primary" data-action="new-verify" data-id="${c.id}">Verify a doctor</button>
    <button class="btn danger" data-action="delete-card" data-id="${c.id}">Delete card</button></div>`);
}

/* ---------- Verify ---------- */
const cardOptions = sel => state.cards.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.holder)}, ${esc(c.payer || 'card')}</option>`).join('');

function verifySheet(cardId) {
  if (!state.cards.length) { toast('Add an insurance card first.'); tab = 'cards'; render(); return; }
  openSheet(`<h2>Verify before your visit</h2>
    <p class="muted">Enter the appointment, and CareCard writes the call script for you.</p>
    <label>Which card<select id="v-card">${cardOptions(cardId)}</select></label>
    <label>Doctor or practice<input id="v-provider" placeholder="e.g. Riverside Family Medicine"></label>
    <div class="two"><label>Office phone<input id="v-phone" type="tel" placeholder="(501) 555-0100"></label>
    <label>Appointment<input id="v-date" type="date"></label></div>
    <button class="btn primary wide" data-action="show-script">Show call script</button>`);
}

function showScript() {
  const provider = $('#v-provider').value.trim();
  if (!provider) { toast('Add the doctor or practice name.'); $('#v-provider').focus(); return; }
  verifyDraft = { cardId: $('#v-card').value, provider, phone: $('#v-phone').value.trim(), visitDate: $('#v-date').value };
  const c = cardById(verifyDraft.cardId);
  const seg = (name, opts) => `<div class="seg">${opts.map(([v, l], i) => `<label><input type="radio" name="${name}" value="${v}" ${i === 0 ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>`;
  openSheet(`<h2>Your call script</h2>
    <p class="muted">${verifyDraft.phone ? `Call ${esc(verifyDraft.phone)}. ` : ''}Read this, then record their answers below.</p>
    <div class="script">
      <p>"Hi, I have an appointment with <b>${esc(provider)}</b>${verifyDraft.visitDate ? ` on <b>${fmtDate(verifyDraft.visitDate)}</b>` : ''}. I'd like to confirm my insurance first."</p>
      <ol>
        <li>Is ${esc(provider)} in-network with <b>${esc(c.payer || 'my plan')}${c.plan ? ' ' + esc(c.plan) : ''}</b>? My member ID is <b>${esc(c.memberId || '—')}</b> and my group number is <b>${esc(c.group || '—')}</b>.</li>
        <li>What is the exact name of the network you're contracted under?</li>
        <li>Are you accepting new patients on this plan?</li>
        <li>May I have your name and a reference number for this call?</li>
      </ol>
    </div>
    <label>Are they in-network?</label>${seg('v-in', [['yes', 'Yes'], ['no', 'No'], ['unsure', 'Not sure']])}
    <label>Network name they gave<input id="v-net" placeholder="e.g. Riverstone Choice PPO"></label>
    <label>Accepting new patients?</label>${seg('v-new', [['yes', 'Yes'], ['no', 'No'], ['na', 'Not asked']])}
    <div class="two"><label>Staff name<input id="v-staff" placeholder="First name"></label>
    <label>Reference number<input id="v-ref" placeholder="If they gave one"></label></div>
    <label>Notes<textarea id="v-notes" rows="2" placeholder="Anything else they said"></textarea></label>
    <button class="btn primary wide" data-action="save-proof">Save proof</button>`);
}

function saveProof() {
  const staff = $('#v-staff').value.trim();
  if (!staff) { toast('Add the name of the person you spoke with.'); $('#v-staff').focus(); return; }
  state.proofs.push({ id: uid(), ...verifyDraft, inNetwork: $('input[name=v-in]:checked').value, networkName: $('#v-net').value.trim(),
    newPatients: $('input[name=v-new]:checked').value, staff, ref: $('#v-ref').value.trim() || 'VRF-' + Math.floor(10000 + Math.random() * 89999),
    notes: $('#v-notes').value.trim(), callAt: new Date().toISOString() });
  save(); closeSheet(); tab = 'verify'; render(); toast('Proof saved');
}

function receiptHTML(p) {
  const c = cardById(p.cardId) || {};
  const stamp = { yes: ['yes', 'In-network confirmed'], no: ['no', 'Not in-network'], unsure: ['unsure', 'Unconfirmed'] }[p.inNetwork];
  const at = new Date(p.callAt);
  return `<article class="receipt">
    <div class="rc-top"><div><h3>${esc(p.provider)}</h3><small>${esc(c.holder || 'Removed card')}, ${esc(c.payer || '')}</small></div>
    <span class="stamp ${stamp[0]}">${stamp[1]}</span></div>
    <div class="perf" aria-hidden="true"></div>
    <dl class="rc-grid">
      <dt>Called</dt><dd>${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}, ${at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</dd>
      <dt>Spoke with</dt><dd>${esc(p.staff)}</dd>
      ${p.networkName ? `<dt>Network</dt><dd>${esc(p.networkName)}</dd>` : ''}
      ${p.visitDate ? `<dt>Visit</dt><dd>${fmtDate(p.visitDate)}</dd>` : ''}
      <dt>New patients</dt><dd>${{ yes: 'Accepting', no: 'Not accepting', na: 'Not asked' }[p.newPatients]}</dd>
      <dt>Reference</dt><dd class="ref">${esc(p.ref)}</dd>
    </dl></article>`;
}

/* ---------- Bills ---------- */
function itemRow(i = {}) {
  return `<div class="item-row">
    <input class="i-code" placeholder="Code" value="${esc(i.code || '')}" aria-label="Billing code">
    <input class="i-desc" placeholder="What it was for" value="${esc(i.desc || '')}" aria-label="Description">
    <button class="x" data-action="del-row" aria-label="Remove line">×</button>
    <div class="amts"><label>Bill says you owe<input class="i-billed" inputmode="decimal" placeholder="0.00" value="${i.billed ?? ''}"></label>
    <label>EOB says you owe<input class="i-eob" inputmode="decimal" placeholder="0.00" value="${i.eob ?? ''}"></label></div>
  </div>`;
}

function billSheet() {
  if (!state.cards.length) { toast('Add an insurance card first.'); tab = 'cards'; render(); return; }
  openSheet(`<h2>Check a bill</h2>
    <p class="muted">Copy each line from the bill, and the matching amount from your EOB (the "Explanation of Benefits" from your insurer).</p>
    <button class="btn ghost wide" style="margin-top:4px" data-action="sample-bill">Fill with sample bill</button>
    <label>Which card<select id="b-card">${cardOptions()}</select></label>
    <label>Doctor or practice<input id="b-provider"></label>
    <div class="two"><label>Date of service<input id="b-date" type="date"></label><label>EOB date<input id="b-eob" type="date"></label></div>
    <label>How did the EOB process it?</label>
    <div class="seg"><label><input type="radio" name="b-net" value="in" checked><span>In-network</span></label><label><input type="radio" name="b-net" value="out"><span>Out-of-network</span></label></div>
    <label>Proof from your pre-visit call<select id="b-proof"></select></label>
    <p class="sec">Bill lines</p>
    <div id="rows">${itemRow()}</div>
    <button class="btn ghost wide" data-action="add-row">Add a line</button>
    <button class="btn primary wide" data-action="run-check">Check this bill</button>`);
  const fill = () => {
    const cid = $('#b-card').value, ps = state.proofs.filter(p => p.cardId === cid);
    $('#b-proof').innerHTML = '<option value="">No call logged</option>' + ps.map(p => `<option value="${p.id}">${esc(p.provider)}, ${esc(p.ref)}</option>`).join('');
  };
  $('#b-card').addEventListener('change', fill); fill();
  $('#rows').addEventListener('change', e => {
    if (e.target.classList.contains('i-code')) {
      const code = e.target.value.trim().toUpperCase(), d = e.target.parentElement.querySelector('.i-desc');
      e.target.value = code; if (CODES[code] && !d.value) d.value = CODES[code];
    }
  });
}

function sampleBill() {
  const alex = state.cards.find(c => /alex/i.test(c.holder)) || state.cards[0];
  $('#b-card').value = alex.id; $('#b-card').dispatchEvent(new Event('change'));
  $('#b-provider').value = 'Riverside Family Medicine';
  $('#b-date').value = daysAgo(24); $('#b-eob').value = daysAgo(10);
  $('input[name=b-net][value=out]').checked = true;
  const pr = state.proofs.find(p => p.cardId === alex.id); if (pr) $('#b-proof').value = pr.id;
  $('#rows').innerHTML = [{ code: '99214', desc: CODES['99214'], billed: 285, eob: 142.5 }, { code: '85025', desc: CODES['85025'], billed: 38, eob: 38 },
    { code: '36415', desc: CODES['36415'], billed: 18, eob: 18 }, { code: '36415', desc: CODES['36415'], billed: 18, eob: 0 }].map(itemRow).join('');
}

function runCheck() {
  const provider = $('#b-provider').value.trim();
  if (!provider) { toast('Add the doctor or practice name.'); return; }
  const items = $$('#rows .item-row').map(r => ({ code: r.querySelector('.i-code').value.trim().toUpperCase(), desc: r.querySelector('.i-desc').value.trim(),
    billed: num(r.querySelector('.i-billed').value), eob: num(r.querySelector('.i-eob').value) })).filter(i => i.code || i.desc || i.billed);
  if (!items.length) { toast('Add at least one line from the bill.'); return; }
  const b = { id: uid(), cardId: $('#b-card').value, proofId: $('#b-proof').value, provider, serviceDate: $('#b-date').value,
    eobDate: $('#b-eob').value || new Date().toISOString().slice(0, 10), eobNetwork: $('input[name=b-net]:checked').value, items };
  state.bills.push(b); save(); tab = 'bills'; render(); billDetail(b.id);
}

function analyze(b) {
  const flags = []; let savings = 0; const seen = {}, extra = new Set();
  b.items.forEach((it, i) => { if (!it.code) return; if (seen[it.code] !== undefined) extra.add(i); else seen[it.code] = i; });
  const dupCodes = [...new Set([...extra].map(i => b.items[i].code))];
  dupCodes.forEach(code => {
    const n = b.items.filter(i => i.code === code).length, amt = [...extra].filter(i => b.items[i].code === code).reduce((s, i) => s + b.items[i].billed, 0);
    savings += amt;
    flags.push({ kind: 'duplicate', code, n, amount: amt, title: `${code} is listed ${n} times`,
      text: `${plain(code, b)} appears ${n} times for the same visit. Ask the billing office to confirm it was really done ${n} times.` });
  });
  b.items.forEach((it, i) => {
    if (extra.has(i)) return;
    const diff = it.billed - it.eob;
    if (diff > 0.5) {
      savings += diff;
      flags.push({ kind: 'mismatch', code: it.code, billed: it.billed, eob: it.eob, amount: diff, title: `You're billed ${money(diff)} more than your EOB says`,
        text: `For ${plain(it.code, b, it)}, the bill asks for ${money(it.billed)}, but your EOB says you owe ${money(it.eob)}.` });
    }
  });
  const proof = proofById(b.proofId);
  if (b.eobNetwork === 'out') {
    if (proof && proof.inNetwork === 'yes') flags.unshift({ kind: 'network', title: 'Processed out-of-network, but the office confirmed in-network',
      text: `On ${new Date(proof.callAt).toLocaleDateString('en-US')}, ${proof.staff} at ${proof.provider} confirmed in-network status (reference ${proof.ref}). Ask your insurer to reprocess the claim.` });
    else flags.unshift({ kind: 'network-weak', warn: true, title: 'Processed as out-of-network',
      text: 'No verification call is on file for this visit. You can still ask your insurer to review it, but the case is stronger with proof.' });
  }
  return { flags, savings };
}
function plain(code, b, it) {
  const i = it || b.items.find(x => x.code === code) || {};
  return `${code}${i.desc || CODES[code] ? ` (${esc(i.desc || CODES[code])})` : ''}`;
}

function billDetail(id) {
  const b = billById(id); if (!b) return;
  const a = analyze(b), c = cardById(b.cardId) || {};
  const total = b.items.reduce((s, i) => s + i.billed, 0);
  openSheet(`<h2>${esc(b.provider)}</h2><p class="muted">${esc(c.holder || '')}, service on ${fmtDate(b.serviceDate)}</p>
    <div class="summary">${a.flags.length
      ? `<div class="big">${money(a.savings)}</div><p>may not be owed, out of ${money(total)} billed. ${a.flags.length} issue${a.flags.length === 1 ? '' : 's'} found.</p>`
      : `<div class="big">Looks right</div><p>This bill matches your EOB. ${money(total)} owed.</p>`}</div>
    ${a.flags.map(f => `<div class="flag ${f.warn ? 'warn' : ''}"><h3>${esc(f.title)}</h3><p>${f.text}</p></div>`).join('')}
    <p class="sec">What each line means</p>
    <div class="lines">${b.items.map(i => `<div class="line"><div><b>${esc(i.desc || CODES[i.code] || 'Unlisted service')}</b><span>Code ${esc(i.code || '—')}</span></div>
      <div style="text-align:right"><b>${money(i.billed)}</b><span>EOB ${money(i.eob)}</span></div></div>`).join('')}</div>
    <div class="row">${a.flags.length ? `<button class="btn primary" data-action="letter" data-id="${b.id}">Draft appeal letter</button>` : ''}
    <button class="btn danger" data-action="delete-bill" data-id="${b.id}">Delete</button></div>`);
}

/* ---------- Appeals ---------- */
function deadline(b) {
  const d = new Date(b.eobDate + 'T12:00'); d.setDate(d.getDate() + 180);
  return { date: d, days: Math.ceil((d - new Date()) / 86400000) };
}

function letterText(b) {
  const a = analyze(b), c = cardById(b.cardId) || {}, p = proofById(b.proofId);
  const toInsurer = a.flags.some(f => f.kind.startsWith('network'));
  const paras = a.flags.map(f => {
    if (f.kind === 'network') return `Your Explanation of Benefits processed this claim as out-of-network. Before my visit, on ${new Date(p.callAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}, I called ${p.provider} to confirm my coverage. ${p.staff} told me the provider is in-network with my plan${p.networkName ? ` under the ${p.networkName} network` : ''}. The reference number for that call is ${p.ref}. I ask that this claim be reprocessed at the in-network rate.`;
    if (f.kind === 'network-weak') return `Your Explanation of Benefits processed this claim as out-of-network. I understood this provider to be in-network with my plan, and I ask that you review the network status and reprocess the claim if it was applied in error.`;
    if (f.kind === 'duplicate') return `The bill lists ${f.code} (${b.items.find(i => i.code === f.code).desc || CODES[f.code] || 'service'}) ${f.n} times for the same date of service. Please confirm whether this service was performed more than once and remove any duplicate charge.`;
    return `For ${f.code} (${b.items.find(i => i.code === f.code)?.desc || CODES[f.code] || 'service'}), I was billed ${money(f.billed)}, but my Explanation of Benefits states my responsibility is ${money(f.eob)}. Please adjust my balance to match the EOB.`;
  });
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  return `${today}

To: ${toInsurer ? `${c.payer || 'Health plan'}, Member Appeals` : `Billing Office, ${b.provider}`}${toInsurer ? `\nCc: Billing Office, ${b.provider}` : ''}

Re: Request for review of claim
Member: ${c.holder || ''}
Member ID: ${c.memberId || ''}
Group number: ${c.group || ''}
Provider: ${b.provider}
Date of service: ${fmtDate(b.serviceDate)}
EOB date: ${fmtDate(b.eobDate)}

To whom it may concern,

I am writing to request a review of the claim listed above.

${paras.join('\n\n')}

Please send me a written response and a corrected statement. I also ask that this account not be sent to collections while the review is open.

Thank you for your help.

Sincerely,
${c.holder || ''}`;
}

function letterSheet(id) {
  const b = billById(id); if (!b) return;
  const d = deadline(b);
  openSheet(`<h2>Appeal letter</h2>
    <div class="deadline">Send by <b>${d.date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</b>. Many plans allow 180 days from the EOB date. Check your plan documents for your exact deadline.</div>
    <label>Edit before sending<textarea id="letter" class="letter">${esc(letterText(b))}</textarea></label>
    <div class="row" style="margin-top:12px"><button class="btn primary" data-action="copy-letter">Copy</button>
    <button class="btn ghost" data-action="download-letter">Download</button><button class="btn ghost" data-action="print-letter">Print</button></div>
    <p class="muted" style="margin-top:14px">This is a template to help you ask for a review. It isn't legal advice.</p>`);
}

/* ---------- Demo data ---------- */
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
function loadDemo() {
  const a = uid(), p = uid(), m = uid(), pr = uid();
  const call = new Date(); call.setDate(call.getDate() - 30); call.setHours(10, 42);
  state = {
    cards: [
      { id: a, holder: 'Alex Morgan', relation: 'Self', payer: 'Riverstone Health', plan: 'PPO', memberId: 'RSH482915307', group: '70412AR', rxbin: '610014' },
      { id: p, holder: 'Priya Morgan', relation: 'Spouse', payer: 'Riverstone Health', plan: 'PPO', memberId: 'RSH482915308', group: '70412AR', rxbin: '610014' },
      { id: m, holder: 'Maya Morgan', relation: 'Child', payer: 'Riverstone Health', plan: 'PPO', memberId: 'RSH482915309', group: '70412AR', rxbin: '610014' }],
    proofs: [{ id: pr, cardId: a, provider: 'Riverside Family Medicine', phone: '(501) 555-0142', visitDate: daysAgo(24), inNetwork: 'yes',
      networkName: 'Riverstone Choice PPO', newPatients: 'yes', staff: 'Karen', ref: 'VRF-48213', notes: '', callAt: call.toISOString() }],
    bills: [{ id: uid(), cardId: a, proofId: pr, provider: 'Riverside Family Medicine', serviceDate: daysAgo(24), eobDate: daysAgo(10), eobNetwork: 'out',
      items: [{ code: '99214', desc: CODES['99214'], billed: 285, eob: 142.5 }, { code: '85025', desc: CODES['85025'], billed: 38, eob: 38 },
        { code: '36415', desc: CODES['36415'], billed: 18, eob: 18 }, { code: '36415', desc: CODES['36415'], billed: 18, eob: 0 }] }]
  };
  save(); closeSheet(); tab = 'cards'; render(); toast('Demo family loaded');
}

/* ---------- Events ---------- */
document.addEventListener('click', async e => {
  const t = e.target.closest('[data-action], .tab'); if (!t) return;
  if (t.classList.contains('tab')) { tab = t.dataset.tab; closeSheet(); render(); return; }
  const id = t.dataset.id;
  switch (t.dataset.action) {
    case 'close-sheet': closeSheet(); break;
    case 'goto': tab = t.dataset.tab; render(); break;
    case 'add-card': addCardSheet(); break;
    case 'sample-card': runOCR(sampleCardImage()); break;
    case 'save-card': saveCard(); break;
    case 'card-detail': cardDetail(id); break;
    case 'delete-card':
      if (confirm('Delete this card? Calls and bills linked to it stay saved.')) { state.cards = state.cards.filter(c => c.id !== id); save(); closeSheet(); render(); toast('Card deleted'); }
      break;
    case 'new-verify': verifySheet(id); break;
    case 'show-script': showScript(); break;
    case 'save-proof': saveProof(); break;
    case 'new-bill': billSheet(); break;
    case 'sample-bill': sampleBill(); break;
    case 'add-row': $('#rows').insertAdjacentHTML('beforeend', itemRow()); $('#rows .item-row:last-child .i-code').focus(); break;
    case 'del-row': if ($$('#rows .item-row').length > 1) t.closest('.item-row').remove(); break;
    case 'run-check': runCheck(); break;
    case 'bill-detail': billDetail(id); break;
    case 'delete-bill': if (confirm('Delete this bill check?')) { state.bills = state.bills.filter(b => b.id !== id); save(); closeSheet(); render(); toast('Bill deleted'); } break;
    case 'letter': tab = 'appeals'; render(); letterSheet(id); break;
    case 'copy-letter':
      try { await navigator.clipboard.writeText($('#letter').value); toast('Letter copied'); }
      catch (err) { $('#letter').select(); toast('Press Ctrl+C to copy the selected letter'); }
      break;
    case 'download-letter': {
      const url = URL.createObjectURL(new Blob([$('#letter').value], { type: 'text/plain' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: 'CareCard-appeal-letter.txt' });
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Letter downloaded'); break;
    }
    case 'print-letter': {
      const w = window.open('', '_blank');
      if (!w) { toast('Allow pop-ups to print the letter.'); break; }
      w.document.write(`<title>Appeal letter</title><pre style="font:14px/1.6 Georgia,serif;white-space:pre-wrap;max-width:680px;margin:40px auto">${esc($('#letter').value)}</pre>`);
      w.document.close(); w.focus(); w.print(); break;
    }
    case 'demo-menu':
      openSheet(`<h2>Demo mode</h2><p class="muted">This prototype saves everything in this browser only. Nothing is sent to a server, except the card photo, which is read on this device.</p>
        <button class="btn primary wide" data-action="load-demo">Load demo family</button>
        <button class="btn danger wide" data-action="reset">Reset all data</button>`);
      break;
    case 'load-demo':
      if (state.cards.length && !confirm('Replace your current data with the demo family?')) break;
      loadDemo(); break;
    case 'reset':
      if (confirm('Delete all cards, calls, and bills in this browser?')) { state = { cards: [], proofs: [], bills: [] }; save(); closeSheet(); tab = 'cards'; render(); toast('All data cleared'); }
      break;
  }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet-wrap').hidden) closeSheet(); });

render();
