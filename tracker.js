// ==================== PAGE SWITCHER ====================
function switchPage(page) {
  document.querySelectorAll('.page-view').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.page-tab').forEach(el => el.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  const tabs = document.querySelectorAll('.page-tab');
  const idx = page === 'program' ? 0 : 1;
  tabs[idx].classList.add('active');
  window.scrollTo(0, 0);
}

// ==================== WORKOUT TRACKER — SUPABASE BACKEND ====================
// Replaces localStorage with live Supabase database.
// Data persists across devices — any device with the code can access all logs.

const SUPA_URL = 'https://horltkgbjgybhrovaddp.supabase.co';
const SUPA_KEY = 'sb_publishable_LUU5pympwIlhzh8eb6_8aw_17guRS8v';
const supa = supabase.createClient(SUPA_URL, SUPA_KEY);

let _wtCode = null;
let _wtWeekOffset = 0;
let _wtCache = []; // local cache so UI renders instantly after first load

// ── Loading state helpers ──
function wtShowLoading(msg) {
  const el = document.getElementById('wt-load-status');
  if (el) { el.textContent = (msg || '⏳ Loading…'); el.className = 'wt-code-status'; }
}
function wtHideLoading() {}

// ── Generate a new code and register it in Supabase ──
async function wtGenerateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i=0;i<6;i++) code += chars[Math.floor(Math.random()*chars.length)];
  document.getElementById('wt-new-code-display').textContent = code;
  const t = T[window._currentLang||'en'];
  document.getElementById('wt-gen-status').textContent = '⏳ Registering…';
  document.getElementById('wt-gen-status').className = 'wt-code-status';

  // Insert into profiles table (ignore duplicate — code collision is near zero)
  const { error } = await supa.from('profiles').insert({ code }).maybeSingle();
  if (error && error.code !== '23505') { // 23505 = unique violation (already exists)
    document.getElementById('wt-gen-status').textContent = '✗ Error: ' + error.message;
    document.getElementById('wt-gen-status').className = 'wt-code-status err';
    return;
  }
  document.getElementById('wt-gen-status').textContent = t.wt_code_created || '✓ Code created — write it down!';
  document.getElementById('wt-gen-status').className = 'wt-code-status ok';
  document.getElementById('wt-code-input').value = code;
  setTimeout(wtLoadCode, 300);
}

// ── Load a code: fetch all logs from Supabase ──
async function wtLoadCode() {
  const code = document.getElementById('wt-code-input').value.trim().toUpperCase();
  const t = T[window._currentLang||'en'];
  if (code.length !== 6) { wtSetStatus('err', t.wt_code_err||'Code must be 6 characters'); return; }

  wtSetStatus('', '⏳ Connecting to database…');

  // Check if profile exists
  const { data: profile, error: profileErr } = await supa
    .from('profiles').select('code').eq('code', code).maybeSingle();

  if (profileErr) { wtSetStatus('err', '✗ Connection error: ' + profileErr.message); return; }

  if (!profile) {
    // New code — create profile
    const { error: insertErr } = await supa.from('profiles').insert({ code });
    if (insertErr) { wtSetStatus('err', '✗ Could not create profile: ' + insertErr.message); return; }
    _wtCode = code;
    _wtCache = [];
    wtSetStatus('ok', t.wt_code_new || '✓ New profile created!');
  } else {
    // Existing code — load all logs
    const { data: logs, error: logsErr } = await supa
      .from('workout_logs')
      .select('*')
      .eq('code', code)
      .order('date', { ascending: true });

    if (logsErr) { wtSetStatus('err', '✗ Could not load logs: ' + logsErr.message); return; }

    _wtCode = code;
    // Normalise: Supabase returns id as bigint string — convert to number for compatibility
    _wtCache = (logs || []).map(r => ({
      id: Number(r.id),
      date: r.date,
      exercise: r.exercise,
      weight: parseFloat(r.weight),
      reps: r.reps,
      sets: r.sets,
      rpe: r.rpe ? parseFloat(r.rpe) : null,
      notes: r.notes || ''
    }));

    console.log('[WT] Loaded', _wtCache.length, 'sets for code:', code);
    if (_wtCache.length > 0) console.log('[WT] Sample entry:', _wtCache[0]);

    const count = _wtCache.length;
    wtSetStatus('ok',
      (t.wt_code_loaded||'✓ Loaded') + ' ' + count + ' ' + (t.wt_code_sets||'sets') + '.');
  }

  document.getElementById('wt-active-code-badge').textContent = 'CODE: ' + code;
  document.getElementById('wt-main').style.display = 'block';
  document.getElementById('wt-log-date').value = new Date().toISOString().split('T')[0];
  _wtWeekOffset = 0;
  wtRefresh();
}

function wtSetStatus(cls, msg) {
  const el = document.getElementById('wt-load-status');
  el.textContent = msg; el.className = 'wt-code-status' + (cls ? ' ' + cls : '');
}

// ── Save a new set to Supabase ──
async function wtSaveSet() {
  if (!_wtCode) return;
  const date = document.getElementById('wt-log-date').value;
  const exercise = document.getElementById('wt-log-exercise').value;
  const weight = parseFloat(document.getElementById('wt-log-weight').value);
  const reps = parseInt(document.getElementById('wt-log-reps').value);
  const sets = parseInt(document.getElementById('wt-log-sets').value) || 1;
  const rpe = parseFloat(document.getElementById('wt-log-rpe').value) || null;
  const notes = document.getElementById('wt-log-notes').value.trim();
  if (!date || !exercise) { alert('Please fill date and exercise.'); return; }
  if (isNaN(weight) || weight < 0) { alert('Enter a valid weight (use 0 for bodyweight moves).'); return; }
  if (isNaN(reps) || reps < 1) { alert('Enter valid reps.'); return; }

  const btn = document.querySelector('.wt-save-btn');
  const t = T[window._currentLang||'en'];
  btn.textContent = '⏳'; btn.disabled = true;

  const payload = { code: _wtCode, date, exercise, weight, reps, sets, rpe: rpe || null, notes: notes || '' };
  console.log('[WT] Saving set:', payload);

  const { data, error } = await supa.from('workout_logs').insert(payload).select().single();

  btn.disabled = false;

  if (error) {
    btn.textContent = t.wt_save_btn || '＋ LOG SET';
    console.error('[WT] Save error:', error);
    alert('Save failed: ' + error.message);
    return;
  }

  if (!data) {
    btn.textContent = t.wt_save_btn || '＋ LOG SET';
    console.error('[WT] Save returned no data — RLS policy may be blocking the insert');
    alert('Save failed: no data returned. Check Supabase RLS policies.');
    return;
  }

  console.log('[WT] Saved successfully, id:', data.id);

  // Add to local cache immediately so UI updates without re-fetching
  _wtCache.push({
    id: Number(data.id), date, exercise,
    weight, reps, sets, rpe, notes
  });
  _wtCache.sort((a,b) => a.date.localeCompare(b.date));

  console.log('[WT] Cache now has', _wtCache.length, 'entries');

  // Clear fields
  document.getElementById('wt-log-weight').value = '';
  document.getElementById('wt-log-reps').value = '';
  document.getElementById('wt-log-notes').value = '';

  const origTxt = btn.getAttribute('data-i18n') ? (t[btn.getAttribute('data-i18n')]||'＋ LOG SET') : '＋ LOG SET';
  btn.textContent = t.wt_saved_ok || '✓ LOGGED!'; btn.style.background='#fff';
  setTimeout(() => { btn.textContent = origTxt; btn.style.background=''; }, 1200);

  wtRefresh();
  // Auto-open the drill panel for this exercise so the user sees their log immediately
  const drillSel = document.getElementById('wt-drill-select');
  if (drillSel) {
    drillSel.value = exercise;
    wtRenderDrill();
    // Scroll to the drill panel smoothly
    setTimeout(() => {
      const panel = document.getElementById('wt-drill-panel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  }
  wtShowLastHint(exercise);
  timerStart(exercise);
}

// ── Delete a set from Supabase ──
async function wtDeleteSet(id) {
  const t = T[window._currentLang||'en'];
  if (!_wtCode || !confirm(t.wt_del_confirm||'Delete this log?')) return;

  const { error } = await supa.from('workout_logs').delete().eq('id', id).eq('code', _wtCode);
  if (error) { alert('Delete failed: ' + error.message); return; }

  // Remove from cache
  _wtCache = _wtCache.filter(s => s.id !== id);
  wtRefresh();
}

// ── Local cache accessors (replaces wtGetUser / wtSaveUser) ──
function wtGetUser() { return _wtCache; }
function wtSaveUser(sets) { _wtCache = sets; } // only used by in-memory ops now

// ── Show hint of last logged set for the same exercise ──
function wtShowLastHint(exercise) {
  const prev = wtGetUser().filter(s => s.exercise === exercise).slice(-2,-1)[0];
  if (!prev) { document.getElementById('wt-last-hint').textContent=''; return; }
  const orm = epley1RM(prev.weight, prev.reps);
  document.getElementById('wt-last-hint').textContent =
    'Last ' + exercise + ': ' + prev.weight + 'kg × ' + prev.reps + ' reps  |  Est. 1RM: ' + orm + 'kg';
}

// ISO week string: "2025-W12"
// Uses local date parsing (no UTC shift) to match the date the user typed
function getISOWeek(dateStr) {
  // Parse as local date to avoid timezone shifting the day
  const parts = dateStr.split('-');
  const d = new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]));
  const day = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - day);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const wk = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return d.getFullYear() + '-W' + String(wk).padStart(2,'0');
}

function getWeekForOffset(offset) {
  const now = new Date();
  now.setDate(now.getDate() + offset * 7);
  return getISOWeek(now.toISOString().split('T')[0]);
}

function weekLabel(offset) {
  const wk = getWeekForOffset(offset);
  const [y, w] = wk.split('-W');
  // Get Monday of that week
  const jan1 = new Date(parseInt(y), 0, 1);
  const daysToMon = (1 - jan1.getDay() + 7) % 7;
  const mon = new Date(jan1);
  mon.setDate(jan1.getDate() + daysToMon + (parseInt(w) - 1) * 7);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const fmt = d => d.toLocaleDateString('en-GB', {day:'numeric',month:'short'});
  return fmt(mon) + ' – ' + fmt(sun);
}

// Epley 1RM formula
function epley1RM(weight, reps) {
  if (reps === 1) return weight;
  return +(weight * (1 + reps / 30)).toFixed(1);
}


function wtChangeWeek(dir) { _wtWeekOffset += dir; wtRefresh(); }
function wtGoToday() { _wtWeekOffset = 0; wtRefresh(); }

// Quick-fill exercise selector with Day A/B/C exercises
const DAY_EXERCISES = {
  A: ['Barbell Back Squat','Barbell Bench Press','Barbell Romanian Deadlift','Seated DB Shoulder Press','Cable Lat Pulldown','Cable Tricep Pushdown','DB Bicep Curl'],
  B: ['Leg Press','Barbell Bent-Over Row','DB Incline Press','Cable Face Pull','Leg Curl Machine','Lateral Raise','Plank'],
  C: ['Deadlift','DB Lunges','Cable Chest Fly','Seated Cable Row','Leg Extension Machine','EZ Bar Skull Crusher','Incline DB Curl']
};
function wtQuickFill(day) {
  // Select first exercise of that day
  document.getElementById('wt-log-exercise').value = DAY_EXERCISES[day][0];
  wtShowLastHint(DAY_EXERCISES[day][0]);
  document.querySelectorAll('#wt-day-a-btn,#wt-day-b-btn,#wt-day-c-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('wt-day-'+day.toLowerCase()+'-btn').classList.add('active');
}

function wtRefresh() {
  const thisWeek = getWeekForOffset(_wtWeekOffset);
  const lastWeek = getWeekForOffset(_wtWeekOffset - 1);
  const sets = wtGetUser();
  const t = T[window._currentLang||'en'];

  // Update week labels
  const suffix = weekLabel(_wtWeekOffset);
  window._wtWeekLabelSuffix = suffix;
  document.getElementById('wt-week-label').textContent = (t.wt_week_label||'Week:') + ' ' + suffix;
  document.getElementById('wt-week-display').textContent = suffix;
  document.getElementById('wt-this-week-btn').classList.toggle('active', _wtWeekOffset === 0);

  // Overview stats
  const sessions = [...new Set(sets.map(s=>s.date))].length;
  const exercises = [...new Set(sets.map(s=>s.exercise))].length;
  document.getElementById('wt-ov-sessions').textContent = sessions;
  document.getElementById('wt-ov-exercises').textContent = exercises;

  // Find most-improved exercise (first → best, % gain)
  const exNames = [...new Set(sets.map(s=>s.exercise))];
  let bestLift = '—', bestPct = '—';
  let maxPct = -Infinity;
  exNames.forEach(ex => {
    const exSets = sets.filter(s=>s.exercise===ex).sort((a,b)=>a.date.localeCompare(b.date));
    if (exSets.length < 2) return;
    const first1RM = epley1RM(exSets[0].weight, exSets[0].reps);
    const bestSet = exSets.reduce((p,c) => epley1RM(c.weight,c.reps) > epley1RM(p.weight,p.reps) ? c : p);
    const best1RM = epley1RM(bestSet.weight, bestSet.reps);
    const pct = first1RM > 0 ? ((best1RM - first1RM) / first1RM * 100) : 0;
    if (pct > maxPct) { maxPct = pct; bestLift = ex.split(' ').slice(-2).join(' '); bestPct = '+'+pct.toFixed(1)+'%'; }
  });
  document.getElementById('wt-ov-best-lift').textContent = bestLift;
  document.getElementById('wt-ov-best-pct').textContent = bestPct;

  // Week vs last week avg
  const thisWeekSets = sets.filter(s=>getISOWeek(s.date)===thisWeek);
  const lastWeekSets = sets.filter(s=>getISOWeek(s.date)===lastWeek);
  if (thisWeekSets.length && lastWeekSets.length) {
    const avgThis = thisWeekSets.reduce((a,s)=>a+epley1RM(s.weight,s.reps),0)/thisWeekSets.length;
    const avgLast = lastWeekSets.reduce((a,s)=>a+epley1RM(s.weight,s.reps),0)/lastWeekSets.length;
    const pct = ((avgThis-avgLast)/avgLast*100);
    const sign = pct >= 0 ? '+' : '';
    document.getElementById('wt-ov-week-pct').textContent = sign+pct.toFixed(1)+'%';
    document.getElementById('wt-ov-week-pct').style.color = pct >= 0 ? 'var(--accent3)' : 'var(--accent2)';
  } else {
    document.getElementById('wt-ov-week-pct').textContent = '—';
    document.getElementById('wt-ov-week-pct').style.color = '';
  }

  // Progress table
  wtRenderProgressTable(sets, thisWeek, lastWeek);
  // Recent logs table (always visible)
  wtRenderRecentLogs(sets);
  // Deload detector
  wtCheckDeload(sets);
  // Streak heatmap
  wtRenderHeatmap(sets);
  // Drill dropdown
  wtPopulateDrillSelect(sets);
  // Re-render drill if one is selected
  if (document.getElementById('wt-drill-select').value) wtRenderDrill();
}

// ── Recent logs: always-visible table showing ALL logged sets, newest first ──
function wtRenderRecentLogs(sets) {
  const tbody = document.getElementById('wt-recent-body');
  const countEl = document.getElementById('wt-recent-count');
  if (!tbody) return;

  const t = T[window._currentLang||'en'];
  countEl.textContent = sets.length + ' ' + (t.wt_code_sets||'sets');

  if (!sets.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="wt-empty"><div class="wt-empty-icon">🏋️</div>Log your first set above</div></td></tr>';
    return;
  }

  // Show newest first, max 50 rows for performance
  const recent = sets.slice().reverse().slice(0, 50);
  tbody.innerHTML = recent.map(s => {
    const orm = epley1RM(s.weight, s.reps);
    return `<tr>
      <td style="font-family:'Space Mono',monospace;font-size:11px;white-space:nowrap;">${wtFmtDate(s.date)}</td>
      <td style="font-weight:500;font-size:13px;">${s.exercise}</td>
      <td><span class="wt-weight-val" style="font-size:18px;">${s.weight}</span><span class="wt-weight-unit">kg</span></td>
      <td style="font-family:'Space Mono',monospace;text-align:center;">${s.reps}</td>
      <td style="font-family:'Space Mono',monospace;text-align:center;color:var(--muted);">${s.sets}</td>
      <td style="font-family:'Space Mono',monospace;color:var(--accent);font-size:12px;">${orm}kg</td>
      <td><button class="wt-del-btn" onclick="wtDeleteSet(${s.id})">✕</button></td>
    </tr>`;
  }).join('');
}

function wtRenderProgressTable(sets, thisWeek, lastWeek) {
  const tbody = document.getElementById('wt-progress-body');
  const t = T[window._currentLang||'en'];
  const allEx = [...new Set(sets.map(s=>s.exercise))];

  // Show ALL exercises that have been logged — not just this/last week
  // This ensures newly logged exercises always appear immediately
  if (!allEx.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="wt-empty"><div class="wt-empty-icon">📊</div>'+(t.wt_empty_progress||'Log sets to see progress comparison')+'</div></td></tr>';
    return;
  }

  tbody.innerHTML = allEx.map(ex => {
    const twSets = sets.filter(s=>s.exercise===ex && getISOWeek(s.date)===thisWeek);
    const lwSets = sets.filter(s=>s.exercise===ex && getISOWeek(s.date)===lastWeek);
    const allSets = sets.filter(s=>s.exercise===ex);
    const bestThis = twSets.length ? twSets.reduce((p,c)=>epley1RM(c.weight,c.reps)>epley1RM(p.weight,p.reps)?c:p) : null;
    const bestLast = lwSets.length ? lwSets.reduce((p,c)=>epley1RM(c.weight,c.reps)>epley1RM(p.weight,p.reps)?c:p) : null;
    const bestEver = allSets.reduce((p,c)=>epley1RM(c.weight,c.reps)>epley1RM(p.weight,p.reps)?c:p);

    // Most recent set (for exercises not logged this week)
    const mostRecent = allSets[allSets.length - 1];
    const displayThis = bestThis
      ? bestThis.weight + 'kg × ' + bestThis.reps
      : '<span style="color:var(--muted);font-size:11px;">' + mostRecent.date + '</span>';
    const lastLabel = bestLast ? bestLast.weight + 'kg × ' + bestLast.reps : '—';
    const est1RM = bestThis ? epley1RM(bestThis.weight, bestThis.reps) + ' kg'
      : epley1RM(mostRecent.weight, mostRecent.reps) + ' kg';
    const bestEverLabel = bestEver.weight + 'kg × ' + bestEver.reps;

    let pctCell = '<span style="color:var(--muted)">—</span>';
    if (bestThis && bestLast) {
      const tv = epley1RM(bestThis.weight, bestThis.reps);
      const lv = epley1RM(bestLast.weight, bestLast.reps);
      const pct = ((tv - lv) / lv * 100);
      const sign = pct >= 0 ? '+' : '';
      const cls = pct > 0 ? 'var(--accent3)' : pct < 0 ? 'var(--accent2)' : 'var(--muted)';
      const bar = Math.min(Math.abs(pct), 20) / 20 * 100;
      pctCell = `<div style="display:flex;flex-direction:column;gap:4px;">
        <span style="font-family:'Bebas Neue',sans-serif;font-size:22px;color:${cls};">${sign}${pct.toFixed(1)}%</span>
        <div style="height:3px;background:var(--border);width:80px;">
          <div style="height:3px;width:${bar}%;background:${cls};"></div>
        </div>
      </div>`;
    } else if (bestThis && !bestLast) {
      pctCell = '<span style="font-family:\'Space Mono\',monospace;font-size:10px;color:var(--accent3);">'+(T[window._currentLang||'en'].wt_new_entry||'NEW')+'</span>';
    }

    return `<tr>
      <td style="font-weight:500;">${ex}</td>
      <td style="font-family:'Space Mono',monospace;font-size:12px;color:var(--muted);">${lastLabel}</td>
      <td style="font-family:'Space Mono',monospace;font-size:12px;">${displayThis}</td>
      <td>${pctCell}</td>
      <td style="font-family:'Space Mono',monospace;font-size:12px;color:var(--accent);">${est1RM}</td>
      <td style="font-family:'Space Mono',monospace;font-size:12px;color:var(--muted);">${bestEverLabel}</td>
    </tr>`;
  }).join('');
}

function wtPopulateDrillSelect(sets) {
  const sel = document.getElementById('wt-drill-select');
  const cur = sel.value;
  const exNames = [...new Set(sets.map(s=>s.exercise))].sort();
  sel.innerHTML = '<option value="">— Select an exercise —</option>' +
    exNames.map(ex => `<option value="${ex}" ${ex===cur?'selected':''}>${ex}</option>`).join('');
}

function wtRenderDrill() {
  const ex = document.getElementById('wt-drill-select').value;
  const panel = document.getElementById('wt-drill-panel');
  if (!ex) { panel.style.display='none'; return; }
  panel.style.display = 'block';
  const sets = wtGetUser().filter(s=>s.exercise===ex).sort((a,b)=>a.date.localeCompare(b.date));
  if (!sets.length) { panel.style.display='none'; return; }

  // Stats
  const sessionDates = [...new Set(sets.map(s=>s.date))];
  const best = sets.reduce((p,c)=>c.weight>p.weight?c:p);
  const best1RM = sets.reduce((p,c)=>epley1RM(c.weight,c.reps)>epley1RM(p.weight,p.reps)?c:p);
  const first1RM = epley1RM(sets[0].weight, sets[0].reps);
  const topORM = epley1RM(best1RM.weight, best1RM.reps);
  const totalGainPct = first1RM > 0 ? ((topORM - first1RM)/first1RM*100).toFixed(1) : 0;

  document.getElementById('wt-drill-sessions').textContent = sessionDates.length;
  document.getElementById('wt-drill-best').textContent = best.weight + 'kg';
  document.getElementById('wt-drill-1rm').textContent = topORM + 'kg';
  document.getElementById('wt-drill-gain').textContent = (totalGainPct >= 0 ? '+' : '') + totalGainPct + '%';
  document.getElementById('wt-drill-gain').style.color = totalGainPct >= 0 ? 'var(--accent3)' : 'var(--accent2)';
  const t = T[window._currentLang||'en'];
  document.getElementById('wt-drill-count').textContent = sets.length + ' ' + (t.wt_code_sets||'sets');

  // Chart
  wtDrawDrillChart(sets);

  // History table
  const tbody = document.getElementById('wt-drill-body');
  tbody.innerHTML = sets.slice().reverse().map(s => {
    const orm = epley1RM(s.weight, s.reps);
    return `<tr>
      <td style="font-family:'Space Mono',monospace;font-size:11px;">${wtFmtDate(s.date)}</td>
      <td><span class="wt-weight-val">${s.weight}</span><span class="wt-weight-unit">kg</span></td>
      <td style="font-family:'Space Mono',monospace;">${s.reps}</td>
      <td style="font-family:'Space Mono',monospace;color:var(--muted);">${s.sets}</td>
      <td style="font-family:'Space Mono',monospace;color:var(--accent);">${orm}kg</td>
      <td style="font-family:'Space Mono',monospace;color:var(--muted);">${s.rpe || '—'}</td>
      <td style="font-size:12px;color:var(--muted);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.notes||'—'}</td>
      <td><button class="wt-del-btn" onclick="wtDeleteSet(${s.id})">✕</button></td>
    </tr>`;
  }).join('');
}

function wtDrawDrillChart(sets) {
  const svg = document.getElementById('wt-drill-chart');
  if (sets.length < 2) { svg.innerHTML = '<text x="450" y="90" fill="#444" font-size="12" text-anchor="middle" font-family="monospace">Log at least 2 sessions to see chart</text>'; return; }

  const W=900, H=180, padL=44, padR=20, padT=16, padB=24;
  const orms = sets.map(s => epley1RM(s.weight, s.reps));
  const weights = sets.map(s => s.weight);
  const allVals = [...orms, ...weights];
  const minV = Math.min(...allVals) * 0.95;
  const maxV = Math.max(...allVals) * 1.05;
  const toX = i => padL + (i/(sets.length-1))*(W-padL-padR);
  const toY = v => H - padB - ((v-minV)/(maxV-minV))*(H-padT-padB);

  const wPts = weights.map((w,i) => [toX(i), toY(w)]);
  const oPts = orms.map((o,i) => [toX(i), toY(o)]);
  const toPath = pts => pts.map((p,i)=>(i===0?'M':'L')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');
  const toArea = (pts, baseY) => toPath(pts) + ' L'+pts[pts.length-1][0].toFixed(1)+','+baseY+' L'+pts[0][0].toFixed(1)+','+baseY+' Z';

  // Grid
  const grid = [0,0.25,0.5,0.75,1].map(t => {
    const y = H - padB - t*(H-padT-padB);
    const v = (minV + t*(maxV-minV)).toFixed(0);
    return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W-padR}" y2="${y.toFixed(1)}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
            <text x="${padL-6}" y="${(y+4).toFixed(1)}" fill="#555" font-size="10" text-anchor="end" font-family="monospace">${v}</text>`;
  }).join('');

  // Date labels (only ~5 evenly spaced)
  const step = Math.max(1, Math.floor(sets.length / 5));
  const dateLabels = sets.map((s,i) => {
    if (i % step !== 0 && i !== sets.length-1) return '';
    const [,m,d] = s.date.split('-');
    return `<text x="${toX(i).toFixed(1)}" y="${H-4}" fill="#444" font-size="9" text-anchor="middle" font-family="monospace">${d}/${m}</text>`;
  }).join('');

  svg.innerHTML = `
    <defs>
      <linearGradient id="wg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3bffd4" stop-opacity="0.2"/><stop offset="100%" stop-color="#3bffd4" stop-opacity="0"/></linearGradient>
      <linearGradient id="wg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#e8ff3b" stop-opacity="0.15"/><stop offset="100%" stop-color="#e8ff3b" stop-opacity="0"/></linearGradient>
    </defs>
    ${grid}${dateLabels}
    <path d="${toArea(oPts, H-padB)}" fill="url(#wg2)"/>
    <path d="${toPath(oPts)}" fill="none" stroke="#e8ff3b" stroke-width="1.5" stroke-dasharray="5 3" opacity="0.7"/>
    <path d="${toArea(wPts, H-padB)}" fill="url(#wg1)"/>
    <path d="${toPath(wPts)}" fill="none" stroke="#3bffd4" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${wPts.map((p,i)=>`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${i===wPts.length-1?4:2.5}" fill="#3bffd4"/>`).join('')}
  `;
}

function wtFmtDate(str) {
  const [y,m,d] = str.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return d + ' ' + months[parseInt(m)-1];
}

// ==================== REST TIMER ====================
const REST_TIMES = {
  // Heavy compounds — 2:30
  'Barbell Back Squat':150,'Deadlift':180,'Barbell Bench Press':150,
  'Barbell Romanian Deadlift':150,'Leg Press':120,
  // Medium compounds — 2:00
  'Barbell Bent-Over Row':120,'DB Incline Press':120,'Seated DB Shoulder Press':90,
  'Seated Cable Row':90,'DB Lunges':90,
  // Isolation / cables — 1:00
  'Cable Lat Pulldown':75,'Cable Face Pull':60,'Cable Tricep Pushdown':60,
  'Cable Chest Fly':60,'Leg Curl Machine':60,'Leg Extension Machine':60,
  'Lateral Raise':60,'DB Bicep Curl':60,'EZ Bar Skull Crusher':60,
  'Incline DB Curl':60,'Plank':60
};
const CIRCUMFERENCE = 2 * Math.PI * 42; // r=42

let _timerTotal = 0, _timerRemaining = 0, _timerInterval = null, _timerPaused = false;

function timerStart(exercise) {
  const secs = REST_TIMES[exercise] || 90;
  _timerTotal = secs;
  _timerRemaining = secs;
  _timerPaused = false;
  document.getElementById('timer-ex-name').textContent = exercise;
  document.getElementById('timer-pause-btn').textContent = 'Pause';
  const overlay = document.getElementById('wt-rest-timer');
  overlay.classList.add('visible');
  timerDraw();
  if (_timerInterval) clearInterval(_timerInterval);
  _timerInterval = setInterval(() => {
    if (_timerPaused) return;
    _timerRemaining--;
    timerDraw();
    if (_timerRemaining <= 0) {
      clearInterval(_timerInterval);
      timerBeep();
      timerVibrate();
      // Auto-hide after 3s
      setTimeout(() => overlay.classList.remove('visible'), 3000);
    }
  }, 1000);
}

function timerDraw() {
  const r = _timerRemaining;
  const pct = Math.max(0, r / _timerTotal);
  const offset = CIRCUMFERENCE * (1 - pct);
  const ring = document.getElementById('timer-ring');
  ring.style.strokeDashoffset = offset;
  ring.className = 'timer-ring-fill' + (r <= 10 ? ' urgent' : r <= 20 ? ' warning' : '');
  const m = Math.floor(r / 60), s = r % 60;
  document.getElementById('timer-digits').textContent = m + ':' + String(s).padStart(2,'0');
  document.getElementById('timer-progress-fill').style.width = (pct * 100) + '%';
}

function timerTogglePause() {
  _timerPaused = !_timerPaused;
  document.getElementById('timer-pause-btn').textContent = _timerPaused ? 'Resume' : 'Pause';
}

function timerSkip() {
  clearInterval(_timerInterval);
  document.getElementById('wt-rest-timer').classList.remove('visible');
}

function timerAddTime(s) {
  _timerRemaining = Math.min(_timerRemaining + s, _timerTotal + s);
  _timerTotal = Math.max(_timerTotal, _timerRemaining);
  timerDraw();
}

// Called from program page "Start Rest" buttons — takes preset seconds + reads exercise name from the row
function timerStartDirect(secs, btnEl) {
  // Walk up to find the exercise name in this row
  const row = btnEl.closest('.exercise-row');
  const nameEl = row ? row.querySelector('.ex-name') : null;
  const exercise = nameEl ? nameEl.textContent.trim() : 'Exercise';
  // Use seconds directly (already parsed from the HTML rest value)
  _timerTotal = secs;
  _timerRemaining = secs;
  _timerPaused = false;
  document.getElementById('timer-ex-name').textContent = exercise;
  document.getElementById('timer-pause-btn').textContent = 'Pause';
  const overlay = document.getElementById('wt-rest-timer');
  overlay.classList.add('visible');
  timerDraw();
  if (_timerInterval) clearInterval(_timerInterval);
  _timerInterval = setInterval(() => {
    if (_timerPaused) return;
    _timerRemaining--;
    timerDraw();
    if (_timerRemaining <= 0) {
      clearInterval(_timerInterval);
      timerBeep();
      timerVibrate();
      setTimeout(() => overlay.classList.remove('visible'), 3000);
    }
  }, 1000);
  
}

function timerBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.15, 0.3].forEach(delay => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = delay === 0.3 ? 880 : 660;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.4, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.3);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.35);
    });
  } catch(e) {}
}

function timerVibrate() {
  if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 400]);
}

// ==================== DELOAD DETECTOR ====================
function wtCheckDeload(sets) {
  const container = document.getElementById('wt-deload-container');
  const t = T[window._currentLang||'en'];
  const warnings = [];
  const exNames = [...new Set(sets.map(s=>s.exercise))];
  const now = new Date();

  exNames.forEach(ex => {
    const exSets = sets.filter(s=>s.exercise===ex).sort((a,b)=>a.date.localeCompare(b.date));
    if (exSets.length < 2) return;

    // Group by ISO week
    const byWeek = {};
    exSets.forEach(s => {
      const wk = getISOWeek(s.date);
      if (!byWeek[wk]) byWeek[wk] = [];
      byWeek[wk].push(s);
    });
    const weeks = Object.keys(byWeek).sort();
    if (weeks.length < 3) return;

    // Get best 1RM for each of the last 3 weeks
    const lastThree = weeks.slice(-3).map(wk => {
      const best = byWeek[wk].reduce((p,c)=>epley1RM(c.weight,c.reps)>epley1RM(p.weight,p.reps)?c:p);
      return { wk, orm: epley1RM(best.weight, best.reps) };
    });

    const [w1, w2, w3] = lastThree;
    const drop1 = (w2.orm - w1.orm) / w1.orm;
    const drop2 = (w3.orm - w2.orm) / w2.orm;

    // Two consecutive weeks of >5% drop — flag it
    if (drop1 < -0.05 && drop2 < -0.05) {
      const totalDrop = ((w3.orm - w1.orm) / w1.orm * 100).toFixed(1);
      warnings.push({ exercise: ex, totalDrop });
    }
  });

  if (!warnings.length) { container.innerHTML = ''; return; }

  container.innerHTML = warnings.map(w => `
    <div class="deload-banner">
      <div class="deload-icon">⚠️</div>
      <div class="deload-body">
        <div class="deload-title">Consider a Deload — ${w.exercise}</div>
        <div class="deload-text">Your estimated 1RM has dropped <strong>${Math.abs(w.totalDrop)}%</strong> over the last 2 weeks. This may indicate accumulated fatigue. Consider reducing weight 40–50% for one week to let your nervous system recover.</div>
      </div>
    </div>
  `).join('');
}

// ==================== STREAK HEATMAP ====================
function wtRenderHeatmap(sets) {
  const trainDates = new Set(sets.map(s=>s.date));

  // Count sets per day for intensity shading
  const setsPerDay = {};
  sets.forEach(s => { setsPerDay[s.date] = (setsPerDay[s.date]||0) + 1; });

  // Build 52-week grid (364 days back from today + today)
  const today = new Date();
  today.setHours(0,0,0,0);
  const todayStr = today.toISOString().split('T')[0];

  // Find the last Sunday before/on 364 days ago to start grid neatly
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 364);
  // Roll back to Sunday
  startDate.setDate(startDate.getDate() - startDate.getDay());

  // Build columns (each col = one week, Sun→Sat)
  const grid = document.getElementById('heatmap-grid');
  const monthLabels = document.getElementById('heatmap-month-labels');
  grid.innerHTML = '';
  monthLabels.innerHTML = '';

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let colIndex = 0;
  let lastMonth = -1;
  const monthCols = [];

  let d = new Date(startDate);
  while (d <= today) {
    const col = document.createElement('div');
    col.className = 'heatmap-col';

    for (let dow = 0; dow < 7; dow++) {
      const cell = document.createElement('div');
      cell.className = 'heatmap-cell';
      const dateStr = d.toISOString().split('T')[0];
      if (d <= today) {
        const n = setsPerDay[dateStr] || 0;
        if (n >= 1) cell.classList.add('t1');
        if (n >= 3) cell.classList.add('t2');
        if (n >= 5) cell.classList.add('t3');
        if (n >= 8) cell.classList.add('t4');
        if (dateStr === todayStr) cell.style.outline = '1px solid var(--accent3)';
        cell.title = dateStr + (n ? ' — ' + n + ' set' + (n>1?'s':'') : '');
      }
      col.appendChild(cell);

      // Track month label position
      if (dow === 0) {
        const m = d.getMonth();
        if (m !== lastMonth) { monthCols.push({ col: colIndex, m }); lastMonth = m; }
      }
      d.setDate(d.getDate() + 1);
    }
    grid.appendChild(col);
    colIndex++;
  }

  // Build month labels row (sparse — only label the start of each month)
  const totalCols = colIndex;
  for (let c = 0; c < totalCols; c++) {
    const lbl = document.createElement('div');
    lbl.className = 'heatmap-month-lbl';
    lbl.style.width = '15px'; // cell(12) + gap(3)
    const entry = monthCols.find(mc => mc.col === c);
    if (entry) lbl.textContent = months[entry.m];
    monthLabels.appendChild(lbl);
  }

  // Streak calculations
  const sortedDates = [...trainDates].sort();
  let currentStreak = 0, longestStreak = 0, tempStreak = 0;
  let prevDate = null;

  // Current streak: count consecutive days back from today
  let check = new Date(today);
  while (true) {
    const cs = check.toISOString().split('T')[0];
    if (trainDates.has(cs)) {
      currentStreak++;
      check.setDate(check.getDate() - 1);
    } else if (cs === todayStr) {
      // Haven't trained today yet — check yesterday
      check.setDate(check.getDate() - 1);
    } else break;
  }

  // Longest streak
  sortedDates.forEach(ds => {
    if (!prevDate) { tempStreak = 1; }
    else {
      const prev = new Date(prevDate + 'T00:00:00');
      const curr = new Date(ds + 'T00:00:00');
      const diff = (curr - prev) / 86400000;
      tempStreak = diff === 1 ? tempStreak + 1 : 1;
    }
    if (tempStreak > longestStreak) longestStreak = tempStreak;
    prevDate = ds;
  });

  // This month
  const thisMonth = todayStr.slice(0,7);
  const thisMonthCount = sortedDates.filter(d=>d.startsWith(thisMonth)).length;

  document.getElementById('streak-current').textContent = currentStreak;
  document.getElementById('streak-longest').textContent = longestStreak;
  document.getElementById('streak-month').textContent = thisMonthCount;
  document.getElementById('streak-total').textContent = trainDates.size;
}