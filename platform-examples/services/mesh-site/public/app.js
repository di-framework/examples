const status = document.querySelector('#status');

function cell(text) {
  const column = document.createElement('td');
  column.textContent = text;
  return column;
}

function fill(tableId, rows, render) {
  const body = document.querySelector(`#${tableId} tbody`);
  body.replaceChildren();
  if (rows.length === 0) {
    const row = document.createElement('tr');
    const column = cell('Nothing recorded yet.');
    column.colSpan = body.parentElement.querySelectorAll('th').length;
    column.className = 'empty';
    row.append(column);
    body.append(row);
    return;
  }
  for (const entry of rows) body.append(render(entry));
}

function row(values) {
  const element = document.createElement('tr');
  for (const value of values) element.append(cell(String(value)));
  return element;
}

async function refresh(quiet) {
  if (!quiet) status.textContent = 'Loading the catalog.';
  try {
    const response = await fetch('/api/catalog', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Catalog returned ${response.status}`);
    const catalog = await response.json();
    fill('maps', catalog.maps ?? [], (entry) =>
      row([
        entry.longName,
        entry.shortName,
        entry.latitude,
        entry.longitude,
        entry.hwModel,
        entry.firmwareVersion,
      ]),
    );
    fill('traffic', catalog.traffic ?? [], (entry) =>
      row([entry.ts, entry.topic, entry.gatewayId, entry.channelId, entry.from]),
    );
    fill('stats', catalog.stats ?? [], (entry) =>
      row([entry.topic, entry.gatewayId, entry.channelId, entry.from, entry.count]),
    );
    plot(catalog.maps ?? []);
    const updated = new Date().toLocaleTimeString();
    status.textContent = quiet ? `Updated ${updated}.` : 'Catalog loaded.';
  } catch (error) {
    status.textContent =
      error instanceof Error ? error.message : 'The catalog could not be loaded.';
  }
}

let meshMap;
let meshLayer;
let fitted = false;

function plot(rows) {
  if (typeof L === 'undefined') return;
  const box = document.querySelector('#mesh-map');
  if (!box) return;
  if (!meshMap) {
    meshMap = L.map(box);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap',
    }).addTo(meshMap);
    meshLayer = L.layerGroup().addTo(meshMap);
  }
  meshLayer.clearLayers();
  const latest = new Map();
  for (const entry of rows) {
    if (typeof entry.latitude !== 'number' || typeof entry.longitude !== 'number') continue;
    if (entry.latitude === 0 && entry.longitude === 0) continue;
    latest.set(`${entry.longName}\0${entry.shortName}`, entry);
  }
  const bounds = [];
  for (const entry of latest.values()) {
    const marker = L.circleMarker([entry.latitude, entry.longitude], {
      radius: 7,
      color: '#16324f',
      weight: 2,
      fillColor: '#2f6fed',
      fillOpacity: 0.85,
    });
    marker.bindTooltip(`${entry.longName} (${entry.shortName})`);
    marker.addTo(meshLayer);
    bounds.push([entry.latitude, entry.longitude]);
  }
  if (!fitted && bounds.length > 0) {
    fitted = true;
    meshMap.fitBounds(bounds, { padding: [24, 24], maxZoom: 6 });
  }
}

document.querySelector('#refresh').addEventListener('click', () => {
  void refresh(false);
});
void refresh(false);
setInterval(() => {
  void refresh(true);
}, 2000);
