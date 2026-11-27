/*
  Shared code for all pages: ThingSpeak channel, unit conversions,
  and the full-history download (pages backwards through ThingSpeak 8000 entries at a time).
  Load this before app.js / history.js.
*/

const CHANNEL_ID = 3580074;

const $ = (id) => document.getElementById(id);

const toC = (f) => (f - 32) * 5 / 9;
const toF = (c) => c * 9 / 5 + 32;
const hPaToInHg = (p) => p * 0.0295300;
const mphToKt = (v) => v * 0.868976;

// Dew point from temperature (C) and relative humidity (%) - Magnus formula
function dewPointC(tC, rh) {
  const a = 17.62, b = 243.12;
  const g = Math.log(rh / 100) + (a * tC) / (b + tC);
  return (b * g) / (a - g);
}

// Altimeter setting (hPa) from station pressure (hPa) and elevation (m) - NWS formula
function altimeterHpa(p, h) {
  const n = 0.190284;
  const k = Math.pow(1013.25, n) * 0.0065 / 288;
  return (p - 0.3) * Math.pow(1 + k * h / Math.pow(p - 0.3, n), 1 / n);
}

// field3 is sent in inHg. Older entries were in hPa (values ~1000), so convert those.
// Everything inside this script works in hPa.
function pressureHpa(v) {
  const n = num(v);
  if (n === null) return null;
  return n > 100 ? n : n / 0.0295300;
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function fmt(n, digits = 1) {
  return n === null || n === undefined ? "—" : n.toFixed(digits);
}

function mean(values) {
  const v = values.filter((x) => x !== null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

function maxOf(values) {
  const v = values.filter((x) => x !== null);
  return v.length ? Math.max(...v) : null;
}

// ---------- Full-history download ----------
// ThingSpeak returns at most 8000 entries per request (~44 h at one entry per 20 s),
// so this pages backwards in time until it reaches the first entry, then saves one CSV.

const PAGE_SIZE = 8000;

function tsDate(d) {          // ThingSpeak wants "YYYY-MM-DD HH:MM:SS" (UTC)
  return d.toISOString().slice(0, 19).replace("T", " ");
}

async function fetchAllFeeds(onProgress) {
  const all = [];
  let end = new Date(Date.now() + 60 * 1000);          // a little in the future
  for (let page = 0; page < 500; page++) {             // safety limit (~2.5 years)
    const url = `https://api.thingspeak.com/channels/${CHANNEL_ID}/feeds.json` +
      `?results=${PAGE_SIZE}&timezone=UTC&end=${encodeURIComponent(tsDate(end))}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const feeds = (await res.json()).feeds || [];
    if (feeds.length === 0) break;
    all.unshift(...feeds);
    onProgress(all.length);
    if (feeds.length < PAGE_SIZE) break;                // reached the first entry
    end = new Date(new Date(feeds[0].created_at).getTime() - 1000);
  }
  // remove any duplicates at page edges, oldest first
  const seen = new Set();
  return all
    .filter((f) => !seen.has(f.entry_id) && seen.add(f.entry_id))
    .sort((a, b) => a.entry_id - b.entry_id);
}

function csvCell(v) {
  return v === null || v === undefined ? "" : String(v);
}

function buildCsv(feeds) {
  const rows = [[
    "entry_id", "time_utc", "time_local", "temp_F", "rel_humidity_pct",
    "pressure_inHg", "wind_2min_avg_mph", "gust_max_5s_mph",
  ].join(",")];
  for (const f of feeds) {
    const t = new Date(f.created_at);
    const p = pressureHpa(f.field3);
    rows.push([
      f.entry_id,
      t.toISOString(),
      `"${t.toLocaleString()}"`,
      csvCell(num(f.field1)),
      csvCell(num(f.field2)),
      p === null ? "" : hPaToInHg(p).toFixed(2),
      csvCell(num(f.field4)),
      csvCell(num(f.field5)),
    ].join(","));
  }
  return rows.join("\n") + "\n";
}

async function downloadFullHistory(event) {
  event.preventDefault();
  const btn = $("download-btn");
  const label = btn.textContent;
  btn.setAttribute("aria-disabled", "true");
  btn.style.pointerEvents = "none";
  try {
    btn.textContent = "Gathering readings…";
    const feeds = await fetchAllFeeds((n) => {
      btn.textContent = `Gathering readings… ${n.toLocaleString()} so far`;
    });
    if (feeds.length === 0) {
      btn.textContent = "No readings to download";
      return;
    }
    const blob = new Blob([buildCsv(feeds)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const day = (d) => d.toISOString().slice(0, 10);
    a.download = `weather_station_${day(new Date(feeds[0].created_at))}_to_` +
                 `${day(new Date(feeds[feeds.length - 1].created_at))}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    btn.textContent = `Downloaded ${feeds.length.toLocaleString()} readings`;
  } catch (err) {
    console.error(err);
    btn.textContent = "Download failed — try again";
  } finally {
    btn.removeAttribute("aria-disabled");
    btn.style.pointerEvents = "";
    setTimeout(() => { btn.textContent = label; }, 6000);
  }
}

// Hook up the download button on any page that has one
document.getElementById("download-btn")?.addEventListener("click", downloadFullHistory);
