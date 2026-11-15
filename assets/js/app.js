/*
  Arduino Weather Station - live data from ThingSpeak
  Channel fields: field1 = Temperature (C), field2 = Humidity (%)
  The channel must be public for this to work without an API key.
*/

const CHANNEL_ID = 3580074;
const REFRESH_MS = 20000;   // how often the page checks for new data
const TABLE_ROWS = 20;      // rows shown in "Recent readings"
const STALE_MS   = 2 * 60 * 1000; // warn if newest reading is older than this

const FEED_URL =
  `https://api.thingspeak.com/channels/${CHANNEL_ID}/feeds.json?results=${TABLE_ROWS}`;

const $ = (id) => document.getElementById(id);

function toF(c) {
  return c * 9 / 5 + 32;
}

// Dew point from temperature (C) and relative humidity (%) - Magnus formula
function dewPoint(tC, rh) {
  const a = 17.62, b = 243.12;
  const g = Math.log(rh / 100) + (a * tC) / (b + tC);
  return (b * g) / (a - g);
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function fmt(n, digits = 1) {
  return n === null ? "—" : n.toFixed(digits);
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

function updateCards(latest) {
  const t = num(latest.field1);
  const h = num(latest.field2);

  $("live-temp").textContent = fmt(t);
  $("live-temp-f").textContent = t === null ? "" : `${fmt(toF(t))} °F`;

  $("live-humidity").textContent = fmt(h, 0);

  if (t !== null && h !== null && h > 0) {
    const dp = dewPoint(t, h);
    $("live-dewpoint").textContent = fmt(dp);
    $("live-dewpoint-f").textContent = `${fmt(toF(dp))} °F`;
  } else {
    $("live-dewpoint").textContent = "—";
    $("live-dewpoint-f").textContent = "";
  }
}

function updateTable(feeds) {
  const body = $("env-log");
  body.replaceChildren();

  const rows = feeds.slice().reverse(); // newest first
  if (rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.textContent = "No readings yet.";
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  for (const f of rows) {
    const t = num(f.field1);
    const h = num(f.field2);
    const dp = (t !== null && h !== null && h > 0) ? dewPoint(t, h) : null;

    const cells = [
      new Date(f.created_at).toLocaleString(),
      fmt(t),
      fmt(h, 0),
      "—",          // pressure: no sensor yet
      fmt(dp),
      "—",          // altimeter: needs pressure
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
    const feeds = (data.feeds || []).filter(
      (f) => num(f.field1) !== null || num(f.field2) !== null
    );

    if (feeds.length > 0) {
      const latest = feeds[feeds.length - 1];
      lastReadingTime = new Date(latest.created_at);
      updateCards(latest);
    } else {
      $("status").textContent = "No readings received yet.";
    }
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