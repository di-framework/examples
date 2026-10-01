// biome-ignore-all lint/suspicious/noTemplateCurlyInString: packaged file text
import type { StaticAssetPackage } from '@di-framework/http';

const assets = {
  version: 1,
  generatedAt: '2026-10-01T00:00:00.000Z',
  directory: 'public',
  assets: {
    '/index.html': {
      path: '/index.html',
      contentType: 'text/html; charset=utf-8',
      size: 1646,
      hash: 'da7a0f201c72213b345968e74c0cc13bb64f3e62ba5ec57e60b5f37b315452bb',
      etag: '"da7a0f201c72213b345968e74c0cc13b"',
      content:
        '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>Mesh</title>\n    <link rel="stylesheet" href="/assets/style.css" />\n    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />\n  </head>\n  <body>\n    <header>\n      <h1>Mesh</h1>\n      <button id="refresh" type="button">Refresh</button>\n    </header>\n    <p id="status">Loading the catalog.</p>\n\n    <section>\n      <h2>Locations</h2>\n      <div id="mesh-map"></div>\n      <table id="maps">\n        <thead>\n          <tr>\n            <th>Name</th>\n            <th>Short</th>\n            <th>Latitude</th>\n            <th>Longitude</th>\n            <th>Hardware</th>\n            <th>Firmware</th>\n          </tr>\n        </thead>\n        <tbody></tbody>\n      </table>\n    </section>\n\n    <section>\n      <h2>Traffic</h2>\n      <table id="traffic">\n        <thead>\n          <tr>\n            <th>Time</th>\n            <th>Topic</th>\n            <th>Gateway</th>\n            <th>Channel</th>\n            <th>From</th>\n          </tr>\n        </thead>\n        <tbody></tbody>\n      </table>\n    </section>\n\n    <section>\n      <h2>Encrypted</h2>\n      <table id="stats">\n        <thead>\n          <tr>\n            <th>Topic</th>\n            <th>Gateway</th>\n            <th>Channel</th>\n            <th>From</th>\n            <th>Count</th>\n          </tr>\n        </thead>\n        <tbody></tbody>\n      </table>\n    </section>\n\n    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>\n    <script src="/assets/app.js"></script>\n  </body>\n</html>\n',
      encoding: 'utf-8',
    },
    '/style.css': {
      path: '/style.css',
      contentType: 'text/css; charset=utf-8',
      size: 879,
      hash: '533936762d773ad795f36799305ff3afdef86d232ac1158c6f5925bb1973798c',
      etag: '"533936762d773ad795f36799305ff3af"',
      content:
        'body {\n  margin: 0;\n  font-family: system-ui, sans-serif;\n  color: #1b2838;\n  background: #f4f7fb;\n}\n\nheader {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 1rem 1.5rem;\n  background: #16324f;\n  color: #fff;\n}\n\nh1,\nh2 {\n  margin: 0;\n}\n\nheader button {\n  background: #fff;\n  color: #16324f;\n  border: 0;\n  border-radius: 4px;\n  padding: 0.4rem 0.8rem;\n  font: inherit;\n}\n\nmain,\nsection {\n  margin: 1rem 1.5rem;\n  overflow-x: auto;\n}\n\n#status {\n  margin: 1rem 1.5rem 0;\n}\n\n#mesh-map {\n  height: 420px;\n  margin-top: 0.5rem;\n  background: #d5dee8;\n}\n\ntable {\n  width: 100%;\n  border-collapse: collapse;\n  background: #fff;\n  margin-top: 0.5rem;\n}\n\nth,\ntd {\n  text-align: left;\n  padding: 0.45rem 0.6rem;\n  border-bottom: 1px solid #d5dee8;\n  vertical-align: top;\n}\n\nth {\n  font-size: 0.85rem;\n  color: #526275;\n}\n\n.empty {\n  color: #526275;\n}\n',
      encoding: 'utf-8',
    },
    '/app.js': {
      path: '/app.js',
      contentType: 'application/javascript; charset=utf-8',
      size: 3344,
      hash: 'cd5ef3e00ec10234ac41c6f2b882eb9f166e79fcc4ba565950294584ff189593',
      etag: '"cd5ef3e00ec10234ac41c6f2b882eb9f"',
      content:
        "const status = document.querySelector('#status');\n\nfunction cell(text) {\n  const column = document.createElement('td');\n  column.textContent = text;\n  return column;\n}\n\nfunction fill(tableId, rows, render) {\n  const body = document.querySelector(`#${tableId} tbody`);\n  body.replaceChildren();\n  if (rows.length === 0) {\n    const row = document.createElement('tr');\n    const column = cell('Nothing recorded yet.');\n    column.colSpan = body.parentElement.querySelectorAll('th').length;\n    column.className = 'empty';\n    row.append(column);\n    body.append(row);\n    return;\n  }\n  for (const entry of rows) body.append(render(entry));\n}\n\nfunction row(values) {\n  const element = document.createElement('tr');\n  for (const value of values) element.append(cell(String(value)));\n  return element;\n}\n\nasync function refresh(quiet) {\n  if (!quiet) status.textContent = 'Loading the catalog.';\n  try {\n    const response = await fetch('/api/catalog', { cache: 'no-store' });\n    if (!response.ok) throw new Error(`Catalog returned ${response.status}`);\n    const catalog = await response.json();\n    fill('maps', catalog.maps ?? [], (entry) =>\n      row([\n        entry.longName,\n        entry.shortName,\n        entry.latitude,\n        entry.longitude,\n        entry.hwModel,\n        entry.firmwareVersion,\n      ]),\n    );\n    fill('traffic', catalog.traffic ?? [], (entry) =>\n      row([entry.ts, entry.topic, entry.gatewayId, entry.channelId, entry.from]),\n    );\n    fill('stats', catalog.stats ?? [], (entry) =>\n      row([entry.topic, entry.gatewayId, entry.channelId, entry.from, entry.count]),\n    );\n    plot(catalog.maps ?? []);\n    const updated = new Date().toLocaleTimeString();\n    status.textContent = quiet ? `Updated ${updated}.` : 'Catalog loaded.';\n  } catch (error) {\n    status.textContent =\n      error instanceof Error ? error.message : 'The catalog could not be loaded.';\n  }\n}\n\nlet meshMap;\nlet meshLayer;\nlet fitted = false;\n\nfunction plot(rows) {\n  if (typeof L === 'undefined') return;\n  const box = document.querySelector('#mesh-map');\n  if (!box) return;\n  if (!meshMap) {\n    meshMap = L.map(box);\n    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {\n      maxZoom: 18,\n      attribution: '&copy; OpenStreetMap',\n    }).addTo(meshMap);\n    meshLayer = L.layerGroup().addTo(meshMap);\n  }\n  meshLayer.clearLayers();\n  const latest = new Map();\n  for (const entry of rows) {\n    if (typeof entry.latitude !== 'number' || typeof entry.longitude !== 'number') continue;\n    if (entry.latitude === 0 && entry.longitude === 0) continue;\n    latest.set(`${entry.longName}\\0${entry.shortName}`, entry);\n  }\n  const bounds = [];\n  for (const entry of latest.values()) {\n    const marker = L.circleMarker([entry.latitude, entry.longitude], {\n      radius: 7,\n      color: '#16324f',\n      weight: 2,\n      fillColor: '#2f6fed',\n      fillOpacity: 0.85,\n    });\n    marker.bindTooltip(`${entry.longName} (${entry.shortName})`);\n    marker.addTo(meshLayer);\n    bounds.push([entry.latitude, entry.longitude]);\n  }\n  if (!fitted && bounds.length > 0) {\n    fitted = true;\n    meshMap.fitBounds(bounds, { padding: [24, 24], maxZoom: 6 });\n  }\n}\n\ndocument.querySelector('#refresh').addEventListener('click', () => {\n  void refresh(false);\n});\nvoid refresh(false);\nsetInterval(() => {\n  void refresh(true);\n}, 2000);\n",
      encoding: 'utf-8',
    },
  },
} as StaticAssetPackage;

export default assets;
