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

async function main() {
  const rows = await loadCsv(DATA_CSV);
  // Extra Democratic toggle (on = random, off = strict)
  const strictEl = document.getElementById('extra-toggle');
  // Partition the data
  const weapons = rows.filter(r => r.Category.toLowerCase() === 'weapon');
  const boosters = rows.filter(r => r.Category.toLowerCase() === 'booster');
  const strategems = rows.filter(r => r.Category.toLowerCase() === 'strategem');

  const primaries = weapons.filter(w => (w.Type || '').toLowerCase() === 'primary');
  const secondaries = weapons.filter(w => (w.Type || '').toLowerCase() === 'secondary');
  const grenades = weapons.filter(w => (w.Type || '').toLowerCase() === 'grenade');

  // Reel data maps to required fields
  const reelData = {
    primary: primaries,
    secondary: secondaries,
    grenade: grenades,
    strat: strategems,
    booster: boosters,
  };

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
