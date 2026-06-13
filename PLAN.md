# Brussels Energy Reality — Build Plan

> Hackathon: 13 June 2026
> Axes: Electrification · Load Shifting & Myth Busting · Open Challenge

---

## Concept

A single-page webapp showing **where Belgium's electricity comes from in real-time**, with an animated 24h clock, import/export flow map, and Brussels consumption heatmap.

## Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Bundler | **Vite** (vanilla JS/TS) | Fast scaffold, no framework overhead |
| Charts | **Chart.js** | Lightweight, animated, easy donut/gauge |
| Map | **Leaflet** + OSM tiles | Free, no API key needed |
| Deploy | **GitHub Pages** | Zero cost, instant |

## Data (100% free, no auth)

| Source | Dataset | Data |
|--------|---------|------|
| [Elia Open Data](https://opendata.elia.be/) | `ods201` | Actual generation mix by fuel type (15min) |
| Elia Open Data | `ods034` | Day-ahead generation schedule (15min) |
| Elia Open Data | `ods007` | Cross-border transfer capacity |
| Elia Open Data | Imbalance data | System imbalance + prices |
| Brugel / Sibelga | Open data portals | Brussels consumption (commune-level if available) |

API base: `https://opendata.elia.be/api/explore/v2.1/catalog/datasets/{id}/records`

CORS enabled, no API key needed.

## Views

### 1. Energy Reality Clock (main)
- Outer ring: 24h dial with hour markers, sweeping hand
- Inner donut: generation mix by fuel (Nuclear=purple, Gas=orange, Solar=yellow, Wind=teal, etc.)
- Center: total load (MW) + CO₂ g/kWh
- Below: 24h sparkline per fuel type
- Myth-busting cards triggered by thresholds

### 2. Where It Comes From
- Leaflet map of Belgium + neighbouring countries
- Flow arrows from FR/NL/DE/UK/LU sized by import MW
- Generation site markers
- Sidebar: import/export breakdown

### 3. Brussels Heatmap
- 19 communes color-coded by estimated consumption
- Population-weighted national load if no commune-level open data
- Hover tooltip with estimated MW

## 6-Hour Execution

| Block | Time | Deliverable |
|-------|------|-------------|
| 1 | 0-45min | Vite scaffold, 3-tab layout, basic CSS |
| 2 | 45min-2h | `api/elia.js` — fetch & cache all datasets |
| 3 | 2h-3h30 | Clock donut + animation + load gauge + CO₂ |
| 4 | 3h30-4h30 | Import/export flow map |
| 5 | 4h30-5h15 | Brussels heatmap + myth cards |
| 6 | 5h15-6h | Polish, responsive, deploy |
