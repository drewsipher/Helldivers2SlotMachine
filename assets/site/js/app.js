import { loadCsv } from './csv.js';
import { SlotMachine } from './slot.js';

const DATA_CSV = 'helldivers_2_loadout_with_resized.csv';

// Sound manager with WebAudio fallback if mp3s aren't present
const audioCtx = (() => {
  try { return new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; }
})();

function beep(freq = 440, durMs = 120, type = 'triangle', gain = 0.05) {
  if (!audioCtx) return { play() {} };
  return {
    play() {
      const t0 = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = type; osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs / 1000);
      osc.connect(g).connect(audioCtx.destination);
      osc.start();
      osc.stop(t0 + durMs / 1000);
    }
  };
}

const sounds = {
  spin: (function(){
    const a = new Audio('assets/site/sfx/spin.mp3');
    a.addEventListener('error', () => { sounds.spin = beep(180, 220, 'sawtooth', 0.03); });
    return a;
  })(),
  stop: (function(){
    const a = new Audio('assets/site/sfx/stop.mp3');
    a.addEventListener('error', () => { sounds.stop = beep(540, 90, 'square', 0.04); });
    return a;
  })(),
  win: (function(){
    const a = new Audio('assets/site/sfx/win.mp3');
    a.addEventListener('error', () => { sounds.win = beep(880, 280, 'triangle', 0.06); });
    return a;
  })(),
};

function safePlay(audio) {
  try { audio.currentTime = 0; audio.play(); } catch { /* ignore */ }
}

const EXCLUDED_WARBONDS_KEY = 'hd2slot-excluded-warbonds';

function loadExcludedWarbonds(known) {
  try {
    const saved = JSON.parse(localStorage.getItem(EXCLUDED_WARBONDS_KEY) || '[]');
    return new Set(saved.filter(w => known.includes(w)));
  } catch {
    return new Set();
  }
}

function saveExcludedWarbonds(excluded) {
  try { localStorage.setItem(EXCLUDED_WARBONDS_KEY, JSON.stringify([...excluded])); } catch {}
}

async function main() {
  const rows = await loadCsv(DATA_CSV);
  // Extra Democratic toggle (on = random, off = strict)
  const strictEl = document.getElementById('extra-toggle');

  // Warbond settings: rows with "Is Warbond" true can be excluded by Source
  const warbonds = [...new Set(
    rows.filter(r => (r['Is Warbond'] || '').toLowerCase() === 'true').map(r => r.Source)
  )].sort((a, b) => a.localeCompare(b));
  const excluded = loadExcludedWarbonds(warbonds);

  // Reel data is filtered in place so the machines always see current pools
  const reelData = { primary: [], secondary: [], grenade: [], strat: [], booster: [] };

  function applyWarbondFilter() {
    const active = rows.filter(r =>
      (r['Is Warbond'] || '').toLowerCase() !== 'true' || !excluded.has(r.Source));
    const weapons = active.filter(r => r.Category.toLowerCase() === 'weapon');
    reelData.primary = weapons.filter(w => (w.Type || '').toLowerCase() === 'primary');
    reelData.secondary = weapons.filter(w => (w.Type || '').toLowerCase() === 'secondary');
    reelData.grenade = weapons.filter(w => (w.Type || '').toLowerCase() === 'grenade');
    reelData.strat = active.filter(r => r.Category.toLowerCase() === 'strategem');
    reelData.booster = active.filter(r => r.Category.toLowerCase() === 'booster');
  }
  applyWarbondFilter();

  const loadoutMachine = new SlotMachine('.machine--loadout', [
    { key: 'primary', label: 'Primary' },
    { key: 'secondary', label: 'Secondary' },
    { key: 'grenade', label: 'Grenade' },
  ], reelData, sounds);

  const stratMachine = new SlotMachine('.machine--strats', [
    { key: 'strat-1', label: 'Stratagem 1', sourceKey: 'strat', groupByField: 'Subtype' },
    { key: 'strat-2', label: 'Stratagem 2', sourceKey: 'strat', groupByField: 'Subtype' },
    { key: 'strat-3', label: 'Stratagem 3', sourceKey: 'strat', groupByField: 'Subtype' },
    { key: 'strat-4', label: 'Stratagem 4', sourceKey: 'strat', groupByField: 'Subtype' },
    { key: 'booster', label: 'Booster', sourceKey: 'booster' },
  ], reelData, sounds);

  // Seed initial values according to toggle state (unchecked => strict)
  const initialStrict = !strictEl?.checked;
  loadoutMachine.seed({ strict: initialStrict });
  stratMachine.seed({ strict: initialStrict });

  // Re-seed on toggle change to reflect mode immediately
  strictEl?.addEventListener('change', () => {
    const strict = !strictEl.checked;
    loadoutMachine.seed({ strict });
    stratMachine.seed({ strict });
  });

  // Warbond settings UI
  const listEl = document.getElementById('warbond-list');
  function refreshAfterFilterChange() {
    saveExcludedWarbonds(excluded);
    applyWarbondFilter();
    const strict = !strictEl?.checked;
    loadoutMachine.seed({ strict });
    stratMachine.seed({ strict });
  }
  if (listEl) {
    warbonds.forEach(w => {
      const label = document.createElement('label');
      label.className = 'warbond-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !excluded.has(w);
      cb.addEventListener('change', () => {
        if (cb.checked) excluded.delete(w); else excluded.add(w);
        refreshAfterFilterChange();
      });
      const span = document.createElement('span');
      span.textContent = w;
      label.append(cb, span);
      listEl.appendChild(label);
    });
    const setAll = (checked) => {
      listEl.querySelectorAll('input').forEach(cb => cb.checked = checked);
      excluded.clear();
      if (!checked) warbonds.forEach(w => excluded.add(w));
      refreshAfterFilterChange();
    };
    document.getElementById('warbonds-all')?.addEventListener('click', () => setAll(true));
    document.getElementById('warbonds-none')?.addEventListener('click', () => setAll(false));
  }

  // Invert logic: unchecked => strict=true
  document.getElementById('spin-loadout').addEventListener('click', () => loadoutMachine.spin({ strict: !strictEl?.checked }));
  document.getElementById('spin-strats').addEventListener('click', () => stratMachine.spin({ strict: !strictEl?.checked }));
  document.getElementById('spin-all').addEventListener('click', () => {
    const strict = !strictEl?.checked;
    loadoutMachine.spin({ noSound: true, strict });
    setTimeout(() => stratMachine.spin({ strict }), 200);
    safePlay(sounds.spin);
  });
}

main().catch(err => console.error(err));
