// ─── State ───────────────────────────────────────────────────────────────────
let is24h          = localStorage.getItem('chrono_format') !== 'false';
let isDark         = localStorage.getItem('chrono_theme')  !== 'light';
let alarms         = JSON.parse(localStorage.getItem('chrono_alarms') || '[]');
let ringingAlarmIds = new Set();
let audioCtx       = null;
let activeOscillators = [];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function pad(n) {
  return String(n).padStart(2, '0');
}

// ─── Audio ───────────────────────────────────────────────────────────────────
function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function startAlarmSound() {
  stopAlarmSound();
  try {
    const ctx     = getAudioCtx();
    const pattern = [880, 1100, 880, 1100, 660, 880];
    const t       = ctx.currentTime;

    pattern.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.frequency.value = freq;
      osc.type            = 'sine';

      gain.gain.setValueAtTime(0,    t + i * 0.18);
      gain.gain.linearRampToValueAtTime(0.35, t + i * 0.18 + 0.05);
      gain.gain.linearRampToValueAtTime(0,    t + i * 0.18 + 0.16);

      osc.start(t + i * 0.18);
      osc.stop(t  + i * 0.18 + 0.18);

      activeOscillators.push(osc);
    });

    // Loop after 1.5 s as long as an alarm is still ringing
    setTimeout(() => {
      if (ringingAlarmIds.size > 0) startAlarmSound();
    }, 1500);
  } catch (e) {
    console.warn('Audio error:', e);
  }
}

function stopAlarmSound() {
  activeOscillators.forEach(o => { try { o.stop(); } catch (e) {} });
  activeOscillators = [];
}

// ─── Clock Tick ──────────────────────────────────────────────────────────────
const DAYS = [
  'Sunday','Monday','Tuesday','Wednesday',
  'Thursday','Friday','Saturday'
];
const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

function tick() {
  const now = new Date();
  const h24 = now.getHours();
  const m   = now.getMinutes();
  const s   = now.getSeconds();

  let timeStr, period = '';

  if (is24h) {
    timeStr = `${pad(h24)}:${pad(m)}:${pad(s)}`;
  } else {
    const h12 = h24 % 12 || 12;
    period    = h24 < 12 ? 'AM' : 'PM';
    timeStr   = `${pad(h12)}:${pad(m)}:${pad(s)}`;
  }

  document.getElementById('timeText').textContent    = timeStr;
  document.getElementById('periodBadge').textContent = period;

  const dateStr = `${DAYS[now.getDay()]} · ${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
  document.getElementById('dateDisplay').textContent = dateStr;

  checkAlarms(now);
}

// ─── Alarm Check ─────────────────────────────────────────────────────────────
function checkAlarms(now) {
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  const ss = now.getSeconds();

  alarms.forEach(alarm => {
    if (!alarm.on) return;
    const target = alarm.snoozedUntil || alarm.time;
    if (target === `${hh}:${mm}` && ss === 0 && !ringingAlarmIds.has(alarm.id)) {
      ringingAlarmIds.add(alarm.id);
      alarm.ringing = true;
    }
  });

  // Start sound only when the first alarm begins ringing
  if (ringingAlarmIds.size === 1 && alarms.some(a => a.ringing)) {
    startAlarmSound();
  }

  const firstRinging = alarms.find(a => a.ringing);
  const banner       = document.getElementById('alarmBanner');

  if (firstRinging) {
    document.getElementById('bannerTitle').textContent = firstRinging.label || 'Alarm!';
    document.getElementById('bannerTime').textContent  =
      firstRinging.time +
      (firstRinging.snoozedUntil ? ` · Snoozed to ${firstRinging.snoozedUntil}` : '');
    banner.classList.add('visible');
    document.getElementById('timeDisplay').classList.add('alarm-ringing');
  } else {
    banner.classList.remove('visible');
    document.getElementById('timeDisplay').classList.remove('alarm-ringing');
  }

  renderAlarms();
  saveAlarms();
}

// ─── Snooze & Dismiss ────────────────────────────────────────────────────────
function snoozeAll() {
  const now = new Date();
  now.setMinutes(now.getMinutes() + 5);
  const snoozedTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  alarms.forEach(a => {
    if (a.ringing) {
      a.ringing      = false;
      a.snoozedUntil = snoozedTime;
      ringingAlarmIds.delete(a.id);
    }
  });

  stopAlarmSound();
  saveAlarms();
  renderAlarms();
  document.getElementById('alarmBanner').classList.remove('visible');
  document.getElementById('timeDisplay').classList.remove('alarm-ringing');
}

function dismissAll() {
  alarms.forEach(a => {
    if (a.ringing) {
      a.ringing      = false;
      a.snoozedUntil = null;
      ringingAlarmIds.delete(a.id);
    }
  });

  stopAlarmSound();
  saveAlarms();
  renderAlarms();
  document.getElementById('alarmBanner').classList.remove('visible');
  document.getElementById('timeDisplay').classList.remove('alarm-ringing');
}

// ─── Alarm CRUD ──────────────────────────────────────────────────────────────
function addAlarm() {
  const timeVal = document.getElementById('alarmTime').value;
  const label   = document.getElementById('alarmLabel').value.trim();

  if (!timeVal) {
    flashInput('alarmTime');
    return;
  }

  alarms.push({
    id:          Date.now(),
    time:        timeVal,
    label:       label || '',
    on:          true,
    ringing:     false,
    snoozedUntil: null
  });

  document.getElementById('alarmTime').value  = '';
  document.getElementById('alarmLabel').value = '';

  saveAlarms();
  renderAlarms();
}

function deleteAlarm(id) {
  alarms = alarms.filter(a => a.id !== id);
  ringingAlarmIds.delete(id);
  if (!alarms.some(a => a.ringing)) stopAlarmSound();
  saveAlarms();
  renderAlarms();
}

function toggleAlarm(id) {
  const alarm = alarms.find(a => a.id === id);
  if (alarm) {
    alarm.on = !alarm.on;
    if (!alarm.on) {
      alarm.ringing = false;
      ringingAlarmIds.delete(id);
    }
  }
  saveAlarms();
  renderAlarms();
}

function flashInput(id) {
  const el = document.getElementById(id);
  el.style.borderColor = 'var(--accent2)';
  el.style.boxShadow   = '0 0 0 3px rgba(255,64,129,0.2)';
  setTimeout(() => {
    el.style.borderColor = '';
    el.style.boxShadow   = '';
  }, 1000);
}

function saveAlarms() {
  localStorage.setItem('chrono_alarms', JSON.stringify(alarms));
}

// ─── Render Alarms ───────────────────────────────────────────────────────────
function renderAlarms() {
  const list = document.getElementById('alarmsList');

  if (!alarms.length) {
    list.innerHTML = `<div class="empty-state"><div>⏰</div>No alarms set</div>`;
    return;
  }

  const sorted = [...alarms].sort((a, b) => a.time.localeCompare(b.time));

  list.innerHTML = sorted.map(alarm => {
    // Status badge
    let statusClass = 'status-off';
    let statusText  = 'Off';

    if (alarm.ringing) {
      statusClass = 'status-ringing';
      statusText  = 'Ringing';
    } else if (alarm.snoozedUntil) {
      statusClass = 'status-snoozed';
      statusText  = `Snoozed → ${alarm.snoozedUntil}`;
    } else if (alarm.on) {
      statusClass = 'status-active';
      statusText  = 'Active';
    }

    // Time display (respects 12/24h)
    let dispTime = alarm.time;
    if (!is24h) {
      const [h, m] = alarm.time.split(':').map(Number);
      const h12    = h % 12 || 12;
      const ap     = h < 12 ? 'AM' : 'PM';
      dispTime     = `${pad(h12)}:${pad(m)} ${ap}`;
    }

    return `
      <div class="alarm-item ${alarm.ringing ? 'ringing' : ''} ${alarm.snoozedUntil && !alarm.ringing ? 'snoozed' : ''}">
        <button
          class="alarm-toggle ${alarm.on ? 'on' : ''}"
          onclick="toggleAlarm(${alarm.id})"
          title="Toggle alarm"
        ></button>
        <div class="alarm-time-label">${dispTime}</div>
        <div class="alarm-tag">${alarm.label || '—'}</div>
        <div class="alarm-status ${statusClass}">${statusText}</div>
        <button class="delete-alarm-btn" onclick="deleteAlarm(${alarm.id})" title="Delete">✕</button>
      </div>
    `;
  }).join('');
}

// ─── Theme & Format ──────────────────────────────────────────────────────────
function applyTheme() {
  document.body.classList.toggle('light', !isDark);
  document.getElementById('themeToggle').textContent = isDark ? '🌙' : '☀️';
  localStorage.setItem('chrono_theme', isDark ? 'dark' : 'light');
}

function applyFormat() {
  document.getElementById('formatToggle').textContent = is24h ? '12' : '24';
  localStorage.setItem('chrono_format', is24h ? 'true' : 'false');
  renderAlarms();
}

// ─── Event Listeners ─────────────────────────────────────────────────────────
document.getElementById('themeToggle').addEventListener('click', () => {
  isDark = !isDark;
  applyTheme();
});

document.getElementById('formatToggle').addEventListener('click', () => {
  is24h = !is24h;
  applyFormat();
});

document.getElementById('addAlarmBtn').addEventListener('click', addAlarm);

document.getElementById('alarmLabel').addEventListener('keydown', e => {
  if (e.key === 'Enter') addAlarm();
});

document.getElementById('snoozeBtn').addEventListener('click',  snoozeAll);
document.getElementById('dismissBtn').addEventListener('click', dismissAll);

// ─── Init ─────────────────────────────────────────────────────────────────────
applyTheme();
applyFormat();
renderAlarms();
tick();
setInterval(tick, 1000);