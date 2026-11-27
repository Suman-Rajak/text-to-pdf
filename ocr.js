/* =========================================================
   Image → text (OCR) for English and Bengali
   ---------------------------------------------------------
   Uses Tesseract.js (LSTM "best" integer models), loaded only
   when the user opens an image. Accuracy steps:
   1. Pre-process: grayscale + rescale into Tesseract's sweet spot.
   2. Recognise with Bengali + English together, auto-deskewed.
   3. Also read a lighting-corrected copy and a second scale, and
      keep whichever reading Tesseract is most confident about.
   4. The combined model sometimes turns a Bengali word into
      low-confidence Latin garbage; such words are re-read with
      the Bengali-only model.
   5. Clean up (danda, common Bengali confusions) and re-flow
      wrapped lines into paragraphs.
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
        for (let i = 0; i < px.length; i += 4) {       // luminance grayscale
            const y = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
            px[i] = px[i + 1] = px[i + 2] = y;
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

    const isLatinWord = (w) => LATIN.test(w.text) && !BENGALI.test(w.text);

    // In a line that is mostly Bengali, a Latin word is only trusted when the model is very sure.
    const mostlyBengali = (words) => words.filter((w) => BENGALI.test(w.text)).length >= words.length * 0.6;

    function suspiciousWords(line) {
        const words = line.words || [];
        const limit = mostlyBengali(words) ? 85 : 65;
        return words.filter((w) => isLatinWord(w) && w.confidence < limit);
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
                    if (sb >= 30 || sb > sc || (bnLine && sc < 50)) { result.push(...b); changed++; continue; }
                }
                result.push(...c);
            }
            line.words = result;
        }
        return changed;
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
        for (const [re, rep] of BN_WORD_FIXES) t = t.replace(re, rep);
        return t.replace(/[ \t]{2,}/g, ' ').trim();
    }

    const median = (arr) => {
        if (!arr.length) return 0;
        const a = arr.slice().sort((x, y) => x - y);
        return a[Math.floor((a.length - 1) / 2)];
    };

    // Rebuild paragraphs from the page geometry:
    //  - a larger-than-usual vertical gap starts a new paragraph (blank line);
    //  - a line that runs to the right edge was wrapped → join it with the next;
    //  - otherwise keep the line break (poems, addresses, lists).
    function buildText(data) {
        const lines = [];
        for (const block of data.blocks || []) {
            for (const p of block.paragraphs || []) {
                for (const l of p.lines || []) {
                    if (!(l.words || []).length) continue;
                    const text = cleanLine(l.words.map((w) => w.text).join(' '));
                    if (text) lines.push({ text, box: l.bbox });
                }
            }
        }
        if (!lines.length) return '';
        const rights = lines.map((x) => x.box.x1).sort((a, b) => a - b);
        const right = rights[Math.floor((rights.length - 1) * 0.9)];
        const left = Math.min(...lines.map((x) => x.box.x0));
        const width = Math.max(1, right - left);
        const lineH = median(lines.map((x) => x.box.y1 - x.box.y0)) || 1;
        const pitches = [];
        for (let i = 1; i < lines.length; i++) {
            const d = lines[i].box.y0 - lines[i - 1].box.y0;
            if (d > 0 && d < lineH * 3) pitches.push(d);
        }
        const pitch = median(pitches) || lineH * 1.5;

        let out = lines[0].text;
        for (let i = 1; i < lines.length; i++) {
            const prev = lines[i - 1], cur = lines[i];
            const d = cur.box.y0 - prev.box.y0;
            if (d < 0 || d > pitch * 1.4) out += '\n\n' + cur.text;
            else if (prev.box.x1 >= right - width * 0.1) {
                if (/[A-Za-z]-$/.test(out) && /^[a-z]/.test(cur.text)) out = out.slice(0, -1) + cur.text;  // de-hyphenate
                else out += ' ' + cur.text;
            } else out += '\n' + cur.text;
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

            let canvas = toCanvas(img, primary);
            let data = await recognizeCanvas(worker, canvas);
            let conf = meanConfidence(data);

            // Evened-out lighting and a second scale; keep the most confident reading.
            const variants = [[primary, true]];
            if (alt) variants.push([alt, false]);
            for (let i = 0; i < variants.length; i++) {
                report('retry', i / variants.length);
                const c2 = toCanvas(img, variants[i][0], variants[i][1]);
                const d2 = await recognizeCanvas(worker, c2);
                const conf2 = meanConfidence(d2);
                if (conf2 > conf) { data = d2; conf = conf2; canvas = c2; }
            }

            const hasBengali = BENGALI.test(data.text || '');
            const needsRepair = hasBengali && linesOf(data).some((l) => suspiciousWords(l).length);
            if (needsRepair) {
                report('refine', 0);
                const benWorker = await getWorker('ben');
                const benData = await recognizeCanvas(benWorker, canvas);
                repairBengali(data, benData);
            }
            if (img.close) img.close();
            return { text: buildText(data).trim(), confidence: conf };
        } finally {
            progressHandler = null;
        }
    }

    window.TextOCR = { recognize, cancel: terminate };
})();
