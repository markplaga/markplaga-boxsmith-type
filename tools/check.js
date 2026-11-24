#!/usr/bin/env node
'use strict';
/* Checks every box type in types/ with Boxsmith, and (with --write) builds index.json and the previews.

   node tools/check.js [--boxsmith <folder>] [--write] [--no-previews] [type-id …]

   --boxsmith  a checkout of https://github.com/markplaga/Boxsmith (default: ./boxsmith, then ../Boxsmith)
   --write     write index.json and types/<id>/preview.png (previews need Chrome; see boxsmith-node.js)

   For each type it checks the folder (types/<id>/type.json, nothing but type.json, preview.png and README.md),
   the JSON Schema, Boxsmith's own validator, and then builds it in 3D at many settings: small and large
   sizes, thick material, inside measurements, every corner style, screws, and every setting of its own
   at its smallest, largest and each choice. Any problem fails the check (exit code 1). */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flag = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const option = name => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const WRITE = flag('--write'), NO_PREVIEWS = flag('--no-previews');
const BOXSMITH = path.resolve(option('--boxsmith') || [path.join(ROOT, 'boxsmith'), path.join(ROOT, '..', 'Boxsmith'), path.join(ROOT, '..', 'boxsmith')].find(d => fs.existsSync(path.join(d, 'boxsmith-node.js'))) || 'boxsmith');
const ONLY = args;
const ALLOWED_FILES = new Set(['type.json', 'preview.png', 'README.md']);
const MAX_BYTES = 200 * 1024;

const out = { problems: 0 };
const say = (id, text) => console.log((id ? id + ': ' : '') + text);
const fail = (id, text) => { out.problems++; console.log('✗ ' + (id ? id + ': ' : '') + text); };

// the settings to build each type at
function settingsFor(def, defaults) {
  const list = [
    ['the defaults', {}],
    ['a small box (60 × 50 × 40 mm)', { W: 60, D: 50, H: 40 }],
    ['a large box (400 × 300 × 250 mm)', { W: 400, D: 300, H: 250 }],
    ['6 mm material', { t: 6, fw: 12 }],
    ['inside measurements', { dimMode: 'inside' }],
    ['edge corners', { corners: 'edge' }],
    ['pinwheel corners', { corners: 'pinwheel' }],
  ];
  if (def.screws !== false) list.push(['M3 screw joints', { tslot: 'M3', t: 6, fw: 14 }]);
  for (const p of def.params || []) {
    const std = Object.prototype.hasOwnProperty.call(defaults, p.key);
    const set = v => std ? { [p.key]: v } : { typeParams: { [def.id]: { [p.key]: v } } };
    const values = [];
    if (p.kind === 'bool') values.push(!p.default);
    else if (p.kind === 'choice') for (const c of p.choices) { const v = c.value ?? c; if (v !== p.default) values.push(v); }
    else if (['length', 'number', 'integer'].includes(p.kind)) { if (p.min !== undefined) values.push(p.min); if (p.max !== undefined) values.push(p.max); }
    for (const v of values) list.push([p.key + ' = ' + JSON.stringify(v), set(v)]);
  }
  return list;
}

async function main() {
  if (!fs.existsSync(path.join(BOXSMITH, 'boxsmith-node.js'))) {
    console.error('Boxsmith was not found. Clone https://github.com/markplaga/Boxsmith into ./boxsmith, or pass --boxsmith <folder>.');
    process.exit(2);
  }
  const { load } = require(path.join(BOXSMITH, 'boxsmith-node.js'));
  let Ajv;
  try { Ajv = require('ajv/dist/2020'); } catch (e) { console.error('Run npm install first (ajv is missing).'); process.exit(2); }
  const schema = JSON.parse(fs.readFileSync(path.join(BOXSMITH, 'boxsmith-type.schema.json'), 'utf8'));
  const validateSchema = new Ajv({ allErrors: true, strict: false }).compile(schema);
  const B = await load({ dir: BOXSMITH });
  const defaults = B.boxes.defaults('closed');
  const builtIn = new Set(B.boxes.list().map(t => t.id));

  const typesDir = path.join(ROOT, 'types');
  const folders = fs.existsSync(typesDir) ? fs.readdirSync(typesDir).filter(f => fs.statSync(path.join(typesDir, f)).isDirectory()).sort() : [];
  for (const f of fs.existsSync(typesDir) ? fs.readdirSync(typesDir) : []) if (!folders.includes(f)) fail('', 'types/' + f + ' should be a folder (types/<id>/type.json).');
  const index = [];
  const seen = new Set();

  for (const id of folders) {
    if (ONLY.length && !ONLY.includes(id)) continue;
    const dir = path.join(typesDir, id), file = path.join(dir, 'type.json');
    const before = out.problems;
    for (const f of fs.readdirSync(dir)) if (!ALLOWED_FILES.has(f)) fail(id, 'types/' + id + '/' + f + ' is not allowed here (only type.json, preview.png and README.md).');
    if (!fs.existsSync(file)) { fail(id, 'types/' + id + '/type.json is missing.'); continue; }
    const text = fs.readFileSync(file, 'utf8');
    if (Buffer.byteLength(text) > MAX_BYTES) { fail(id, 'type.json is over ' + MAX_BYTES / 1024 + ' KB.'); continue; }
    let def;
    try { def = JSON.parse(text); } catch (e) { fail(id, 'type.json is not valid JSON: ' + e.message); continue; }
    if (def.id !== id) fail(id, 'the folder name must be the type\'s id ("' + def.id + '").');
    if (builtIn.has(def.id)) fail(id, '"' + def.id + '" is a built-in Boxsmith style.');
    if (seen.has(def.id)) fail(id, 'two types use the id "' + def.id + '".');
    seen.add(def.id);
    for (const k of ['author', 'typeVersion', 'description']) if (!def[k]) fail(id, 'please give "' + k + '" (shared types need it).');
    if (!validateSchema(def)) for (const e of validateSchema.errors.slice(0, 10)) fail(id, 'schema: ' + (e.instancePath || '/') + ' ' + e.message);
    const v = B.types.validate(def);
    if (!v.ok) { for (const e of v.errors) fail(id, (e.path ? e.path + ': ' : '') + e.message); continue; }

    // build it at every setting
    let first = null;
    for (const [label, settings] of settingsFor(def, defaults)) {
      let r;
      try { r = B.types.check(def, settings); }
      catch (e) { fail(id, 'with ' + label + ': ' + e.message); continue; }
      // a type may decline a size it can't make, as long as it says why
      const noParts = r.errors.length === 1 && /makes no parts/.test(r.errors[0].message);
      if (noParts && r.warnings.length) { say(id, 'with ' + label + ': makes nothing (it warns: ' + r.warnings[0].message + ')'); continue; }
      for (const e of r.errors) fail(id, 'with ' + label + ': ' + (e.path ? e.path + ': ' : '') + e.message);
      if (!first && r.ok) first = r;
    }
    if (out.problems === before) {
      say(id, '✓ fits at every setting' + (first ? ' (' + first.parts + ' parts at the defaults)' : ''));
      const preview = path.join(dir, 'preview.png');
      if (WRITE && !NO_PREVIEWS) {
        try {
          B.types.register(def);
          const pic = await B.design.render({ type: def.id }, { width: 800, height: 600, background: '#ffffff' });
          fs.writeFileSync(preview, pic.png);
          B.types.unregister(def.id);
          say(id, 'preview written');
        } catch (e) { fail(id, 'the preview could not be drawn: ' + e.message); }
      }
      index.push({
        id: def.id, name: def.name, description: def.description || '', author: def.author || '', typeVersion: def.typeVersion || '',
        license: def.license || '', icon: def.icon || '',
        file: 'types/' + id + '/type.json', preview: fs.existsSync(preview) ? 'types/' + id + '/preview.png' : null,
        readme: fs.existsSync(path.join(dir, 'README.md')) ? 'types/' + id + '/README.md' : null,
        params: (def.params || []).map(p => p.label),
        parts: first ? first.parts : null
      });
    }
  }
  B.close();

  if (WRITE && !ONLY.length) {
    const file = { format: 'boxsmith-type-index', version: 1, repo: 'markplaga/markplaga-boxsmith-type', types: index };
    const next = JSON.stringify(file, null, 2) + '\n';
    const target = path.join(ROOT, 'index.json');
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== next) { fs.writeFileSync(target, next); say('', 'index.json written (' + index.length + ' types)'); }
    // the gallery in README.md, between the markers
    const readme = path.join(ROOT, 'README.md'), md = fs.readFileSync(readme, 'utf8');
    const A = '<!-- gallery:start -->', Z = '<!-- gallery:end -->';
    if (md.includes(A) && md.includes(Z)) {
      const esc = t => String(t).replace(/\|/g, '\\|').replace(/</g, '&lt;');
      const rows = index.map(t => '| ' + (t.preview ? '<img src="' + t.preview + '" width="200" alt="">' : '') + ' | **' + esc(t.name) + '**<br>`' + t.id + '`<br>' + esc(t.description)
        + (t.params.length ? '<br>Settings: ' + esc(t.params.join(', ')) : '') + ' | ' + esc(t.author) + (t.typeVersion ? '<br>v' + esc(t.typeVersion) : '') + ' | [type.json](' + t.file + ') |');
      const table = index.length ? '| | Style | By | File |\n| --- | --- | --- | --- |\n' + rows.join('\n') : '_No types yet._';
      const next2 = md.slice(0, md.indexOf(A) + A.length) + '\n' + table + '\n' + md.slice(md.indexOf(Z));
      if (next2 !== md) { fs.writeFileSync(readme, next2); say('', 'README gallery updated'); }
    }
  }
  console.log(out.problems ? '\n' + out.problems + ' problem' + (out.problems > 1 ? 's' : '') + ' found.' : '\nAll ' + index.length + ' types pass.');
  process.exit(out.problems ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
