#!/usr/bin/env node
// PixelLab (https://api.pixellab.ai) from the command line, for the game's pixel art.
//
// The key is never kept in the repo: it is read from PIXELLAB_API_KEY, else from
// ~/.pixellab/key.
//
//   node scripts/pixellab.mjs balance
//   node scripts/pixellab.mjs rotate <sheet.png> <out.png> [--crop x,y,w,h] [--from south] [--to north]
//        [--view "low top-down"] [--size 32] [--palette]   (--palette: keep to the source's own colours)
//
//   node scripts/pixellab.mjs create <out.png> --desc "..." [--size 32] [--style sheet.png --crop x,y,w,h] [--palette]
//   node scripts/pixellab.mjs object <dir> --desc "..." [--size 48] [--style-object <id>]   (the object creator: 8 sides)
//   node scripts/pixellab.mjs get-object <id or pixellab.ai/create-object/... URL> <dir>
//   node scripts/pixellab.mjs objects <dir> --style sprite.png [--crop x,y,w,h] --items "a table|a barrel|..." [--desc "..."]
//        (a pack of one-view objects in that sprite's look; objects-keep <pack id> 0,3 keeps chosen frames)
//   node scripts/pixellab.mjs style <out.png> --desc "..." --style "sheet.png:x,y,w,h;other.png"
//
// rotate turns a sprite to face another way (a pew seen from behind, a chair side-on):
// the source cell is cut from a sheet (--crop), sent at --size (16/32/64/128), and the
// answer saved as a PNG of that size. Each call spends one generation.

import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

const API = 'https://api.pixellab.ai/v2';

function key() {
    if (process.env.PIXELLAB_API_KEY) return process.env.PIXELLAB_API_KEY.trim();
    const f = path.join(os.homedir(), '.pixellab', 'key');
    if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim();
    throw new Error('No PixelLab key: set PIXELLAB_API_KEY or put it in ~/.pixellab/key');
}

async function call(method, route, body) {
    const res = await fetch(API + route, {
        method,
        headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${route}: ${res.status} ${text.slice(0, 400)}`);
    return JSON.parse(text);
}

// ── A minimal PNG reader/writer (RGBA, 8-bit, no interlace), so no image library is needed ──
function readPng(file) {
    const b = fs.readFileSync(file);
    let p = 8, w = 0, h = 0, type = 0, depth = 0, pal = null, trns = null;
    const idat = [];
    while (p < b.length) {
        const len = b.readUInt32BE(p), t = b.toString('ascii', p + 4, p + 8), d = b.subarray(p + 8, p + 8 + len);
        if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; }
        else if (t === 'PLTE') pal = d;
        else if (t === 'tRNS') trns = d;
        else if (t === 'IDAT') idat.push(d);
        p += 12 + len;
    }
    if (depth !== 8) throw new Error(`${file}: only 8-bit PNGs`);
    const ch = { 6: 4, 2: 3, 3: 1, 0: 1, 4: 2 }[type];
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = w * ch, out = Buffer.alloc(w * h * 4);
    const prev = Buffer.alloc(stride), cur = Buffer.alloc(stride);
    for (let y = 0; y < h; y++) {
        const f = raw[y * (stride + 1)];
        raw.copy(cur, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1));
        for (let i = 0; i < stride; i++) {
            const a = i >= ch ? cur[i - ch] : 0, up = prev[i], c = i >= ch ? prev[i - ch] : 0;
            const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c);
            cur[i] = (cur[i] + [0, a, up, (a + up) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? up : c][f]) & 255;
        }
        for (let x = 0; x < w; x++) {
            const o = (y * w + x) * 4, s = x * ch;
            if (type === 6) cur.copy(out, o, s, s + 4);
            else if (type === 2) { out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = 255; }
            else if (type === 3) { const k = cur[s]; out[o] = pal[k * 3]; out[o + 1] = pal[k * 3 + 1]; out[o + 2] = pal[k * 3 + 2]; out[o + 3] = trns && k < trns.length ? trns[k] : 255; }
            else if (type === 0) { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = 255; }
            else { out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = cur[s + 1]; }
        }
        cur.copy(prev);
    }
    return { w, h, data: out };
}

function crc32(buf) {
    let c, crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) {
        c = (crc ^ buf[n]) & 0xff;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function pngBuffer({ w, h, data }) {
    const chunk = (t, d) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(d.length);
        const td = Buffer.concat([Buffer.from(t, 'ascii'), d]);
        const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
        return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
    const raw = Buffer.alloc(h * (w * 4 + 1));
    for (let y = 0; y < h; y++) data.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function crop(img, x0, y0, w, h) {
    const data = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) img.data.copy(data, y * w * 4, ((y0 + y) * img.w + x0) * 4, ((y0 + y) * img.w + x0 + w) * 4);
    return { w, h, data };
}

const b64 = (img) => ({ type: 'base64', base64: pngBuffer(img).toString('base64'), format: 'png' });

function args(argv) {
    const out = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) {
            const k = argv[i].slice(2);
            const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
            out[k] = v;
        } else out._.push(argv[i]);
    }
    return out;
}

async function main() {
    const a = args(process.argv.slice(2));
    const cmd = a._[0];
    if (cmd === 'balance') {
        console.log(JSON.stringify(await call('GET', '/balance')));
        return;
    }
    if (cmd === 'rotate') {
        const [, src, out] = a._;
        if (!src || !out) throw new Error('rotate <sheet.png> <out.png> [--crop x,y,w,h] ...');
        let img = readPng(src);
        if (a.crop) { const [x, y, w, h] = String(a.crop).split(',').map(Number); img = crop(img, x, y, w, h); }
        const size = Number(a.size) || img.w;
        if (img.w !== size || img.h !== size) throw new Error(`the source must be ${size}x${size} (got ${img.w}x${img.h}); crop it to a square cell`);
        const body = {
            image_size: { width: size, height: size },
            from_image: b64(img),
            from_view: a.view || 'low top-down', to_view: a['to-view'] || a.view || 'low top-down',
            from_direction: a.from || 'south', to_direction: a.to || 'north',
        };
        if (a.palette) body.color_image = b64(img);
        if (a.seed) body.seed = Number(a.seed);
        const r = await call('POST', '/rotate', body);
        fs.writeFileSync(out, Buffer.from(r.image.base64, 'base64'));
        console.log(`saved ${out}${r.usage ? ` (${JSON.stringify(r.usage)})` : ''}`);
        return;
    }
    // create: a sprite from words, in the look of a sprite of ours (bitforge; about a generation each)
    if (cmd === 'create') {
        const [, out] = a._;
        if (!out || !a.desc) throw new Error('create <out.png> --desc "..." [--size 32] [--style sheet.png --crop x,y,w,h] ...');
        const size = Number(a.size) || 32;
        const body = {
            description: a.desc,
            image_size: { width: size, height: Number(a.height) || size },
            no_background: true,
            view: a.view || 'low top-down',
            text_guidance_scale: Number(a.guidance) || 8,
        };
        if (a.direction) body.direction = a.direction;
        if (a.neg) body.negative_description = a.neg;
        if (a.style) {
            let st = readPng(a.style);
            if (a.crop) { const [x, y, w, h] = String(a.crop).split(',').map(Number); st = crop(st, x, y, w, h); }
            body.style_image = b64(st);
            body.style_strength = Number(a.strength) || 50;
            if (a.palette) body.color_image = b64(st);
        }
        if (a.seed) body.seed = Number(a.seed);
        const r = await call('POST', '/create-image-bitforge', body);
        const img = r.image || (r.images && r.images[0]);
        fs.writeFileSync(out, Buffer.from(img.base64, 'base64'));
        console.log(`saved ${out}${r.usage ? ` (${JSON.stringify(r.usage)})` : ''}`);
        return;
    }
    // style: new art matching up to four reference sprites (Pro; a background job, waited on here)
    if (cmd === 'style') {
        const [, out] = a._;
        if (!out || !a.desc || !a.style) throw new Error('style <out.png> --desc "..." --style sheet.png[:x,y,w,h][;other.png:...]');
        const refs = String(a.style).split(';').map(s => {
            const [f, c] = s.split(':');
            let im = readPng(f);
            if (c) { const [x, y, w, h] = c.split(',').map(Number); im = crop(im, x, y, w, h); }
            return { image: b64(im), width: im.w, height: im.h };
        });
        const body = { style_images: refs, description: a.desc, no_background: true };
        if (a['style-desc']) body.style_description = a['style-desc'];
        if (a.seed) body.seed = Number(a.seed);
        const job = await call('POST', '/generate-with-style-v2', body);
        const id = job.background_job_id || job.job_id || job.id;
        let res = job;
        for (let i = 0; i < 90 && id; i++) {
            await new Promise(r => setTimeout(r, 4000));
            res = await call('GET', `/background-jobs/${id}`);
            const st = String(res.status || '').toLowerCase();
            if (/complete|success|done|finished/.test(st)) break;
            if (/fail|error|cancel/.test(st)) throw new Error(`job ${id}: ${JSON.stringify(res).slice(0, 400)}`);
        }
        // every image in the answer, wherever it sits
        const found = [];
        (function walk(o) {
            if (!o || typeof o !== 'object') return;
            if (typeof o.base64 === 'string') { found.push(o.base64); return; }
            for (const v of Object.values(o)) walk(v);
        })(res);
        if (!found.length) throw new Error(`no image in the answer: ${JSON.stringify(res).slice(0, 400)}`);
        found.forEach((b, i) => {
            const f = found.length > 1 ? out.replace(/\.png$/i, `_${i + 1}.png`) : out;
            fs.writeFileSync(f, Buffer.from(b, 'base64'));
            console.log(`saved ${f}`);
        });
        return;
    }
    // object: the object creator — one object drawn from all 8 sides (10-25 generations), saved
    // as <dir>/<direction>.png; get-object fetches one already made (in the browser or here)
    if (cmd === 'object' || cmd === 'get-object') {
        let id, dir;
        if (cmd === 'get-object') {
            [, id, dir] = a._;
            id = String(id || '').replace(/^.*\//, '');
            if (!id || !dir) throw new Error('get-object <id or create-object URL> <dir>');
        } else {
            [, dir] = a._;
            if (!dir || !a.desc) throw new Error('object <dir> --desc "..." [--size 48] [--view "low top-down"] [--style-object <id>] [--style sheet.png --crop x,y,w,h] [--colors 24]');
            const body = { description: a.desc, view: a.view || 'low top-down' };
            if (a['style-object']) body.style_object_id = String(a['style-object']).replace(/^.*\//, '');
            else if (a.style) {
                let st = readPng(a.style);
                if (a.crop) { const [x, y, w, h] = String(a.crop).split(',').map(Number); st = crop(st, x, y, w, h); }
                body.style_image = b64(st);
            } else body.size = Number(a.size) || 48;
            if (a.colors) body.target_palette = { max_colors: Number(a.colors) };
            const job = await call('POST', '/create-8-direction-object', body);
            id = job.object_id || (job.object && job.object.id) || job.id;
            console.log(`object ${id} queued`);
        }
        let o = null;
        for (let i = 0; i < 120; i++) {
            o = await call('GET', `/objects/${id}`);
            const urls = o.rotation_urls || {};
            const st = String(o.status || '').toLowerCase();
            if (/fail|error/.test(st)) throw new Error(`object ${id}: ${JSON.stringify(o).slice(0, 300)}`);
            if (Object.keys(urls).length >= (o.directions || 8) && !/pending|queued|processing|running/.test(st)) break;
            await new Promise(r => setTimeout(r, 5000));
        }
        fs.mkdirSync(dir, { recursive: true });
        for (const [d, url] of Object.entries(o.rotation_urls || {})) {
            const res = await fetch(url);
            fs.writeFileSync(path.join(dir, `${d}.png`), Buffer.from(await res.arrayBuffer()));
        }
        console.log(`"${o.name || o.prompt || id}" ${o.size ? `${o.size.width}x${o.size.height}` : ''}: ${Object.keys(o.rotation_urls || {}).join(', ')} -> ${dir}`);
        return;
    }
    // objects: a pack of single-view objects in the look of one sprite of ours (the 1-direction
    // object creator, 10-25 generations a call). A style image of ≤85px gives up to 8 (or 16)
    // objects a call, one per --items entry ("a table|a barrel|..."); every candidate is saved
    // as <dir>/<NN>_<item>.png. The pack waits in PixelLab's review until --keep "0,3" (or
    // `objects-keep <id> 0,3`) keeps those frames as objects of their own.
    if (cmd === 'objects' || cmd === 'objects-keep') {
        if (cmd === 'objects-keep') {
            const [, id, idx] = a._;
            if (!id || !idx) throw new Error('objects-keep <pack id> <0,3,...>');
            const r = await call('POST', `/objects/${id}/select-frames`, { indices: String(idx).split(',').map(Number) });
            console.log(`kept: ${(r.created_object_ids || []).join(', ')}`);
            return;
        }
        const [, dir] = a._;
        if (!dir || !a.style || !a.items) throw new Error('objects <dir> --style sheet.png [--crop x,y,w,h] --items "a|b|..." [--desc "..."] [--view top-down] [--colors 24] [--keep 0,3]');
        let st = readPng(a.style);
        if (a.crop) { const [x, y, w, h] = String(a.crop).split(',').map(Number); st = crop(st, x, y, w, h); }
        const items = String(a.items).split('|').map(s => s.trim()).filter(Boolean);
        const body = {
            description: a.desc || items.join(', '),
            view: a.view || 'top-down',
            style_images: [b64(st)],
            item_descriptions: items,
        };
        if (a.colors) body.target_palette = { max_colors: Number(a.colors) };
        const job = await call('POST', '/create-1-direction-object', body);
        const id = job.object_id;
        console.log(`pack ${id} queued (${job.n_frames || '?'} frames)${job.usage ? ` ${JSON.stringify(job.usage)}` : ''}`);
        let o = null;
        for (let i = 0; i < 180; i++) {
            await new Promise(r => setTimeout(r, 5000));
            o = await call('GET', `/objects/${id}`);
            const s = String(o.status || '').toLowerCase();
            if (/fail|error/.test(s)) throw new Error(`pack ${id}: ${JSON.stringify(o).slice(0, 300)}`);
            if (s === 'review' || s === 'completed') break;
        }
        const urls = (o.frame_urls && o.frame_urls.length) ? o.frame_urls : Object.values(o.rotation_urls || {});
        fs.mkdirSync(dir, { recursive: true });
        const slug = (s) => String(s || 'extra').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32);
        for (let i = 0; i < urls.length; i++) {
            const res = await fetch(urls[i]);
            const f = path.join(dir, `${String(i).padStart(2, '0')}_${slug(items[i])}.png`);
            fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
        }
        fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({ id, status: o.status, items, frames: urls.length }, null, 2));
        console.log(`pack ${id} (${o.status}): ${urls.length} frames -> ${dir}`);
        if (a.keep) {
            const r = await call('POST', `/objects/${id}/select-frames`, { indices: String(a.keep).split(',').map(Number) });
            console.log(`kept: ${(r.created_object_ids || []).join(', ')}`);
        }
        return;
    }
    console.log('usage: node scripts/pixellab.mjs balance | rotate <sheet.png> <out.png> [--crop x,y,w,h] [--from south] [--to north] [--view "low top-down"] [--palette]\n'
        + '  | create <out.png> --desc "..." [--size 32] [--style sheet.png --crop x,y,w,h] [--palette] [--direction north]\n'
        + '  | style <out.png> --desc "..." --style "sheet.png:x,y,w,h;other.png"\n'
        + '  | objects <dir> --style sprite.png [--crop x,y,w,h] --items "a|b|..." [--desc "..."] [--keep 0,3] | objects-keep <pack id> 0,3');
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
