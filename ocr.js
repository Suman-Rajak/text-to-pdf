/* =========================================================
   Image → text (OCR) for English and Bengali
   ---------------------------------------------------------
   Uses Tesseract.js (LSTM "best" integer models), loaded only
   when the user opens an image. Accuracy steps:
   1. Pre-process: grayscale + rescale into Tesseract's sweet spot.
   2. Recognise with Bengali + English together, auto-deskewed.
   3. Also read a lighting-corrected copy and a second scale, and
      keep whichever reading Tesseract is most confident about.
      Dark-mode screenshots are inverted first. Each line is taken
      from whichever version read it most confidently.
   4. The combined model sometimes turns a Bengali word into
      low-confidence Latin garbage; such words (and other very
      uncertain words) are re-read with the Bengali-only model.
   5. Drop screenshot clutter (status bar, icons), read tables
      cell by cell, clean up (danda, known Bengali confusions) and
      re-flow wrapped lines into paragraphs.
   ========================================================= */
(function () {
    'use strict';

    const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
    const MAX_SIDE = 4200;          // larger images are slow without helping accuracy
    const TARGET_SIDE = 2400;       // small images are enlarged towards this
    const MAX_UPSCALE = 3;

    const BENGALI = /[ঀ-৿]/;
    const LATIN = /[A-Za-z]/;

    let libPromise = null;
    let workers = {};

    function loadLib() {
        if (window.Tesseract) return Promise.resolve(window.Tesseract);
        if (!libPromise) {
            libPromise = new Promise((resolve, reject) => {
                const s = document.createElement('script');
                s.src = TESSERACT_URL;
                s.onload = () => (window.Tesseract ? resolve(window.Tesseract) : reject(new Error('OCR library failed to load.')));
                s.onerror = () => { libPromise = null; reject(new Error('Could not load the OCR engine. Please check your internet connection.')); };
                document.head.appendChild(s);
            });
        }
        return libPromise;
    }

    let progressHandler = null;
    const report = (stage, p) => { if (progressHandler) progressHandler(stage, p); };

    async function getWorker(key) {
        if (!workers[key]) {
            workers[key] = (async () => {
                const T = await loadLib();
                const langs = key === 'ben' ? ['ben'] : ['ben', 'eng'];
                const w = await T.createWorker(langs, T.OEM ? T.OEM.LSTM_ONLY : 1, {
                    logger: (m) => {
                        if (m.status === 'recognizing text') report('recognize', m.progress);
                        else if (/loading|initializ/i.test(m.status)) report('load', m.progress);
                    },
                });
                await w.setParameters({ user_defined_dpi: '300', preserve_interword_spaces: '0' });
                return w;
            })().catch((err) => { delete workers[key]; throw err; });
        }
        return workers[key];
    }

    function terminate() {
        const all = Object.values(workers);
        workers = {};
        all.forEach((p) => p.then((w) => w.terminate()).catch(() => { }));
    }

    // ---------------------------------------------------------------
    // Image pre-processing
    // ---------------------------------------------------------------
    async function decode(file) {
        if (window.createImageBitmap) {
            try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fall through */ }
        }
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This image format is not supported.')); };
            img.src = url;
        });
    }

    // Even out uneven lighting/shadows: divide by an estimate of the paper background.
    function flatten(ctx, w, h) {
        const data = ctx.getImageData(0, 0, w, h);
        const px = data.data;
        const k = Math.max(8, Math.round(Math.max(w, h) / 60));     // cell size
        const gw = Math.ceil(w / k), gh = Math.ceil(h / k);
        const cell = new Float32Array(gw * gh);
        for (let gy = 0; gy < gh; gy++) {                          // brightest pixel per cell ≈ paper
            for (let gx = 0; gx < gw; gx++) {
                let m = 0;
                const x1 = Math.min(w, (gx + 1) * k), y1 = Math.min(h, (gy + 1) * k);
                for (let y = gy * k; y < y1; y += 2) for (let x = gx * k; x < x1; x += 2) {
                    const v = px[(y * w + x) * 4];
                    if (v > m) m = v;
                }
                cell[gy * gw + gx] = m;
            }
        }
        const bg = new Float32Array(gw * gh);                      // smooth with a 3x3 mean
        for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
            let s = 0, n = 0;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const yy = gy + dy, xx = gx + dx;
                if (yy >= 0 && yy < gh && xx >= 0 && xx < gw) { s += cell[yy * gw + xx]; n++; }
            }
            bg[gy * gw + gx] = Math.max(1, s / n);
        }
        for (let y = 0; y < h; y++) {                              // bilinear background, divide
            const fy = Math.min(gh - 1, Math.max(0, y / k - 0.5));
            const y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
            for (let x = 0; x < w; x++) {
                const fx = Math.min(gw - 1, Math.max(0, x / k - 0.5));
                const x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
                const b = (bg[y0 * gw + x0] * (1 - tx) + bg[y0 * gw + x1] * tx) * (1 - ty) +
                    (bg[y1 * gw + x0] * (1 - tx) + bg[y1 * gw + x1] * tx) * ty;
                const i = (y * w + x) * 4;
                const v = Math.min(255, (px[i] / b) * 255);
                px[i] = px[i + 1] = px[i + 2] = v;
            }
        }
        ctx.putImageData(data, 0, 0);
    }

    function toCanvas(img, scale, flat) {
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#fff';                       // transparent PNGs → white paper
        ctx.fillRect(0, 0, w, h);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h);
        const px = data.data;
        const hist = new Uint32Array(256);
        for (let i = 0; i < px.length; i += 4) {       // luminance grayscale
            const y = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
            px[i] = px[i + 1] = px[i + 2] = y;
            hist[y]++;
        }
        // Dark mode (light text on a dark background): invert so the text is dark on light,
        // which is what Tesseract is trained on.
        let count = 0, med = 0;
        const half = (px.length / 4) / 2;
        while (med < 255 && (count += hist[med]) < half) med++;
        if (med < 110) {
            for (let i = 0; i < px.length; i += 4) px[i] = px[i + 1] = px[i + 2] = 255 - px[i];
        }
        ctx.putImageData(data, 0, 0);
        if (flat) flatten(ctx, w, h);
        return c;
    }

    function chooseScales(img) {
        const side = Math.max(img.width, img.height);
        let primary = 1;
        if (side > MAX_SIDE) primary = MAX_SIDE / side;
        else if (side < TARGET_SIDE) primary = Math.min(MAX_UPSCALE, TARGET_SIDE / side);
        // Alternative scale for the second attempt.
        let alt = primary > 1.2 ? 1 : Math.min(2, MAX_SIDE / side);
        if (Math.abs(alt - primary) < 0.3) alt = Math.min(primary * 1.6, MAX_SIDE / side);
        return { primary, alt: Math.abs(alt - primary) < 0.3 ? null : alt };
    }

    // ---------------------------------------------------------------
    // Result helpers
    // ---------------------------------------------------------------
    function linesOf(data) {
        const out = [];
        for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) out.push(l);
        return out;
    }

    function score(words) {
        let s = 0, n = 0;
        for (const w of words) {
            const len = Math.max(1, Array.from(w.text || '').length);
            s += (w.confidence || 0) * len;
            n += len;
        }
        return n ? s / n : 0;
    }

    function meanConfidence(data) {
        const words = [];
        linesOf(data).forEach((l) => words.push(...(l.words || [])));
        return words.length ? score(words) : 0;
    }

    const BN_LETTER = /[\u0985-\u09B9\u09BC-\u09D7\u09DC-\u09DF]/;
    // Latin letters or ASCII digits and no Bengali letters (Bengali digits allowed, e.g. "6২৮২1").
    const isLatinWord = (w) => /[A-Za-z0-9]/.test(w.text) && !BN_LETTER.test(w.text);

    // In a line that is mostly Bengali, a Latin word is only trusted when the model is very sure,
    // and any very uncertain word gets a second opinion from the Bengali-only model.
    const mostlyBengali = (words) => words.filter((w) => BENGALI.test(w.text)).length >= words.length * 0.6;

    function suspiciousWords(line) {
        const words = line.words || [];
        const bn = mostlyBengali(words);
        const limit = bn ? 85 : 65;
        return words.filter((w) => (isLatinWord(w) && w.confidence < limit) || (bn && w.confidence < 60));
    }

    // Replace low-confidence Latin words in Bengali text by the Bengali-only model's reading.
    function repairBengali(combined, benOnly) {
        const benLines = linesOf(benOnly);
        let changed = 0;
        for (const line of linesOf(combined)) {
            const words = line.words || [];
            const suspicious = suspiciousWords(line);
            if (!suspicious.length) continue;
            const bnLine = mostlyBengali(words);
            const y0 = line.bbox.y0, y1 = line.bbox.y1;
            const alt = [];
            for (const l of benLines) {
                const cy = (l.bbox.y0 + l.bbox.y1) / 2;
                if (cy >= y0 && cy <= y1) alt.push(...(l.words || []));
            }
            if (!alt.length) continue;
            // Group words from both readings that overlap horizontally.
            const items = words.map((w) => ({ w, src: 'c' })).concat(alt.map((w) => ({ w, src: 'b' })))
                .sort((a, b) => a.w.bbox.x0 - b.w.bbox.x0);
            const groups = [];
            let cur = null, end = -Infinity;
            for (const it of items) {
                if (cur && it.w.bbox.x0 < end - 2) { cur.push(it); end = Math.max(end, it.w.bbox.x1); }
                else { cur = [it]; groups.push(cur); end = it.w.bbox.x1; }
            }
            const result = [];
            for (const g of groups) {
                const c = g.filter((i) => i.src === 'c').map((i) => i.w);
                const b = g.filter((i) => i.src === 'b').map((i) => i.w);
                const bad = c.filter((w) => suspicious.includes(w));
                if (bad.length && b.length && b.some((w) => BENGALI.test(w.text))) {
                    const sb = score(b), sc = score(bad);
                    const latin = bad.some(isLatinWord);
                    if (latin ? (sb >= 30 || sb > sc || (bnLine && sc < 50)) : sb > sc + 5) {
                        b.forEach((w) => { w.repaired = true; });
                        result.push(...b); changed++; continue;
                    }
                }
                result.push(...c);
            }
            line.words = result;
        }
        return changed;
    }

    // Per-line choice between readings of differently pre-processed copies of the image.
    function fuseLines(base, others) {
        const norm = (b, f) => ({ x0: b.x0 * f, x1: b.x1 * f, y0: b.y0 * f, y1: b.y1 * f });
        const otherLines = others.map((r) => ({ r, lines: linesOf(r.data).filter((l) => (l.words || []).length) }));
        for (const line of linesOf(base.data)) {
            if (!(line.words || []).length) continue;
            const lb = norm(line.bbox, 1 / base.scale);
            let best = null, bestScore = score(line.words);
            for (const { r, lines } of otherLines) {
                const matches = lines.filter((m) => {
                    const mb = norm(m.bbox, 1 / r.scale);
                    const cy = (mb.y0 + mb.y1) / 2;
                    const overlap = Math.min(lb.x1, mb.x1) - Math.max(lb.x0, mb.x0);
                    return cy >= lb.y0 && cy <= lb.y1 && overlap > 0.6 * Math.min(lb.x1 - lb.x0, mb.x1 - mb.x0);
                });
                if (matches.length !== 1) continue;                 // ambiguous line split → leave it
                const sc = score(matches[0].words);
                if (sc > bestScore + 2) { best = { line: matches[0], f: base.scale / r.scale }; bestScore = sc; }
            }
            if (best) {
                line.words = best.line.words.map((w) => Object.assign({}, w, { bbox: norm(w.bbox, best.f) }));
                line.bbox = norm(best.line.bbox, best.f);
            }
        }
    }

    // ---------------------------------------------------------------
    // Text reconstruction & clean-up
    // ---------------------------------------------------------------
    const BN_WORD_FIXES = [
        [/এঁক্য/g, 'ঐক্য'], [/(^|\s)ঁক্য/g, '$1ঐক্য'], [/এঁতিহ্য/g, 'ঐতিহ্য'], [/এঁতিহাসিক/g, 'ঐতিহাসিক'],
        [/এঁশ্বর্য/g, 'ঐশ্বর্য'], [/এঁচ্ছিক/g, 'ঐচ্ছিক'], [/এঁকমত্য/g, 'ঐকমত্য'],
    ];

    function cleanLine(t) {
        t = t.replace(/৷/g, '।');                                    // ৷ (currency sign) misread for danda
        t = t.replace(/([ঀ-৿‌‍])[ \t]*[|।][ \t]*[|।]/g, '$1॥'); // double danda
        t = t.replace(/([ঀ-৿‌‍])[ \t]*[|।]/g, '$1।');           // pipe → danda, no space before it
        t = t.replace(/[ \t]+([,;:?!])(?=\s|$)/g, '$1');
        t = t.replace(/([০-৯0-9]{1,3}[.)])(?=[\u0985-\u09B9\u09DC-\u09DF])/g, '$1 '); // "১.মডেল" → "১. মডেল"
        t = t.replace(/(^|\s)['`‘](?=[\u0985-\u09B9])/g, '$1');                       // stray quote before a word
        t = t.replace(/^[*·•●▪]\s+/, '• ');                                             // bullets
        for (const [re, rep] of BN_WORD_FIXES) t = t.replace(re, rep);
        return t.replace(/[ \t]{2,}/g, ' ').trim();
    }

    const quantile = (arr, q) => {
        if (!arr.length) return 0;
        const a = arr.slice().sort((x, y) => x - y);
        return a[Math.floor((a.length - 1) * q)];
    };
    const median = (arr) => quantile(arr, 0.5);

    const charCount = (t) => Array.from(t).filter((c) => !/\s/.test(c)).length;
    const hasLetter = (t) => /\p{L}/u.test(t);

    // Screenshots contain icons, status bars, etc. that OCR turns into junk "words".
    function isJunkWord(w) {
        const t = (w.text || '').trim();
        if (!t) return true;
        if (!hasLetter(t) && !/[0-9০-৯]/.test(t)) {
            return /^\p{S}+$/u.test(t) && w.confidence < 90;       // icon-like symbols (©, =, @); keep punctuation
        }
        return !w.repaired && w.confidence < 30 && charCount(t) <= 2;   // tiny low-confidence fragments
    }

    function prepareLines(data, height) {
        const lines = [];
        for (const block of data.blocks || []) {
            for (const p of block.paragraphs || []) {
                for (const l of p.lines || []) {
                    const words = (l.words || []).filter((w) => (w.text || '').trim());
                    if (!words.length) continue;
                    const kept = words.filter((w) => !isJunkWord(w));
                    if (!kept.length) continue;
                    // Very low confidence overall, or mostly junk → status bar / icons, not text.
                    const lineScore = score(words);
                    if (lineScore < 50 || (lineScore < 65 && kept.length <= words.length / 2)) continue;
                    if (!words.some((w) => w.confidence >= 70)) continue;   // nothing read with confidence → icons/noise
                    const h = Math.max(1, l.bbox.y1 - l.bbox.y0);
                    // Split at wide gaps (table columns, items far apart).
                    const segs = [];
                    let cur = [kept[0]];
                    for (let i = 1; i < kept.length; i++) {
                        if (kept[i].bbox.x0 - kept[i - 1].bbox.x1 > Math.max(h * 1.1, 12)) { segs.push(cur); cur = [kept[i]]; }
                        else cur.push(kept[i]);
                    }
                    segs.push(cur);
                    let segments = segs.map((ws) => ({
                        words: ws, x0: ws[0].bbox.x0, x1: ws[ws.length - 1].bbox.x1,
                        text: cleanLine(ws.map((w) => w.text).join(' ')),
                    })).filter((sg) => sg.text);
                    // Drop stray digits/symbols sitting apart from the real text (icons, badges).
                    if (segments.length > 1) {
                        segments = segments.filter((sg) => hasLetter(sg.text) || (charCount(sg.text) > 2 && score(sg.words) >= 85));
                    }
                    if (!segments.length) continue;
                    // Phone status bar at the very top of a screenshot ("11:50 … 47%").
                    if (height && l.bbox.y1 < height * 0.05 && /^\d{1,2}[:.]\d{2}\b/.test(segments[0].text)) continue;
                    lines.push({
                        h,
                        segments,
                        text: segments.map((sg) => sg.text).join(' '),
                        box: {
                            x0: segments[0].x0, x1: segments[segments.length - 1].x1,
                            y0: Math.min(...kept.map((w) => w.bbox.y0)), y1: Math.max(...kept.map((w) => w.bbox.y1)),
                        },
                    });
                }
            }
        }
        return lines;
    }

    // If a segment straddles a known column gap, split it at the word gap inside that column gap.
    function splitAtGutters(line, gutters) {
        const out = [];
        for (const sg of line.segments) {
            let cur = [sg.words[0]];
            for (let k = 1; k < sg.words.length; k++) {
                const a = sg.words[k - 1].bbox.x1, b = sg.words[k].bbox.x0;
                // The word gap must fill most of a known column gap (not just touch a wide one).
                const atGutter = b - a >= Math.max(8, line.h * 0.5) &&
                    gutters.some((g) => Math.min(b, g[1]) - Math.max(a, g[0]) >= (g[1] - g[0]) * 0.5);
                if (atGutter) { out.push(cur); cur = [sg.words[k]]; } else cur.push(sg.words[k]);
            }
            out.push(cur);
        }
        return out.map((ws) => ({ words: ws, x0: ws[0].bbox.x0, x1: ws[ws.length - 1].bbox.x1, text: cleanLine(ws.map((w) => w.text).join(' ')) }))
            .filter((sg) => sg.text);
    }

    // Find runs of lines that share the same column gaps (tables / side-by-side columns).
    function findTables(lines, pitch) {
        const tables = [];
        let i = 0;
        while (i < lines.length) {
            const first = lines[i];
            if (first.segments.length < 2) { i++; continue; }
            let gutters = [];
            for (let k = 1; k < first.segments.length; k++) gutters.push([first.segments[k - 1].x1, first.segments[k].x0]);
            let j = i + 1, splitLines = 1;
            for (; j < lines.length; j++) {
                const ln = lines[j];
                if (ln.box.y0 - lines[j - 1].box.y0 > pitch * 3) break;
                const resplit = splitAtGutters(ln, gutters);
                const segs = resplit.length > ln.segments.length ? resplit : ln.segments;
                if (segs.length === 1) {
                    const sg = segs[0];
                    if (gutters.some((g) => sg.x0 < g[1] - 4 && sg.x1 > g[0] + 4)) break;    // spans the columns
                } else {
                    const gaps = [];
                    for (let k = 1; k < segs.length; k++) gaps.push([segs[k - 1].x1, segs[k].x0]);
                    if (gaps.length > gutters.length) break;
                    if (!gaps.every((gp) => gutters.some((g) => gp[0] < g[1] && gp[1] > g[0]))) break;
                    gutters = gutters.map((g) => {
                        const m = gaps.find((gp) => gp[0] < g[1] && gp[1] > g[0]);
                        return m ? [Math.max(g[0], m[0]), Math.min(g[1], m[1])] : g;
                    });
                    splitLines++;
                }
                ln.segments = segs;
            }
            if (splitLines >= 2) { tables.push({ start: i, end: j, gutters }); i = j; }
            else i++;
        }
        return tables;
    }

    function tableText(lines, gutters, pitch) {
        const cols = gutters.length + 1;
        const colOf = (sg) => gutters.filter((g) => (sg.x0 + sg.x1) / 2 > g[1]).length;
        const rows = [];
        let row = null;
        lines.forEach((ln, idx) => {
            if (!row || ln.box.y0 - lines[idx - 1].box.y0 > pitch * 1.4) { row = Array.from({ length: cols }, () => []); rows.push(row); }
            for (const sg of ln.segments) row[Math.min(cols - 1, colOf(sg))].push(sg.text);
        });
        return rows.map((r) => r.filter((c) => c.length).map((c) => joinWrapped(c)).join('\n')).join('\n\n');
    }

    function joinWrapped(parts) {
        let out = '';
        for (const t of parts) {
            if (!out) out = t;
            else if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(t)) out = out.slice(0, -1) + t;
            else out += ' ' + t;
        }
        return out;
    }

    // Rebuild the text from the page geometry:
    //  - tables / side-by-side columns are read cell by cell;
    //  - a larger-than-usual vertical gap starts a new paragraph (blank line);
    //  - a line that runs to the right edge was wrapped → join it with the next;
    //  - otherwise keep the line break (poems, addresses, lists).
    function buildText(data, height) {
        const lines = prepareLines(data, height);
        if (!lines.length) return '';
        const lineH = median(lines.map((x) => x.box.y1 - x.box.y0)) || 1;
        const pitches = [];
        for (let i = 1; i < lines.length; i++) {
            const d = lines[i].box.y0 - lines[i - 1].box.y0;
            if (d > 0 && d < lineH * 3) pitches.push(d);
        }
        // Use the tighter end of the spacing: chat screenshots and tables have many paragraph gaps.
        const pitch = quantile(pitches, 0.25) || lineH * 1.5;
        const tables = findTables(lines, pitch);
        const inTable = new Set();
        tables.forEach((t) => { for (let k = t.start; k < t.end; k++) inTable.add(k); });

        const plain = lines.filter((_, k) => !inTable.has(k));
        const right = quantile((plain.length ? plain : lines).map((x) => x.box.x1), 0.95);
        // A line was wrapped by the layout if the next line's first word would not have fitted after it.
        const wrapped = (prev, cur) => {
            const first = cur.segments[0].words[0].bbox;
            return prev.box.x1 + (first.x1 - first.x0) + cur.h * 0.3 > right;
        };

        let out = '';
        let prev = null;
        for (let i = 0; i < lines.length; i++) {
            const table = tables.find((t) => t.start === i);
            if (table) {
                out += (out ? '\n\n' : '') + tableText(lines.slice(table.start, table.end), table.gutters, pitch);
                prev = null;
                i = table.end - 1;
                continue;
            }
            const cur = lines[i];
            if (!prev) out += (out ? '\n\n' : '') + cur.text;
            else if (cur.box.x0 > prev.box.x1 && (cur.box.y0 + cur.box.y1) / 2 > prev.box.y0 && (cur.box.y0 + cur.box.y1) / 2 < prev.box.y1) {
                out += ' ' + cur.text;                          // same visual row, split by the OCR engine
            } else {
                const d = cur.box.y0 - prev.box.y0;
                const listItem = /^([•\-–]|[০-৯0-9]{1,3}[.)])\s/.test(cur.text);
                if (d < 0 || d > pitch * 1.4) out += '\n\n' + cur.text;
                else if (!listItem && wrapped(prev, cur)) out = joinWrapped([out, cur.text]);
                else out += '\n' + cur.text;
            }
            prev = cur;
        }
        return out;
    }

    // ---------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------
    async function recognizeCanvas(worker, canvas) {
        const { data } = await worker.recognize(canvas, { rotateAuto: true }, { blocks: true, text: true });
        return data;
    }

    async function recognize(file, onProgress) {
        progressHandler = onProgress || null;
        try {
            report('load', 0);
            const img = await decode(file);
            const worker = await getWorker('both');
            const { primary, alt } = chooseScales(img);

            // Read several versions (plain, lighting-corrected, second scale)…
            const runs = [];
            const variants = [[primary, false], [primary, true]];
            if (alt) variants.push([alt, false]);
            for (let i = 0; i < variants.length; i++) {
                if (i > 0) report('retry', (i - 1) / (variants.length - 1));
                const [scale, flat] = variants[i];
                const c = toCanvas(img, scale, flat);
                const d = await recognizeCanvas(worker, c);
                runs.push({ scale, canvas: c, data: d, conf: meanConfidence(d) });
            }
            // …start from the most confident one, then take each line from whichever version read it best.
            runs.sort((a, b) => b.conf - a.conf);
            const base = runs[0];
            fuseLines(base, runs.slice(1));
            const data = base.data, canvas = base.canvas, conf = meanConfidence(data);

            const hasBengali = BENGALI.test(data.text || '');
            const needsRepair = hasBengali && linesOf(data).some((l) => suspiciousWords(l).length);
            if (needsRepair) {
                report('refine', 0);
                const benWorker = await getWorker('ben');
                const benData = await recognizeCanvas(benWorker, canvas);
                repairBengali(data, benData);
            }
            if (img.close) img.close();
            if (window.TextOCR.debug) window.TextOCR.last = data;
            return { text: buildText(data, canvas.height).trim(), confidence: conf };
        } finally {
            progressHandler = null;
        }
    }

    window.TextOCR = { recognize, cancel: terminate };
})();
