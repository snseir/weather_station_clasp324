/*
  Arduino Weather Station - live data from ThingSpeak
  The station uploads one entry every 20 s:
    field1 = Temperature (F)      field2 = Humidity (%)
    field3 = Pressure (inHg)     field4 = Wind speed, 2-min average (mph)
    field5 = Peak gust in those 20 s (highest 5-second average, mph) - ASOS method
  The channel must be public for this to work without an API key.

  The cards show averages over the last 60 minutes (Peak Gust shows the maximum).
*/

const CHANNEL_ID = 3580074;
const REFRESH_MS = 20000;              // how often the page checks for new data
const TABLE_ROWS = 20;                 // rows shown in "Recent readings"
const STALE_MS   = 2 * 60 * 1000;      // warn if newest reading is older than this
const WINDOW_MS  = 60 * 60 * 1000;     // averaging window for the cards (1 hour)
const FETCH_ROWS = 200;                // > 180 entries per hour at one per 20 s

// Station elevation (meters above sea level, including the roof height).
// Needed for the altimeter setting. Leave as null until it is known.
const STATION_ELEVATION_M = 182;

const FEED_URL =
  `https://api.thingspeak.com/channels/${CHANNEL_ID}/feeds.json?results=${FETCH_ROWS}`;

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

function timeAgo(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return `${h} h ago`;
}

let lastReadingTime = null;

function updateStatus() {
  const el = $("status");
  if (!lastReadingTime) return;
  const age = Date.now() - lastReadingTime.getTime();
  const when = lastReadingTime.toLocaleString();
  el.textContent = age > STALE_MS
    ? `Station offline? Last reading ${when} (${timeAgo(age)})`
    : `Live — last reading ${when} (${timeAgo(age)})`;
}

// Cards: averages over the last 60 minutes; gust = maximum over the last 60 minutes
function updateCards(feeds) {
  const cutoff = Date.now() - WINDOW_MS;
  const hour = feeds.filter((f) => new Date(f.created_at).getTime() >= cutoff);

  const tF   = mean(hour.map((f) => num(f.field1)));
  const rh   = mean(hour.map((f) => num(f.field2)));
  const p    = mean(hour.map((f) => pressureHpa(f.field3)));
  const wind = mean(hour.map((f) => num(f.field4)));
  const gust = maxOf(hour.map((f) => num(f.field5)));

  $("hour-count").textContent = hour.length
    ? `(${hour.length} readings in the last 60 minutes.)`
    : "(No readings in the last 60 minutes.)";

  $("avg-wind").textContent = fmt(wind);
  $("avg-wind-kt").textContent = wind === null
    ? "60-min average of the 2-min wind"
    : `${fmt(mphToKt(wind))} kt · 60-min average of the 2-min wind`;

  $("max-gust").textContent = fmt(gust);
  $("max-gust-kt").textContent = gust === null
    ? "Highest 5-s average, last 60 min"
    : `${fmt(mphToKt(gust))} kt · highest 5-s average, last 60 min`;

  $("avg-temp").textContent = fmt(tF);
  $("avg-temp-c").textContent = tF === null
    ? "60-min average"
    : `${fmt(toC(tF))} °C · 60-min average`;

  $("avg-humidity").textContent = fmt(rh, 0);

  $("avg-pressure").textContent = p === null ? "—" : fmt(hPaToInHg(p), 2);
  $("avg-pressure-inhg").textContent = p === null
    ? "Station pressure, 60-min average"
    : `${fmt(p)} hPa · station pressure, 60-min average`;

  if (tF !== null && rh !== null && rh > 0) {
    const dpC = dewPointC(toC(tF), rh);
    $("avg-dewpoint").textContent = fmt(toF(dpC));
    $("avg-dewpoint-c").textContent = `${fmt(dpC)} °C · from 60-min average temp & humidity`;
  } else {
    $("avg-dewpoint").textContent = "—";
    $("avg-dewpoint-c").textContent = "From 60-min average temp & humidity";
  }

  if (p !== null && STATION_ELEVATION_M !== null) {
    const alt = altimeterHpa(p, STATION_ELEVATION_M);
    $("avg-altimeter").textContent = fmt(hPaToInHg(alt), 2);
    $("avg-altimeter-note").textContent = `${fmt(alt)} hPa · from 60-min average pressure`;
  } else {
    $("avg-altimeter").textContent = "—";
    $("avg-altimeter-note").textContent = p === null
      ? "From 60-min average pressure"
      : "Needs station elevation (set in app.js)";
  }
}

function updateTable(feeds) {
  const body = $("env-log");
  body.replaceChildren();

  const rows = feeds.slice(-TABLE_ROWS).reverse(); // newest first
  if (rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 7;
    td.textContent = "No readings yet.";
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  for (const f of rows) {
    const tF = num(f.field1);
    const rh = num(f.field2);
    const dpF = (tF !== null && rh !== null && rh > 0) ? toF(dewPointC(toC(tF), rh)) : null;

    const cells = [
      new Date(f.created_at).toLocaleString(),
      fmt(num(f.field4)),
      fmt(num(f.field5)),
      fmt(tF),
      fmt(rh, 0),
      pressureHpa(f.field3) === null ? "—" : fmt(hPaToInHg(pressureHpa(f.field3)), 2),
      fmt(dpF),
    ];

    const tr = document.createElement("tr");
    for (const c of cells) {
      const td = document.createElement("td");
      td.textContent = c;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
}

async function refresh() {
  try {
    const res = await fetch(FEED_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const feeds = (data.feeds || [])
      .filter((f) =>
        ["field1", "field2", "field3", "field4", "field5"].some((k) => num(f[k]) !== null));

    if (feeds.length > 0) {
      lastReadingTime = new Date(feeds[feeds.length - 1].created_at);
    } else {
      $("status").textContent = "No readings received yet.";
    }
    updateCards(feeds);
    updateTable(feeds);
    updateStatus();
  } catch (err) {
    $("status").textContent =
      "Could not reach ThingSpeak. Is the channel set to public?";
    console.error(err);
  }
}

refresh();
setInterval(refresh, REFRESH_MS);
setInterval(updateStatus, 5000); // keep the "x s ago" text current