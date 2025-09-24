function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function byCategory(items, category) {
  return items.filter(i => (i.Category || '').toLowerCase() === category);
}

export class SlotMachine {
  constructor(rootSel, reelsConfig, reelData, sounds) {
    this.root = document.querySelector(rootSel);
    this.reelsConfig = reelsConfig;
    this.reelData = reelData;
    this.sounds = sounds;

    this.reelEls = new Map();
    this.reelsConfig.forEach(cfg => {
      const key = cfg.key;
      const el = this.root.querySelector(`.reel[data-reel="${key}"]`);
      this.reelEls.set(key, { el, img: el.querySelector('img'), text: el.querySelector('.result-text') });
    });

    const button = this.root.querySelector('.lever');
    button?.addEventListener('click', () => this.spin());
  }

  spin(opts = {}) {
    const noSound = !!opts.noSound;
    const strict = !!opts.strict;
    if (!noSound) this._play('spin');

    const delayStep = 200;
    // Group reels by their sourceKey to allow unique selection within a group
    const groups = new Map();
    this.reelsConfig.forEach(cfg => {
      const sourceKey = cfg.sourceKey || cfg.key;
      if (!groups.has(sourceKey)) groups.set(sourceKey, []);
      groups.get(sourceKey).push(cfg);
    });

    let idx = 0;
    for (const [sourceKey, cfgs] of groups.entries()) {
      const source = this.reelData[sourceKey] || [];
      let picks = [];

      const anyGroupBy = cfgs.find(c => c.groupByField);
      if (strict && (sourceKey === 'strat')) {
        // In strict mode for stratagems, ignore groupBy and enforce constraints instead.
        picks = this._pickStratagemsWithConstraints(source, cfgs.length);
      } else if (anyGroupBy) {
        const field = anyGroupBy.groupByField;
        const buckets = new Map();
        source.forEach(item => {
          const key = (item[field] || '').toLowerCase();
          if (!key) return;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(item);
        });
        // sample distinct groups
        const keys = [...buckets.keys()];
        for (let i = 0; i < cfgs.length; i++) {
          if (!keys.length) { picks.push(null); continue; }
          const kIdx = Math.floor(Math.random() * keys.length);
          const k = keys.splice(kIdx, 1)[0];
          const arr = buckets.get(k) || [];
          if (!arr.length) { picks.push(null); continue; }
          picks.push(arr[Math.floor(Math.random() * arr.length)]);
        }
      } else {
        // Either simple unique sampling, or constraint-aware sampling for stratagems when strict mode.
        if (strict && (sourceKey === 'strat')) {
          picks = this._pickStratagemsWithConstraints(source, cfgs.length);
        } else {
          const pool = [...source];
          cfgs.forEach(() => {
            if (!pool.length) return picks.push(null);
            const i = Math.floor(Math.random() * pool.length);
            picks.push(pool.splice(i, 1)[0]);
          });
        }
      }

      cfgs.forEach((cfg, j) => {
        const key = cfg.key;
        const item = picks[j];
        const reel = this.reelEls.get(key);
        if (!reel || !item) return;
        this._setSpinning(reel, true);
        setTimeout(() => {
          this._render(reel, item);
          this._setSpinning(reel, false);
          this._play('stop');
        }, 300 + idx * delayStep);
        idx++;
      });
    }
  }

  // Constraint-aware selection for stratagems in strict mode
  _pickStratagemsWithConstraints(source, count) {
    // Rules:
    // 1) Never two support weapons unless one of them is Expendable as the subtype
    // 2) Never two items that have a backpack set to true
    // We'll attempt random samples with retries to satisfy constraints.
    const MAX_TRIES = 200;
    const pool = [...source];
    if (count <= 0) return [];

    function satisfies(items) {
      // Rule 2: at most one with Has Backpack == 'True' (case-insensitive)
      const backpackCount = items.filter(x => (String(x['Has Backpack'] || '').toLowerCase() === 'true')).length;
      if (backpackCount > 1) return false;

      // Rule 1 (revised): no more than one NON-EXPENDABLE support weapon.
      const support = items.filter(x => (x.Type || '').toLowerCase() === 'support weapon');
      const nonExpendableSupport = support.filter(x => (x.Subtype || '').toLowerCase() !== 'expendable');
      if (nonExpendableSupport.length > 1) return false;

      return true;
    }

    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      // unique sample
      const temp = [...pool];
      const pick = [];
      for (let i = 0; i < count; i++) {
        if (!temp.length) break;
        const idx = Math.floor(Math.random() * temp.length);
        pick.push(temp.splice(idx, 1)[0]);
      }
      if (pick.length === count && satisfies(pick)) return pick;
    }
    // Fallback: greedy build that respects constraints as much as possible
    const result = [];
    const remaining = [...pool];
    while (result.length < count && remaining.length) {
      const idx = Math.floor(Math.random() * remaining.length);
      const cand = remaining.splice(idx, 1)[0];
      const trial = result.concat([cand]);
      if (satisfies(trial)) {
        result.push(cand);
      }
      // If we can't add more due to constraints, break
      if (!remaining.length && result.length < count) break;
    }
    // Pad with nulls if not enough
    while (result.length < count) result.push(null);
    return result;
  }

  _render(reel, item) {
    const imgPath = item['Resized Image Path'] || item['Image Link'];
    const original = item['Image Link'] || '';
    reel.img.onerror = null; // reset previous
    reel.img.dataset.triedFallback = '0';
    reel.img.src = imgPath;
    reel.img.alt = item.Name || '';
    reel.img.onerror = () => {
      // Fallback to original, then to placeholder
      if (reel.img.dataset.triedFallback === '0' && original && original !== imgPath) {
        reel.img.dataset.triedFallback = '1';
        reel.img.src = original;
      } else {
        reel.img.onerror = null;
        const name = (item.Name || 'Unknown').replace(/&/g, '&amp;').replace(/</g, '&lt;');
        const svg = `data:image/svg+xml;utf8,${encodeURIComponent(`
          <svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'>
            <rect width='100%' height='100%' fill='#0c1020'/>
            <text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' fill='#f5c451' font-family='sans-serif' font-size='16'>${name}</text>
          </svg>
        `)}`;
        reel.img.src = svg;
      }
    };
    reel.text.textContent = item.Name || '';
  }

  _setSpinning(reel, spinning) {
    if (!reel) return;
    if (spinning) reel.el.classList.add('spinning');
    else reel.el.classList.remove('spinning');
  }

  _play(name) {
    const s = this.sounds?.[name];
    if (s) {
      try { s.currentTime = 0; s.play(); } catch {}
    }
  }

  // Seed reels with random items immediately (no sounds/animation)
  seed(opts = {}) {
    const strict = !!opts.strict;
    // Group by sourceKey to respect uniqueness rules like spin()
    const groups = new Map();
    this.reelsConfig.forEach(cfg => {
      const sourceKey = cfg.sourceKey || cfg.key;
      if (!groups.has(sourceKey)) groups.set(sourceKey, []);
      groups.get(sourceKey).push(cfg);
    });

    for (const [sourceKey, cfgs] of groups.entries()) {
      const source = this.reelData[sourceKey] || [];
      let picks = [];

      const anyGroupBy = cfgs.find(c => c.groupByField);
      if (strict && (sourceKey === 'strat')) {
        // In strict mode for stratagems, enforce constraints even during seeding
        picks = this._pickStratagemsWithConstraints(source, cfgs.length);
      } else if (anyGroupBy) {
        const field = anyGroupBy.groupByField;
        const buckets = new Map();
        source.forEach(item => {
          const key = (item[field] || '').toLowerCase();
          if (!key) return;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(item);
        });
        const keys = [...buckets.keys()];
        cfgs.forEach(() => {
          if (!keys.length) return picks.push(null);
          const k = keys.splice(Math.floor(Math.random() * keys.length), 1)[0];
          const arr = buckets.get(k) || [];
          if (!arr.length) return picks.push(null);
          picks.push(arr[Math.floor(Math.random() * arr.length)]);
        });
      } else {
        const pool = [...source];
        cfgs.forEach(() => {
          if (!pool.length) return picks.push(null);
          const i = Math.floor(Math.random() * pool.length);
          picks.push(pool.splice(i, 1)[0]);
        });
      }

      cfgs.forEach((cfg, j) => {
        const reel = this.reelEls.get(cfg.key);
        const item = picks[j];
        if (!reel || !item) return;
        this._render(reel, item);
      });
    }
  }
}
