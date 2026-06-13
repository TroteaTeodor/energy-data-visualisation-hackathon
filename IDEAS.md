# Hackathon Ideas — Energy Data Visualisation

> Brussels, 13 June 2026
> Axes: Electrification · Load Shifting & Myth Busting · Open Challenge

---

## Axe 1: Electrification — Make energy mix visible & actionable

### 1.1 "My Plug" — Personal Energy Mix Dashboard
- Real-time dashboard showing the **cost & carbon intensity** of electricity at the household level.
- Overlay the current Belgian grid mix (nuclear, gas, renewables) on hourly usage data.
- **Actionable:** Suggest the best 2-hour window for running high-consumption appliances (washing machine, EV charging) based on forecasted clean energy dips.
- **Stack:** Sibelga open data + Elia grid data + simple web dashboard (D3 / Observable Plot / Leaflet for Brussels map overlay).

### 1.2 Brussels Electrification Heatmap
- Choropleth of Brussels neighbourhoods showing **estimated electrification potential** (EV uptake, heat pump readiness, current gas connections).
- Animate over time to show the effect of subsidy policies.
- **Story:** "Your street could cut 30% CO₂ by switching to an induction cooktop."

### 1.3 Cost-of-Use Label Generator
- For every appliance in a home, generate a **"nutrition label"** showing yearly electricity cost, CO₂ footprint, and cheaper time slots.
- Compare to efficient alternatives.
- **Data:** Typical consumption profiles + real-time tariff data.

---

## Axe 2: Load Shifting & Myth Busting — Shift behaviour through data storytelling

### 2.1 Belgium Energy Reality Clock
- A 24h animated clock showing **real-time grid mix** + total load.
- Highlight peaks and explain in plain language: _"Right now 40% of our power comes from gas — here's what that costs you and the planet."_
- **Myth buster cards** that pop up when certain thresholds are hit: _"Belgian nuclear is not 24/7 baseload anymore — see how much is actually running right now."_

### 2.2 "Shift Your Peak" — Personal Challenge
- Gamified weekly challenge: shift 3 high-usage activities to off-peak hours.
- Show collective impact: _"If every Brussels household shifted laundry to 22:00, we'd save X tonnes of CO₂."_
- Visual timeline + leaderboard per neighbourhood.

### 2.3 Myth-Busting Data Cards
- Shareable visual cards debunking common Belgian energy myths:
  - _"Renewables are unreliable" → show Belgian backup + cross-border smoothing_
  - _"Nuclear is the cheapest" → show full lifecycle cost + decommissioning_
  - _"My individual action doesn't matter" → show aggregate household impact_
- **Data:** Elia transparency data + VREG price data + academic sources.

---

## Axe 3: Open Challenge — Help households reduce consumption

### 3.1 Home Energy Audit Visualiser
- Users answer 5 quick questions about their home (insulation, heating type, appliances).
- Generate an interactive **energy Sankey diagram** showing where energy flows (and leaks).
- Prioritised retrofit recommendations ranked by cost vs. savings.

### 3.2 Brussels Block-by-Block Comparison
- Anonymised comparison tool: _"Your consumption is 20% higher than similar homes in your neighbourhood."_
- Link to relevant subsidies (via Ville de Bruxelles / Sibelga data).
- **Privacy-first:** All aggregation at block level, no individual data exposed.

### 3.3 "10% by 2030" — Brussels Progress Tracker
- Track the city's progress toward the 10% reduction target in a public dashboard.
- Break down by sector (residential, tertiary, public) and by commune.
- **Story:** Animated timeline showing _"If every household does X, we hit the target by 203Y."_
- Add a **pledge widget**: _"I commit to reducing by 10% — track my street's progress."_

---

## Cross-Cutting Ideas

### Real-time Public Screens
- Design a version of any dashboard for **public screens** in libraries, community centres, and the Ville de Bruxelles buildings.
- Ultra-simple, glanceable: green/yellow/red energy status + one actionable tip.

### Brussels Energy API Wrapper
- If data access is a bottleneck, build a **unified API** that wraps Sibelga, Elia, and VREG open data into a developer-friendly format usable by all teams.

---

## Data Sources

| Source | Description |
|---|---|
| [Elia Grid Data](https://www.elia.be/en/grid-data) | Real-time generation mix, load, imports/exports |
| [Sibelga Open Data](https://opendata.sibelga.be/) | Brussels distribution grid data |
| [VREG](https://www.vreg.be/) | Flemish energy regulator prices & tariffs |
| [Brugel](https://www.brugel.brussels/) | Brussels energy regulator data |
| [Hub.brussels](https://hub.brussels/) | Open datasets on Brussels enterprises |
| [Statbel](https://statbel.fgov.be/) | National statistics (housing, demographics) |

---

## Stack Ideas

- **Frontend:** Observable Framework / D3 / SvelteKit
- **Maps:** Leaflet + OpenStreetMap
- **Backend:** Python (FastAPI) for data fetching & aggregation
- **Hosting:** GitHub Pages / Netlify
- **Data viz:** D3, Observable Plot, Chart.js, ECharts
