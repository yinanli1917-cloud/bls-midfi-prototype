/* BLS mid-fi usability test kit.
   Off by default. Turn on with ?test in the URL or Shift+T.
   Logs time on task, page path, clicks, misclicks, off-path clicks, backtracks,
   form errors and hesitations; optional screen + voice recording; post-task survey;
   results table with CSV / JSON / Markdown export. Data stays in this browser (localStorage). */
(function () {
  'use strict';

  const SESSIONS_KEY = 'bls_testkit_sessions_v1';
  const RUN_KEY = 'bls_testkit_run_v1';
  const ON_KEY = 'bls_testkit_on';
  const HESITATION_MS = 10000;
  const ORDER = { home: 0, trial: 1, classes: 2, details: 3, confirmed: 4 };
  const PAGE_NAMES = { home: 'Home', trial: 'Free Trial', classes: 'Find class', details: 'Details', confirmed: 'Confirmed' };
  const SCENARIO = 'You are a parent in Renton. Your daughter is 6 and has never taken a dance class. You want her to try one breaking class on a weekday afternoon, around 4 PM, before you pay for a season. Use this studio\'s website to book that trial.';

  const ICON = {
    person: '<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0"/>',
    child: '<path d="M12 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 4 5-2 5 2M12 11v5m-3 5 3-5 3 5"/>',
    dance: '<path d="M14 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm-6 4 4-2 3 3 4-1M12 7l-1 7 4 3 1 5M11 14l-4 4-3-1"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    card: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M4 20 20 4"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    talk: '<path d="M4 5h16v11H9l-5 4V5Z"/><path d="M8 10h8M8 13h5"/>',
    link: '<path d="M9 15 15 9M8 12l-2 2a3 3 0 0 0 4 4l2-2m4-4 2-2a3 3 0 0 0-4-4l-2 2"/><path d="M3 3l18 18"/>',
    flag: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
    pin: '<path d="M12 21s7-6 7-12a7 7 0 1 0-14 0c0 6 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/>'
  };
  const icon = (name, size) => '<svg class="tk-ico" width="' + (size || 22) + '" height="' + (size || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[name] + '</svg>';
  const FACTS = [
    { icon: 'person', k: 'You are', v: 'A parent in Renton', short: 'Parent in Renton' },
    { icon: 'child', k: 'Your child', v: 'Daughter, 6, has never taken a dance class', short: 'Daughter, 6, new to dance' },
    { icon: 'dance', k: 'You want', v: 'One breaking class for her to try', short: '1 breaking class to try' },
    { icon: 'clock', k: 'When', v: 'A weekday afternoon, around 4 PM', short: 'Weekday, ~4 PM' },
    { icon: 'card', k: 'Not yet', v: 'Don\'t pay for a whole season', short: 'No season payment yet' }
  ];
  const RULES = [
    { icon: 'eye', k: 'We test the site, not you', v: 'There are no wrong answers.' },
    { icon: 'talk', k: 'Think out loud', v: 'Say what you look for and what you expect.' },
    { icon: 'link', k: 'Some links aren\'t built', v: 'A small note says so. Try another way.' },
    { icon: 'flag', k: 'Say when you\'re done', v: 'Press I\'m done in the black bar at the top.' }
  ];

  const params = new URLSearchParams(location.search);
  let enabled = params.has('test') || sessionStorage.getItem(ON_KEY) === '1';

  let run = null;          // the session in progress
  let rec = null;          // { recorder, chunks, streams, startedAt }
  let lastActivity = 0;
  let lastErrorCount = 0;
  let tickTimer = null;
  let root = null;

  /* ---------- helpers ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const now = () => Date.now();
  const route = () => (location.hash || '#home').replace('#', '') || 'home';
  const mmss = ms => { const s = Math.max(0, Math.round(ms / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  const loadSessions = () => { try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]'); } catch (e) { return []; } };
  const saveSessions = list => localStorage.setItem(SESSIONS_KEY, JSON.stringify(list));
  const saveRun = () => { if (run) sessionStorage.setItem(RUN_KEY, JSON.stringify(run)); else sessionStorage.removeItem(RUN_KEY); };
  const median = a => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); const m = Math.floor(b.length / 2); return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  const download = (name, blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); };
  const stamp = () => { const d = new Date(); return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0'); };

  function log(type, detail) {
    if (!run || run.endedAt) return;
    run.events.push({ t: now() - run.startedAt, type: type, page: route(), detail: detail || '' });
    saveRun();
  }

  /* ---------- styles ---------- */
  function injectStyles() {
    if (document.getElementById('tk-style')) return;
    const css = `
.tk-root{position:fixed;inset:0;pointer-events:none;z-index:2147483000;font-family:system-ui,-apple-system,sans-serif;font-size:15px;line-height:1.45;color:#111}
.tk-root *{box-sizing:border-box}
.tk-bar{pointer-events:auto;position:fixed;left:16px;bottom:16px;display:flex;gap:6px;align-items:center;background:#111;color:#fff;border-radius:999px;padding:6px 6px 6px 14px;box-shadow:0 4px 16px rgba(0,0,0,.25)}
.tk-bar .tk-label{font-weight:600;font-size:13px;letter-spacing:.02em;margin-right:4px}
.tk-bar button{font:inherit;font-size:13px;border:0;border-radius:999px;padding:6px 12px;cursor:pointer;background:#333;color:#fff}
.tk-bar button.tk-primary{background:#fff;color:#111;font-weight:600}
.tk-bar .tk-time{font-variant-numeric:tabular-nums;font-weight:600;font-size:13px}
.tk-dot{width:9px;height:9px;border-radius:50%;background:#fff;display:inline-block;margin-right:6px;animation:tkpulse 1.2s infinite}
@keyframes tkpulse{50%{opacity:.25}}
.tk-veil{pointer-events:auto;position:fixed;inset:0;background:rgba(17,17,17,.55);display:flex;align-items:center;justify-content:center;padding:24px}
.tk-card{background:#fff;border-radius:14px;max-width:640px;width:100%;max-height:calc(100vh - 48px);overflow:auto;padding:28px 32px;box-shadow:0 12px 40px rgba(0,0,0,.3)}
.tk-card.tk-wide{max-width:1080px}
.tk-card h2{font-size:24px;margin:0 0 6px;letter-spacing:-.01em}
.tk-card h3{font-size:16px;margin:20px 0 8px}
.tk-sub{color:#555;margin:0 0 16px}
.tk-task{border:2px solid #111;border-radius:10px;padding:16px 18px;font-size:17px;margin:14px 0 18px}
.tk-card label.tk-field{display:block;font-weight:600;margin:14px 0 6px}
.tk-card input[type=text],.tk-card textarea{width:100%;font:inherit;padding:9px 11px;border:1px solid #888;border-radius:8px}
.tk-card textarea{min-height:56px;resize:vertical}
.tk-check{display:flex;gap:10px;align-items:flex-start;margin:10px 0;font-weight:400}
.tk-check input{margin-top:4px;width:18px;height:18px;accent-color:#111}
.tk-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}
.tk-btn{font:inherit;font-weight:600;border-radius:8px;padding:10px 18px;cursor:pointer;border:1.5px solid #111;background:#fff;color:#111}
.tk-btn.tk-primary{background:#111;color:#fff}
.tk-btn:disabled{opacity:.4;cursor:not-allowed}
.tk-scale{display:flex;gap:6px;flex-wrap:wrap}
.tk-scale button{font:inherit;min-width:44px;padding:8px 10px;border:1.5px solid #111;border-radius:8px;background:#fff;cursor:pointer}
.tk-scale button[aria-pressed=true]{background:#111;color:#fff}
.tk-ends{display:flex;justify-content:space-between;color:#555;font-size:13px;margin-top:4px;max-width:420px}
.tk-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0}
.tk-stat{border:1px solid #bbb;border-radius:10px;padding:12px 14px}
.tk-stat b{display:block;font-size:24px}
.tk-stat span{color:#555;font-size:13px}
.tk-table{width:100%;border-collapse:collapse;font-size:13px}
.tk-table th,.tk-table td{border-bottom:1px solid #ddd;padding:7px 6px;text-align:left;vertical-align:top}
.tk-table th{font-size:12px;color:#444;text-transform:uppercase;letter-spacing:.03em}
.tk-table tr.tk-row{cursor:pointer}
.tk-table tr.tk-row:hover td{background:#f3f3f3}
.tk-timeline{font-size:13px;font-family:ui-monospace,Menlo,monospace;background:#f5f5f5;border-radius:8px;padding:10px 12px;max-height:260px;overflow:auto;white-space:pre-wrap}
.tk-note{pointer-events:auto;position:fixed;right:16px;top:calc(var(--tk-h,52px) + 10px);background:#111;color:#fff;border-radius:12px;padding:10px;display:flex;gap:6px;width:min(460px,calc(100vw - 32px))}
.tk-note input{flex:1;font:inherit;border:0;border-radius:6px;padding:7px 9px}
.tk-note button{font:inherit;border:0;border-radius:6px;padding:7px 12px;background:#fff;color:#111;font-weight:600;cursor:pointer}
.tk-small{font-size:13px;color:#555}
.tk-ico{flex:none}
.tk-eyebrow{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#555;margin:0 0 6px}
.tk-lead{font-size:20px;line-height:1.35;font-weight:600;margin:0 0 16px;letter-spacing:-.01em}
.tk-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:0 0 22px}
.tk-fact{border:2px solid #111;border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:6px}
.tk-fact .tk-k{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#555}
.tk-fact .tk-v{font-size:16px;font-weight:600;line-height:1.3}
.tk-rules{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.tk-rule{background:#f3f3f3;border-radius:12px;padding:12px 14px;display:flex;gap:10px;align-items:flex-start}
.tk-rule b{display:block;font-size:15px}
.tk-rule span{font-size:14px;color:#444}
.tk-strip{pointer-events:auto;position:fixed;top:0;left:0;right:0;background:#111;color:#fff;z-index:2147483001;box-shadow:0 2px 10px rgba(0,0,0,.25)}
.tk-strip-row{display:flex;align-items:center;gap:12px;padding:8px 14px;flex-wrap:wrap}
.tk-strip .tk-status{display:flex;align-items:center;gap:8px;font-weight:700;font-size:13px;letter-spacing:.04em;white-space:nowrap}
.tk-strip .tk-time{font-variant-numeric:tabular-nums}
.tk-strip .tk-goal{display:flex;align-items:center;gap:6px;flex:1;min-width:240px;flex-wrap:wrap}
.tk-strip .tk-goal-label{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#bbb;margin-right:2px}
.tk-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid #666;border-radius:999px;padding:4px 10px 4px 8px;font-size:13px;font-weight:600;white-space:nowrap}
.tk-strip .tk-ctrls{display:flex;gap:6px;margin-left:auto}
.tk-strip button{font:inherit;font-size:13px;border:0;border-radius:999px;padding:7px 13px;cursor:pointer;background:#333;color:#fff;white-space:nowrap}
.tk-strip button.tk-primary{background:#fff;color:#111;font-weight:700}
.tk-strip-more{border-top:1px solid #333;padding:10px 14px 12px;font-size:15px;line-height:1.45;display:none}
.tk-strip.tk-open .tk-strip-more{display:block}
.tk-strip-more p{margin:0 0 6px;max-width:900px}
html.tk-running body{padding-top:var(--tk-h,52px)}
html.tk-running .site-header{top:var(--tk-h,52px)}
@media (max-width:640px){.tk-strip .tk-goal-label{display:none}.tk-chip{font-size:12px}}
`;
    const st = document.createElement('style'); st.id = 'tk-style'; st.textContent = css; document.head.appendChild(st);
  }

  /* ---------- UI shell ---------- */
  function ensureRoot() {
    if (root) return root;
    injectStyles();
    root = document.createElement('div');
    root.className = 'tk-root';
    root.setAttribute('data-tk', '1');
    document.body.appendChild(root);
    return root;
  }
  let stripObserver = null;
  function clearUI() {
    if (root) root.innerHTML = '';
    document.documentElement.classList.remove('tk-running');
    if (stripObserver) { stripObserver.disconnect(); stripObserver = null; }
  }

  function renderIdleBar() {
    ensureRoot(); clearUI();
    if (!enabled) return;
    const n = loadSessions().length;
    root.innerHTML = '<div class="tk-bar" role="toolbar" aria-label="Test kit">' +
      '<span class="tk-label">TEST KIT</span>' +
      '<button type="button" class="tk-primary" data-a="new">New session</button>' +
      '<button type="button" data-a="results">Results (' + n + ')</button>' +
      '<button type="button" data-a="hide" aria-label="Hide test kit">Hide</button></div>';
    root.querySelector('[data-a=new]').onclick = renderSetup;
    root.querySelector('[data-a=results]').onclick = renderResults;
    root.querySelector('[data-a=hide]').onclick = () => { setEnabled(false); };
  }

  function renderRunBar() {
    ensureRoot(); clearUI();
    root.innerHTML = '<div class="tk-strip" role="region" aria-label="Your task">' +
      '<div class="tk-strip-row">' +
        '<div class="tk-status">' + (rec ? '<span class="tk-dot" aria-hidden="true"></span>REC' : 'TASK') + ' <span class="tk-time" id="tk-time">00:00</span></div>' +
        '<div class="tk-goal"><span class="tk-goal-label">Your task</span>' +
          FACTS.slice(1).map(f => '<span class="tk-chip">' + icon(f.icon, 16) + esc(f.short) + '</span>').join('') +
        '</div>' +
        '<div class="tk-ctrls">' +
          '<button type="button" data-a="more" aria-expanded="false">Full task</button>' +
          '<button type="button" data-a="note" aria-label="Add facilitator note (Shift+N)">Note</button>' +
          '<button type="button" class="tk-primary" data-a="done">I\'m done</button>' +
          '<button type="button" data-a="giveup">Give up</button>' +
        '</div>' +
      '</div>' +
      '<div class="tk-strip-more" id="tk-more"><p>' + esc(SCENARIO) + '</p></div>' +
    '</div>';
    const strip = root.querySelector('.tk-strip');
    const setH = () => document.documentElement.style.setProperty('--tk-h', strip.offsetHeight + 'px');
    document.documentElement.classList.add('tk-running');
    setH();
    if (window.ResizeObserver) { stripObserver = new ResizeObserver(setH); stripObserver.observe(strip); }
    root.querySelector('[data-a=more]').onclick = e => {
      const open = strip.classList.toggle('tk-open');
      e.currentTarget.setAttribute('aria-expanded', open ? 'true' : 'false');
      e.currentTarget.textContent = open ? 'Hide task' : 'Full task';
    };
    root.querySelector('[data-a=done]').onclick = () => finishTask(run && run.reached ? 'claimed-done' : 'claimed-done-not-reached');
    root.querySelector('[data-a=giveup]').onclick = () => finishTask('gave-up');
    root.querySelector('[data-a=note]').onclick = openNote;
    tick();
  }

  function openNote() {
    if (!run || root.querySelector('.tk-note')) return;
    const box = document.createElement('div');
    box.className = 'tk-note';
    box.innerHTML = '<input type="text" aria-label="Facilitator note" placeholder="Note (time-stamped), Enter to save"><button type="button">Save</button>';
    root.appendChild(box);
    const inp = box.querySelector('input');
    const save = () => { const v = inp.value.trim(); if (v) { log('note', v); run.notes.push({ t: now() - run.startedAt, page: route(), text: v }); saveRun(); } box.remove(); };
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') box.remove(); e.stopPropagation(); });
    box.querySelector('button').onclick = save;
    inp.focus();
  }

  /* ---------- screens ---------- */
  function modal(html, wide) {
    ensureRoot(); clearUI();
    root.innerHTML = '<div class="tk-veil"><div class="tk-card' + (wide ? ' tk-wide' : '') + '" role="dialog" aria-modal="true">' + html + '</div></div>';
    const first = root.querySelector('input,button,textarea');
    if (first) setTimeout(() => first.focus(), 30);
    return root.querySelector('.tk-card');
  }

  function renderSetup() {
    const n = loadSessions().length + 1;
    const card = modal(
      '<h2>New test session</h2><p class="tk-sub">Facilitator setup. The tester sees the next screen.</p>' +
      '<label class="tk-field" for="tk-name">Tester</label><input id="tk-name" type="text" value="Tester ' + n + '">' +
      '<label class="tk-check"><input type="checkbox" id="tk-consent"> <span>I asked the tester, and they agreed to be observed and to have notes taken.</span></label>' +
      '<label class="tk-check"><input type="checkbox" id="tk-rec"> <span>Record screen and voice (also ask for this). Chrome will ask what to share: choose <b>this tab</b>, then allow the microphone. The video downloads when the session ends.</span></label>' +
      '<div class="tk-actions"><button type="button" class="tk-btn tk-primary" id="tk-go" disabled>Show task to tester</button><button type="button" class="tk-btn" id="tk-cancel">Cancel</button></div>');
    const consent = card.querySelector('#tk-consent');
    const go = card.querySelector('#tk-go');
    consent.onchange = () => { go.disabled = !consent.checked; };
    card.querySelector('#tk-cancel').onclick = renderIdleBar;
    go.onclick = () => renderBriefing(card.querySelector('#tk-name').value.trim() || ('Tester ' + n), card.querySelector('#tk-rec').checked);
  }

  function renderBriefing(tester, wantRec) {
    const card = modal(
      '<p class="tk-eyebrow">Your task</p>' +
      '<p class="tk-lead">Book your daughter one breaking class to try, on a weekday afternoon, before you pay for a season.</p>' +
      '<div class="tk-facts">' + FACTS.map(f => '<div class="tk-fact">' + icon(f.icon) + '<span class="tk-k">' + esc(f.k) + '</span><span class="tk-v">' + esc(f.v) + '</span></div>').join('') + '</div>' +
      '<p class="tk-eyebrow">How this works</p>' +
      '<div class="tk-rules">' + RULES.map(r => '<div class="tk-rule">' + icon(r.icon) + '<div><b>' + esc(r.k) + '</b><span>' + esc(r.v) + '</span></div></div>').join('') + '</div>' +
      '<p class="tk-small" style="margin-top:14px">' + icon('pin', 16) + ' Your task stays pinned at the top of the screen the whole time.</p>' +
      '<div class="tk-actions"><button type="button" class="tk-btn tk-primary" id="tk-start">Start task</button></div>' +
      '<p class="tk-small" id="tk-recmsg"></p>', true);
    card.querySelector('#tk-start').onclick = async () => {
      const btn = card.querySelector('#tk-start');
      btn.disabled = true;
      let recOk = false;
      if (wantRec) {
        card.querySelector('#tk-recmsg').textContent = 'Starting the recording…';
        recOk = await startRecording();
        if (!recOk) card.querySelector('#tk-recmsg').textContent = 'Recording did not start; the task runs without it.';
      }
      startTask(tester, recOk, wantRec);
    };
  }

  function startTask(tester, recOk, wantRec) {
    if (window.__proto) window.__proto.reset(); else location.hash = '#home';
    run = {
      id: 's' + now(), tester: tester, date: new Date().toISOString(),
      startedAt: now(), endedAt: null, recording: recOk ? 'yes' : (wantRec ? 'failed' : 'no'),
      recStartOffsetMs: rec ? rec.startedAt - now() : null,
      events: [], notes: [], reached: false, result: null, classBooked: '', survey: null,
      viewport: innerWidth + 'x' + innerHeight
    };
    lastActivity = now();
    lastErrorCount = 0;
    log('start', tester);
    run.events.push({ t: 0, type: 'page', page: 'home', detail: 'home' });
    lastPage = 'home';
    saveRun();
    renderRunBar();
  }

  function finishTask(how) {
    if (!run || run.endedAt) return;
    flushHesitation();
    const st = window.__proto ? window.__proto.getState() : {};
    const cls = window.__proto && st.selectedClassId ? window.__proto.getClass(st.selectedClassId) : null;
    run.classBooked = run.reached && cls ? (cls.name + ', ' + cls.day + ' ' + cls.time + (st.selectedDate ? ', ' + st.selectedDate : '')) : '';
    if (run.reached) {
      const right = cls && /Breaking/i.test(cls.name) && cls.weekday >= 1 && cls.weekday <= 5;
      run.result = right ? 'success' : 'completed-other-class';
    } else {
      run.result = how === 'gave-up' ? 'gave-up' : 'not-completed';
    }
    log('end', how);
    run.endedAt = now();
    saveRun();
    stopTick();
    renderSurvey();
  }

  function renderSurvey() {
    const answers = { seq: null, conf: null, cost: '' };
    const scale = (id, n) => '<div class="tk-scale" data-scale="' + id + '">' + Array.from({ length: n }, (_, i) => '<button type="button" aria-pressed="false" data-v="' + (i + 1) + '">' + (i + 1) + '</button>').join('') + '</div>';
    const card = modal(
      '<h2>' + (run.result === 'success' ? 'Task complete' : 'Thanks, that\'s the end of the task') + '</h2>' +
      '<p class="tk-sub">' + esc(run.tester) + ' · ' + mmss(run.endedAt - run.startedAt) + ' · a few quick questions.</p>' +
      '<h3>1. Overall, how easy or difficult was this task?</h3>' + scale('seq', 7) + '<div class="tk-ends"><span>1 Very difficult</span><span>7 Very easy</span></div>' +
      '<h3>2. How sure are you that the trial is booked?</h3>' + scale('conf', 5) + '<div class="tk-ends"><span>1 Not sure at all</span><span>5 Completely sure</span></div>' +
      '<h3>3. What does the trial cost, and did you need a card?</h3>' +
      ['Free, no card', 'Free, but a card was needed', 'It costs money', 'Not sure'].map(o => '<label class="tk-check"><input type="radio" name="tk-cost" value="' + esc(o) + '"> <span>' + esc(o) + '</span></label>').join('') +
      '<p class="tk-small">Facilitator: ask the next three out loud and type the gist.</p>' +
      '<label class="tk-field" for="tk-q4">4. Where did you hesitate, and what were you looking for?</label><textarea id="tk-q4"></textarea>' +
      '<label class="tk-field" for="tk-q5">5. Before you clicked "Book free trial", what did you expect would happen?</label><textarea id="tk-q5"></textarea>' +
      '<label class="tk-field" for="tk-q6">6. If you could change one thing, what would it be?</label><textarea id="tk-q6"></textarea>' +
      '<div class="tk-actions"><button type="button" class="tk-btn tk-primary" id="tk-save">Save session</button></div>', false);
    card.querySelectorAll('[data-scale]').forEach(group => {
      group.querySelectorAll('button').forEach(b => b.onclick = () => {
        group.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true');
        answers[group.getAttribute('data-scale')] = Number(b.getAttribute('data-v'));
      });
    });
    card.querySelectorAll('input[name=tk-cost]').forEach(r => r.onchange = () => { answers.cost = r.value; });
    card.querySelector('#tk-save').onclick = async () => {
      run.survey = { seq: answers.seq, confidence: answers.conf, cost: answers.cost, hesitate: card.querySelector('#tk-q4').value.trim(), expected: card.querySelector('#tk-q5').value.trim(), change: card.querySelector('#tk-q6').value.trim() };
      const recName = await stopRecording(run.tester);
      if (recName) run.recordingFile = recName;
      const list = loadSessions(); list.push(run); saveSessions(list);
      const done = run; run = null; saveRun();
      if (window.__proto) window.__proto.reset();
      renderSessionDone(done);
    };
  }

  function renderSessionDone(s) {
    const m = metrics(s);
    const card = modal('<h2>Session saved</h2><p class="tk-sub">' + esc(s.tester) + ' · ' + esc(labelResult(s.result)) + '</p>' + statsHtml([
      [mmss(m.time), 'time on task'], [m.misclicks, 'misclicks'], [m.offpath, 'off-path clicks'], [m.hesitations, 'hesitations ≥10 s'], [m.backtracks, 'backtracks'], [s.survey && s.survey.seq ? s.survey.seq + '/7' : 'n/a', 'ease (SEQ)']
    ]) + (s.recordingFile ? '<p class="tk-small">Recording downloaded as ' + esc(s.recordingFile) + '.</p>' : '') +
      '<div class="tk-actions"><button type="button" class="tk-btn tk-primary" id="tk-next">Next tester</button><button type="button" class="tk-btn" id="tk-res">All results</button><button type="button" class="tk-btn" id="tk-close">Close</button></div>');
    card.querySelector('#tk-next').onclick = renderSetup;
    card.querySelector('#tk-res').onclick = renderResults;
    card.querySelector('#tk-close').onclick = renderIdleBar;
  }

  /* ---------- metrics and results ---------- */
  function metrics(s) {
    const ev = s.events || [];
    const count = t => ev.filter(e => e.type === t).length;
    const pages = ev.filter(e => e.type === 'page').map(e => e.detail);
    const hes = ev.filter(e => e.type === 'hesitation');
    const time = (s.endedAt || now()) - s.startedAt;
    const firstReach = ev.find(e => e.type === 'reached');
    return {
      time: time, timeToConfirm: firstReach ? firstReach.t : null,
      clicks: count('click') + count('misclick') + count('offpath'), misclicks: count('misclick'), offpath: count('offpath'),
      backtracks: count('backtrack'), formErrors: count('formerror'), hesitations: hes.length,
      longestHes: hes.reduce((a, e) => Math.max(a, e.dur || 0), 0),
      hesPages: hes.map(e => PAGE_NAMES[e.page] || e.page),
      path: pages.map(p => PAGE_NAMES[p] || p).join(' > ')
    };
  }
  const labelResult = r => ({ 'success': 'Success', 'completed-other-class': 'Booked, other class', 'gave-up': 'Gave up', 'not-completed': 'Not completed' }[r] || r || 'n/a');
  const statsHtml = items => '<div class="tk-stats">' + items.map(i => '<div class="tk-stat"><b>' + esc(i[0]) + '</b><span>' + esc(i[1]) + '</span></div>').join('') + '</div>';

  function timelineText(s) {
    return (s.events || []).map(e => {
      const what = {
        start: 'Task started', page: 'Page: ' + (PAGE_NAMES[e.detail] || e.detail), click: 'Click "' + e.detail + '"',
        misclick: 'Misclick on ' + e.detail, offpath: 'Off-path click "' + e.detail + '"', backtrack: 'Went back to ' + (PAGE_NAMES[e.detail] || e.detail),
        formerror: 'Form error: ' + e.detail, hesitation: 'Hesitated ' + Math.round((e.dur || 0) / 1000) + ' s', note: 'NOTE: ' + e.detail,
        reached: 'Reached confirmation', end: 'Ended (' + e.detail + ')', reload: 'Page reloaded', recording: 'Recording: ' + e.detail
      }[e.type] || (e.type + ' ' + e.detail);
      return mmss(e.t) + '  [' + (PAGE_NAMES[e.page] || e.page) + ']  ' + what;
    }).join('\n');
  }

  function renderResults() {
    const list = loadSessions();
    const ms = list.map(metrics);
    const succ = list.filter(s => s.result === 'success').length;
    const seqs = list.map(s => s.survey && s.survey.seq).filter(Boolean);
    const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length) : null;
    const card = modal(
      '<h2>Results</h2><p class="tk-sub">' + list.length + ' session' + (list.length === 1 ? '' : 's') + ' saved in this browser. Click a row for its timeline.</p>' +
      statsHtml([
        [list.length ? Math.round(100 * succ / list.length) + '%' : 'n/a', 'task success (' + succ + '/' + list.length + ')'],
        [list.length ? mmss(median(ms.map(m => m.time))) : 'n/a', 'median time on task'],
        [seqs.length ? avg(seqs).toFixed(1) + '/7' : 'n/a', 'average ease (SEQ)'],
        [list.length ? avg(ms.map(m => m.misclicks)).toFixed(1) : 'n/a', 'misclicks per tester'],
        [list.length ? avg(ms.map(m => m.hesitations)).toFixed(1) : 'n/a', 'hesitations per tester']
      ]) +
      '<div style="overflow:auto"><table class="tk-table"><thead><tr><th>Tester</th><th>Result</th><th>Time</th><th>Path</th><th>Misclicks</th><th>Off-path</th><th>Hesitations</th><th>Form errors</th><th>SEQ</th><th>Sure</th><th>Cost answer</th></tr></thead><tbody>' +
      list.map((s, i) => { const m = ms[i]; return '<tr class="tk-row" data-i="' + i + '"><td>' + esc(s.tester) + '</td><td>' + esc(labelResult(s.result)) + '</td><td>' + mmss(m.time) + '</td><td>' + esc(m.path) + '</td><td>' + m.misclicks + '</td><td>' + m.offpath + '</td><td>' + m.hesitations + (m.hesitations ? ' (' + esc(m.hesPages.join(', ')) + ')' : '') + '</td><td>' + m.formErrors + '</td><td>' + esc(s.survey && s.survey.seq || '') + '</td><td>' + esc(s.survey && s.survey.confidence || '') + '</td><td>' + esc(s.survey && s.survey.cost || '') + '</td></tr>'; }).join('') +
      '</tbody></table></div><div id="tk-detail"></div>' +
      '<div class="tk-actions"><button type="button" class="tk-btn tk-primary" id="tk-csv">Export CSV</button><button type="button" class="tk-btn" id="tk-md">Copy summary</button><button type="button" class="tk-btn" id="tk-json">Export JSON</button><button type="button" class="tk-btn" id="tk-new">New session</button><button type="button" class="tk-btn" id="tk-close">Close</button><button type="button" class="tk-btn" id="tk-clear" style="margin-left:auto">Delete all</button></div>', true);
    card.querySelectorAll('tr.tk-row').forEach(tr => tr.onclick = () => {
      const s = list[Number(tr.getAttribute('data-i'))];
      const sv = s.survey || {};
      card.querySelector('#tk-detail').innerHTML = '<h3>' + esc(s.tester) + ' · timeline</h3><div class="tk-timeline">' + esc(timelineText(s)) + '</div>' +
        '<p class="tk-small">Booked: ' + esc(s.classBooked || 'nothing') + ' · Recording: ' + esc(s.recordingFile || s.recording) + '</p>' +
        '<p><b>Hesitated / looked for:</b> ' + esc(sv.hesitate || '-') + '<br><b>Expected after Book:</b> ' + esc(sv.expected || '-') + '<br><b>One change:</b> ' + esc(sv.change || '-') + '</p>';
    });
    card.querySelector('#tk-csv').onclick = () => download('BLS-usability-results-' + stamp() + '.csv', new Blob([toCSV(list)], { type: 'text/csv' }));
    card.querySelector('#tk-json').onclick = () => download('BLS-usability-results-' + stamp() + '.json', new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' }));
    card.querySelector('#tk-md').onclick = async () => {
      const md = toMarkdown(list);
      try { await navigator.clipboard.writeText(md); card.querySelector('#tk-md').textContent = 'Copied'; }
      catch (e) { download('BLS-usability-summary-' + stamp() + '.md', new Blob([md], { type: 'text/markdown' })); }
    };
    card.querySelector('#tk-new').onclick = renderSetup;
    card.querySelector('#tk-close').onclick = renderIdleBar;
    card.querySelector('#tk-clear').onclick = () => { if (confirm('Delete all ' + list.length + ' saved sessions from this browser? Export first if you need them.')) { saveSessions([]); renderResults(); } };
  }

  function toCSV(list) {
    const cols = ['tester', 'date', 'result', 'time_on_task_s', 'time_to_confirmation_s', 'path', 'clicks', 'misclicks', 'offpath_clicks', 'backtracks', 'form_errors', 'hesitations', 'longest_hesitation_s', 'hesitation_pages', 'seq_1to7', 'confidence_1to5', 'cost_answer', 'hesitated_where', 'expected_after_book', 'one_change', 'notes', 'class_booked', 'recording', 'viewport'];
    const q = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const rows = list.map(s => {
      const m = metrics(s); const sv = s.survey || {};
      return [s.tester, s.date, s.result, Math.round(m.time / 1000), m.timeToConfirm == null ? '' : Math.round(m.timeToConfirm / 1000), m.path, m.clicks, m.misclicks, m.offpath, m.backtracks, m.formErrors, m.hesitations, Math.round(m.longestHes / 1000), m.hesPages.join('; '), sv.seq, sv.confidence, sv.cost, sv.hesitate, sv.expected, sv.change, (s.notes || []).map(n => mmss(n.t) + ' ' + n.text).join(' | '), s.classBooked, s.recordingFile || s.recording, s.viewport].map(q).join(',');
    });
    return cols.join(',') + '\n' + rows.join('\n') + '\n';
  }

  function toMarkdown(list) {
    const ms = list.map(metrics);
    const succ = list.filter(s => s.result === 'success').length;
    const seqs = list.map(s => s.survey && s.survey.seq).filter(Boolean);
    let md = '# Mid-fi usability test: Body Language Studio free trial\n\n';
    md += '- Task: ' + SCENARIO + '\n- Testers: ' + list.length + '\n- Task success: ' + succ + '/' + list.length + '\n';
    if (list.length) md += '- Median time on task: ' + mmss(median(ms.map(m => m.time))) + '\n';
    if (seqs.length) md += '- Average ease (SEQ, 1-7): ' + (seqs.reduce((a, b) => a + b, 0) / seqs.length).toFixed(1) + '\n';
    md += '\n| Tester | Result | Time | Misclicks | Off-path | Hesitations | SEQ | Sure | Cost answer |\n|---|---|---|---|---|---|---|---|---|\n';
    list.forEach((s, i) => { const m = ms[i]; const sv = s.survey || {}; md += '| ' + [s.tester, labelResult(s.result), mmss(m.time), m.misclicks, m.offpath, m.hesitations + (m.hesitations ? ' (' + m.hesPages.join(', ') + ')' : ''), sv.seq || '', sv.confidence || '', sv.cost || ''].join(' | ') + ' |\n'; });
    md += '\n## What testers said\n';
    list.forEach(s => { const sv = s.survey || {}; md += '\n**' + s.tester + '**\n- Hesitated: ' + (sv.hesitate || '-') + '\n- Expected after Book: ' + (sv.expected || '-') + '\n- One change: ' + (sv.change || '-') + '\n' + ((s.notes || []).length ? '- Notes: ' + s.notes.map(n => mmss(n.t) + ' ' + n.text).join('; ') + '\n' : ''); });
    return md;
  }

  /* ---------- recording ---------- */
  async function startRecording() {
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser', frameRate: 15 }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include' });
      let mic = null;
      try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch (e) { mic = null; }
      const tracks = screen.getVideoTracks().concat(mic ? mic.getAudioTracks() : []);
      const stream = new MediaStream(tracks);
      const types = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
      const mime = types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      recorder.start(1000);
      rec = { recorder: recorder, chunks: chunks, streams: [screen, mic].filter(Boolean), startedAt: now(), mime: recorder.mimeType || mime, mic: !!mic };
      screen.getVideoTracks()[0].addEventListener('ended', () => { log('recording', 'screen share stopped'); });
      return true;
    } catch (e) {
      rec = null;
      return false;
    }
  }

  function stopRecording(tester) {
    return new Promise(resolve => {
      if (!rec) return resolve(null);
      const r = rec; rec = null;
      const finish = () => {
        r.streams.forEach(s => s.getTracks().forEach(t => t.stop()));
        if (!r.chunks.length) return resolve(null);
        const ext = /mp4/.test(r.mime) ? 'mp4' : 'webm';
        const name = 'BLS-test-' + tester.replace(/[^a-z0-9]+/gi, '-') + '-' + stamp() + '.' + ext;
        download(name, new Blob(r.chunks, { type: r.mime || 'video/webm' }));
        resolve(name);
      };
      if (r.recorder.state === 'inactive') return finish();
      r.recorder.onstop = finish;
      r.recorder.stop();
    });
  }

  /* ---------- passive logging ---------- */
  function flushHesitation() {
    if (!run || run.endedAt) return;
    const idle = now() - lastActivity;
    if (idle >= HESITATION_MS) {
      run.events.push({ t: lastActivity - run.startedAt, type: 'hesitation', page: route(), detail: '', dur: idle });
      saveRun();
    }
  }
  function activity() { if (!run || run.endedAt) return; flushHesitation(); lastActivity = now(); }

  function tick() {
    stopTick();
    tickTimer = setInterval(() => {
      const el = document.getElementById('tk-time');
      if (el && run) el.textContent = mmss(now() - run.startedAt);
    }, 500);
  }
  function stopTick() { if (tickTimer) clearInterval(tickTimer); tickTimer = null; }

  const INTERACTIVE = 'a,button,input,select,textarea,label,summary,[role=button],[role=menuitem],[tabindex]:not([tabindex="-1"])';
  function labelOf(el) {
    const t = (el.getAttribute('aria-label') || el.textContent || el.value || el.placeholder || el.name || el.tagName).replace(/\s+/g, ' ').trim();
    return t.slice(0, 50);
  }

  document.addEventListener('click', e => {
    if (!run || run.endedAt) return;
    if (e.target.closest && e.target.closest('[data-tk]')) return;
    activity();
    const hit = e.target.closest ? e.target.closest(INTERACTIVE) : null;
    if (!hit) {
      const desc = (e.target.className && typeof e.target.className === 'string' ? e.target.tagName.toLowerCase() + '.' + e.target.className.split(' ')[0] : e.target.tagName.toLowerCase());
      const txt = (e.target.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30);
      log('misclick', desc + (txt ? ' "' + txt + '"' : ''));
    } else if (hit.hasAttribute('data-proto-toast')) {
      log('offpath', labelOf(hit));
    } else {
      log('click', labelOf(hit));
    }
  }, true);
  ['keydown', 'input', 'scroll', 'change'].forEach(type => document.addEventListener(type, e => {
    if (e.target && e.target.closest && e.target.closest('[data-tk]')) return;
    activity();
  }, { capture: true, passive: true }));

  let lastPage = null;
  window.addEventListener('hashchange', () => {
    if (!run || run.endedAt) return;
    activity();
    const p = route();
    if (p === lastPage) return;
    if (lastPage && ORDER[p] != null && ORDER[lastPage] != null && ORDER[p] < ORDER[lastPage]) log('backtrack', p);
    log('page', p);
    lastPage = p;
    if (p === 'confirmed' && !run.reached) {
      run.reached = true;
      log('reached', '');
      setTimeout(() => finishTask('reached'), 2500);
    }
  });

  const errObserver = new MutationObserver(() => {
    if (!run || run.endedAt) return;
    const errs = Array.from(document.querySelectorAll('.field-error')).map(e => e.textContent.replace('⚠', '').trim()).filter(Boolean);
    if (errs.length > lastErrorCount) log('formerror', errs.join(' / '));
    lastErrorCount = errs.length;
  });

  /* ---------- keyboard ---------- */
  window.addEventListener('keydown', e => {
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
    if (typing || !e.shiftKey) return;
    if (e.key === 'T' || e.key === 't') { e.preventDefault(); setEnabled(!enabled); }
    else if ((e.key === 'N' || e.key === 'n') && run && !run.endedAt) { e.preventDefault(); openNote(); }
    else if ((e.key === 'R' || e.key === 'r') && run && !run.endedAt) { e.stopImmediatePropagation(); e.preventDefault(); }
  }, true);

  function setEnabled(on) {
    enabled = on;
    sessionStorage.setItem(ON_KEY, on ? '1' : '0');
    if (run && !run.endedAt) return;
    if (on) renderIdleBar(); else clearUI();
  }

  /* ---------- boot ---------- */
  function boot() {
    errObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(RUN_KEY) || 'null'); } catch (e) { saved = null; }
    if (saved && !saved.endedAt) {
      run = saved; lastActivity = now(); lastPage = route();
      log('reload', ''); if (run.recording === 'yes') log('recording', 'lost on reload');
      enabled = true; renderRunBar();
    } else if (saved && saved.endedAt && !saved.survey) {
      run = saved; enabled = true; renderSurvey();
    } else if (enabled) {
      sessionStorage.setItem(ON_KEY, '1');
      renderIdleBar();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
