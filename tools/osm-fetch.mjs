// Downloads what tools/osm-city.mjs needs for a city from OpenStreetMap (Overpass API):
// streets, footways, buildings, parks, water, railways, signals and crossings, named
// places. The data is © OpenStreetMap contributors (ODbL): a game made from it says so in
// its credits.
//   node tools/osm-fetch.mjs <south,west,north,east> <out.json> [--server https://…/api/interpreter]
// Zaragoza inside the ring roads: 41.620,-0.935,41.685,-0.855
import fs from 'node:fs';

const [bboxArg, out] = process.argv.slice(2);
if (!bboxArg || !out) {
  console.error('usage: node tools/osm-fetch.mjs <south,west,north,east> <out.json>');
  process.exit(1);
}
const at = process.argv.indexOf('--server');
const server = at > 0 ? process.argv[at + 1] : 'https://overpass-api.de/api/interpreter';
const bbox = bboxArg.split(',').map(Number);
if (bbox.length !== 4 || bbox.some(Number.isNaN)) { console.error('bad bbox'); process.exit(1); }
const b = bbox.join(',');
const query = `[out:json][timeout:600][maxsize:1073741824];
(
  way["highway"](${b});
  way["building"](${b});
  way["building:part"](${b});
  way["landuse"](${b});
  way["leisure"](${b});
  way["natural"](${b});
  way["waterway"](${b});
  way["railway"](${b});
  way["amenity"="parking"](${b});
  way["place"="square"](${b});
  relation["natural"="water"](${b});
  relation["waterway"="riverbank"](${b});
  relation["landuse"](${b});
  relation["leisure"="park"](${b});
  relation["building"](${b});
  node["highway"~"traffic_signals|crossing"](${b});
  node["tourism"](${b});
  node["historic"](${b});
  way["tourism"](${b});
  way["historic"](${b});
);
out body;
>;
out skel qt;`;

const t0 = Date.now();
console.log(`asking ${server} for ${b}…`);
const res = await fetch(server, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'luma32-osm-city/1.0 (game map importer)', accept: 'application/json' },
  body: 'data=' + encodeURIComponent(query),
});
if (!res.ok) { console.error(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`); process.exit(1); }
const text = await res.text();
fs.writeFileSync(out, text);
const data = JSON.parse(text);
console.log(`${data.elements.length} elements, ${(text.length / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s → ${out}`);
