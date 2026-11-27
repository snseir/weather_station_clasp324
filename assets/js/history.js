/*
  Complete History page: downloads every ThingSpeak entry (via fetchAllFeeds in common.js)
  and plots it with Plotly as four stacked panels that share one time axis:
    1. Wind (2-min avg) and peak gust (5-s), mph
    2. Temperature and dew point, F
    3. Relative humidity, %
    4. Station pressure, inHg
*/

const COLOR_1 = "#257de0";   // blue   - first series in every panel
const COLOR_2 = "#f47230";   // orange - second series (gust, dew point)

const RAW_GAP_MS    = 3 * 60 * 1000;      // break the line if readings stop for > 3 min
const HOURLY_GAP_MS = 2 * 60 * 60 * 1000; // ... or for > 2 h in hourly view

let readings = [];   // cleaned readings, oldest first

// One reading per ThingSpeak entry, in display units
function toReading(f) {
  const tF = num(f.field1);
  const rh = num(f.field2);
  const p = pressureHpa(f.field3);
  return {
    t: new Date(f.created_at),
    tempF: tF,
    rh: rh,
    dewF: (tF !== null && rh !== null && rh > 0) ? toF(dewPointC(toC(tF), rh)) : null,
    inHg: p === null ? null : hPaToInHg(p),
    wind: num(f.field4),
    gust: num(f.field5),
  };
}

// Hourly bins: averages, except gust = maximum
function hourly(rows) {
  const bins = new Map();
  for (const r of rows) {
    const h = new Date(r.t);
    h.setMinutes(0, 0, 0);
    const key = h.getTime();
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(r);
  }
  return [...bins.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, rs]) => ({
      t: new Date(key + 30 * 60 * 1000),         // plot at the middle of the hour
      tempF: mean(rs.map((r) => r.tempF)),
      rh:    mean(rs.map((r) => r.rh)),
      dewF:  mean(rs.map((r) => r.dewF)),
      inHg:  mean(rs.map((r) => r.inHg)),
      wind:  mean(rs.map((r) => r.wind)),
      gust:  maxOf(rs.map((r) => r.gust)),
    }));
}

// Insert an empty point wherever there is a gap, so Plotly breaks the line there
function withGaps(rows, gapMs) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    if (i > 0 && rows[i].t - rows[i - 1].t > gapMs) {
      out.push({ t: new Date(rows[i - 1].t.getTime() + 1000) });   // all values undefined -> gap
    }
    out.push(rows[i]);
  }
  return out;
}

function series(rows, key) {
  return rows.map((r) => (r[key] === null || r[key] === undefined ? null : r[key]));
}

function draw() {
  const mode = document.querySelector('input[name="resolution"]:checked').value;
  const rows = mode === "raw"
    ? withGaps(readings, RAW_GAP_MS)
    : withGaps(hourly(readings), HOURLY_GAP_MS);
  const x = rows.map((r) => r.t);
  const raw = mode === "raw";

  const line = (name, key, color, yaxis, unit, digits, dash) => ({
    type: raw ? "scattergl" : "scatter",      // WebGL keeps 30,000+ points smooth
    mode: "lines",
    name,
    x,
    y: series(rows, key),
    yaxis,
    connectgaps: false,
    line: { color, width: 2, dash: dash || "solid" },
    hovertemplate: `%{y:.${digits}f} ${unit}<extra>${name}</extra>`,
  });

  const traces = [
    line("Wind (2-min avg)",  "wind",  COLOR_1, "y",  "mph",  1),
    line("Peak gust (5-s)",   "gust",  COLOR_2, "y",  "mph",  1, "dot"),
    line("Temperature",       "tempF", COLOR_1, "y2", "°F",   1),
    line("Dew point",         "dewF",  COLOR_2, "y2", "°F",   1, "dot"),
    line("Relative humidity", "rh",    COLOR_1, "y3", "%",    0),
    line("Pressure",          "inHg",  COLOR_1, "y4", "inHg", 2),
  ];

  const axisStyle = {
    gridcolor: "#e6e9ef",
    zeroline: false,
    linecolor: "#c9ced8",
    tickfont: { size: 11, color: "#4a4f59" },
    titlefont: { size: 12, color: "#1f2430" },
  };

  const layout = {
    grid: { rows: 4, columns: 1, pattern: "coupled", roworder: "top to bottom", ygap: 0.12 },
    height: 960,
    margin: { l: 70, r: 20, t: 70, b: 40 },
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "#ffffff",
    font: { family: "inherit", color: "#1f2430" },
    hovermode: "x unified",
    hoverlabel: { bgcolor: "#ffffff", bordercolor: "#c9ced8", font: { color: "#1f2430" } },
    legend: { orientation: "h", x: 0, y: 1.06, xanchor: "left", font: { size: 12 } },
    xaxis: {
      ...axisStyle,
      type: "date",
      rangeselector: {
        x: 0, y: 1.1, xanchor: "left",
        bgcolor: "#f3f5f9", activecolor: "#ffcb05",
        buttons: [
          { count: 1, label: "Last day",    step: "day", stepmode: "backward" },
          { count: 3, label: "Last 3 days", step: "day", stepmode: "backward" },
          { count: 7, label: "Last week",   step: "day", stepmode: "backward" },
          { step: "all", label: "All" },
        ],
      },
    },
    yaxis:  { ...axisStyle, title: { text: "Wind (mph)" }, rangemode: "tozero" },
    yaxis2: { ...axisStyle, title: { text: "Temp (°F)" } },
    yaxis3: { ...axisStyle, title: { text: "RH (%)" }, range: [0, 100] },
    yaxis4: { ...axisStyle, title: { text: "Pressure (inHg)" }, tickformat: ".2f" },
  };

  Plotly.react("history-plot", traces, layout, {
    responsive: true,
    displaylogo: false,
    modeBarButtonsToRemove: ["lasso2d", "select2d"],
    toImageButtonOptions: { filename: "weather_station_history", scale: 2 },
  });
}

async function loadHistory() {
  const status = $("history-status");
  try {
    const feeds = await fetchAllFeeds((n) => {
      status.textContent = `Loading every reading… ${n.toLocaleString()} so far`;
    });
    readings = feeds.map(toReading);
    if (readings.length === 0) {
      status.textContent = "No readings yet.";
      return;
    }
    const first = readings[0].t.toLocaleString();
    const last = readings[readings.length - 1].t.toLocaleString();
    status.textContent =
      `${readings.length.toLocaleString()} readings from ${first} to ${last}.`;
    draw();
  } catch (err) {
    console.error(err);
    status.textContent = "Could not load the history from ThingSpeak. Try refreshing the page.";
  }
}

document.querySelectorAll('input[name="resolution"]').forEach((el) =>
  el.addEventListener("change", () => readings.length && draw()));

loadHistory();
