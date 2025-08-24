export async function loadCsv(path) {
  const resp = await fetch(path, { cache: 'no-cache' });
  if (!resp.ok) throw new Error(`Failed to load CSV: ${path}`);
  const text = await resp.text();
  return parseCsv(text);
}

// Simple CSV parser for well-formed CSV (quotes supported)
export function parseCsv(text) {
  const lines = splitCsvLines(text.trim());
  const headers = parseCsvRow(lines.shift());
  const rows = lines.map(line => {
    const cols = parseCsvRow(line);
    const obj = {};
    headers.forEach((h, i) => obj[h] = cols[i] ?? '');
    return obj;
  });
  return rows;
}

function splitCsvLines(text) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      const next = text[i + 1];
      if (inQuotes && next === '"') { // escaped quote
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === '\n' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out.filter(Boolean);
}

function parseCsvRow(line) {
  const cols = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') { // escaped quote
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cols.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols.map(v => v.trim());
}
