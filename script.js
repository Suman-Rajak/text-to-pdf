/* =========================================================
   Text to PDF — multilingual typesetting engine
   ---------------------------------------------------------
   PDF libraries such as jsPDF cannot "shape" complex scripts:
   Bengali conjuncts (যুক্তাক্ষর), vowel signs, reph, Arabic
   joining, etc. come out broken. Instead we lay out the text
   ourselves and draw it with the browser's own text engine
   (which shapes every script correctly) onto a high-resolution
   canvas, then place each page into the PDF.
   ========================================================= */
(function () {
    'use strict';

    // ---------------------------------------------------------------
    // Configuration
    // ---------------------------------------------------------------
    const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792] };   // points
    const MARGIN = 64;            // ~22 mm
    const EXPORT_DPI = 220;
    const JPEG_QUALITY = 0.85;
    const TEXT_COLOR = '#111827';
    const MUTED = '#6b7280';
    const RULE = '#d5d9e2';
    const MEASURE_PX = 64;
    const EPS = 0.01;

    const DEFAULTS = { fontFamily: 'noto-sans', fontSize: '12', lineHeight: '1.5', pageSize: 'a4' };

    // Google Fonts axis specs (loaded on demand)
    const FONT_SPECS = {
        'Noto Sans': 'wght@400;700',
        'Noto Serif': 'wght@400;700',
        'Hind Siliguri': 'wght@400;700',
        'Tiro Bangla': 'ital@0',
    };

    const FONT_PRESETS = {
        'noto-sans': { families: ['Noto Sans'], kind: 'sans' },
        'noto-serif': { families: ['Noto Serif'], kind: 'serif' },
        'hind-siliguri': { families: ['Hind Siliguri'], kind: 'sans' },
        'noto-serif-bengali': { families: ['Noto Serif Bengali', 'Noto Serif'], kind: 'serif' },
        'tiro-bangla': { families: ['Tiro Bangla'], kind: 'serif' },
    };
    const LATIN_FALLBACK = { sans: 'Noto Sans', serif: 'Noto Serif' };
    const GENERIC = { sans: 'sans-serif', serif: 'serif' };
    const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"';

    // Per-script fallback fonts, added to the font stack only when the text uses that script.
    const SCRIPTS = [
        { re: /\p{Script=Bengali}/u, sans: 'Noto Sans Bengali', serif: 'Noto Serif Bengali' },
        { re: /\p{Script=Devanagari}/u, sans: 'Noto Sans Devanagari', serif: 'Noto Serif Devanagari' },
        { re: /\p{Script=Arabic}/u, sans: 'Noto Sans Arabic', serif: 'Noto Naskh Arabic' },
        { re: /\p{Script=Hebrew}/u, sans: 'Noto Sans Hebrew' },
        { re: /\p{Script=Gurmukhi}/u, sans: 'Noto Sans Gurmukhi' },
        { re: /\p{Script=Gujarati}/u, sans: 'Noto Sans Gujarati' },
        { re: /\p{Script=Oriya}/u, sans: 'Noto Sans Oriya' },
        { re: /\p{Script=Tamil}/u, sans: 'Noto Sans Tamil' },
        { re: /\p{Script=Telugu}/u, sans: 'Noto Sans Telugu' },
        { re: /\p{Script=Kannada}/u, sans: 'Noto Sans Kannada' },
        { re: /\p{Script=Malayalam}/u, sans: 'Noto Sans Malayalam' },
        { re: /\p{Script=Sinhala}/u, sans: 'Noto Sans Sinhala' },
        { re: /\p{Script=Thai}/u, sans: 'Noto Sans Thai', serif: 'Noto Serif Thai' },
        { re: /\p{Script=Lao}/u, sans: 'Noto Sans Lao' },
        { re: /\p{Script=Khmer}/u, sans: 'Noto Sans Khmer' },
        { re: /\p{Script=Myanmar}/u, sans: 'Noto Sans Myanmar' },
        { re: /\p{Script=Georgian}/u, sans: 'Noto Sans Georgian' },
        { re: /\p{Script=Armenian}/u, sans: 'Noto Sans Armenian' },
        { re: /\p{Script=Ethiopic}/u, sans: 'Noto Sans Ethiopic' },
        { re: /[\p{Script=Hiragana}\p{Script=Katakana}]/u, sans: 'Noto Sans JP', serif: 'Noto Serif JP' },
        { re: /\p{Script=Hangul}/u, sans: 'Noto Sans KR', serif: 'Noto Serif KR' },
        { re: /\p{Script=Han}/u, sans: 'Noto Sans SC', serif: 'Noto Serif SC' },
    ];
    for (const s of SCRIPTS) {
        FONT_SPECS[s.sans] = 'wght@400;700';
        if (s.serif) FONT_SPECS[s.serif] = 'wght@400;700';
    }

    const RTL_CHAR = /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}\p{Script=Thaana}\p{Script=Nko}]/u;
    const BREAK_SPACE = /^[ \t  -  -​ 　]+$/; // excludes no-break spaces
    const OPEN_PUNCT = /^[\p{Ps}\p{Pi}¿¡]+$/u;
    const GLUE_SYMBOL = /^\p{S}+$/u;
    const JOINER_END = /[्্੍્୍்్್്්ฺ္្‍]$/;
    const JOINER_START = /^[\p{M}‌‍]/u;

    const hasSegmenter = typeof Intl !== 'undefined' && !!Intl.Segmenter;
    const wordSegmenter = hasSegmenter ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
    const graphemeSegmenter = hasSegmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

    // ---------------------------------------------------------------
    // DOM & storage
    // ---------------------------------------------------------------
    const $ = (id) => document.getElementById(id);
    const els = {
        text: $('textInput'), title: $('docTitle'),
        fontFamily: $('fontFamily'), fontSize: $('fontSize'), lineHeight: $('lineHeight'), pageSize: $('pageSize'),
        pages: $('pages'), pageBadge: $('pageBadge'), stats: $('stats'),
        download: $('downloadBtn'), share: $('shareBtn'), toast: $('toast'), dropZone: $('dropZone'),
    };
    const SETTING_KEYS = ['fontFamily', 'fontSize', 'lineHeight', 'pageSize'];

    const store = {
        get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
        set(key, val) { try { localStorage.setItem(key, val); } catch (e) { /* ignore */ } },
    };

    function readSettings() {
        return {
            fontFamily: FONT_PRESETS[els.fontFamily.value] ? els.fontFamily.value : DEFAULTS.fontFamily,
            fontSize: parseFloat(els.fontSize.value) || 12,
            lineHeight: parseFloat(els.lineHeight.value) || 1.5,
            pageSize: PAGE_SIZES[els.pageSize.value] ? els.pageSize.value : DEFAULTS.pageSize,
        };
    }

    function applySettings(saved) {
        for (const key of SETTING_KEYS) {
            els[key].value = saved[key] != null ? String(saved[key]) : DEFAULTS[key];
            if (!els[key].value) els[key].value = DEFAULTS[key];   // unknown saved value
        }
    }

    // ---------------------------------------------------------------
    // Fonts
    // ---------------------------------------------------------------
    const cssRequests = new Map();

    function loadFontCss(families) {
        const missing = families.filter((f) => FONT_SPECS[f] && !cssRequests.has(f));
        if (missing.length) {
            const q = missing.map((f) => 'family=' + encodeURIComponent(f).replace(/%20/g, '+') + ':' + FONT_SPECS[f]);
            const p = new Promise((resolve) => {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = 'https://fonts.googleapis.com/css2?' + q.join('&') + '&display=swap';
                link.onload = resolve;
                link.onerror = resolve; // offline: fall back to system fonts
                document.head.appendChild(link);
            });
            missing.forEach((f) => cssRequests.set(f, p));
        }
        return Promise.all(families.map((f) => cssRequests.get(f)).filter(Boolean));
    }

    const timeout = (promise, ms) => Promise.race([promise, new Promise((r) => setTimeout(r, ms))]);

    async function ensureFonts(families, needsBold, sample) {
        await timeout(loadFontCss(families), 8000);
        if (!document.fonts || !document.fonts.load) return;
        const jobs = [];
        for (const f of families) {
            jobs.push(document.fonts.load(`400 16px "${f}"`, sample).catch(() => null));
            if (needsBold) jobs.push(document.fonts.load(`700 16px "${f}"`, sample).catch(() => null));
        }
        await timeout(Promise.all(jobs), 12000);
    }

    // ---------------------------------------------------------------
    // Styles & measurement
    // ---------------------------------------------------------------
    function makeStyle(css, size, bold, color) {
        return { css, size, bold, color, fkey: (bold ? 'b|' : 'r|') + css };
    }

    function cssFont(st, px) {
        return `${st.bold ? 700 : 400} ${px}px ${st.css}`;
    }

    const measureCtx = document.createElement('canvas').getContext('2d');
    let measureCache = new Map();
    let measureFont = '';

    function measure(text, st) {
        if (!text) return 0;
        const key = st.fkey + '\u0001' + text;
        let w = measureCache.get(key);
        if (w === undefined) {
            if (measureFont !== st.fkey) {
                measureCtx.font = cssFont(st, MEASURE_PX);
                measureFont = st.fkey;
            }
            w = measureCtx.measureText(text).width / MEASURE_PX;
            if (measureCache.size > 60000) measureCache = new Map();
            measureCache.set(key, w);
        }
        return w * st.size;
    }

    // ---------------------------------------------------------------
    // Tokenising: text -> unbreakable "words" and breakable spaces
    // ---------------------------------------------------------------
    function* wordSegments(text) {
        if (wordSegmenter) {
            for (const s of wordSegmenter.segment(text)) yield { t: s.segment, word: s.isWordLike };
        } else {
            const re = /[ \t　]+|[^ \t　]+/g;
            let m;
            while ((m = re.exec(text))) yield { t: m[0], word: !BREAK_SPACE.test(m[0]) };
        }
    }

    function graphemes(str) {
        const raw = graphemeSegmenter ? Array.from(graphemeSegmenter.segment(str), (s) => s.segment) : Array.from(str);
        const out = [];
        for (const g of raw) {
            // Never split a conjunct: keep clusters joined across virama/hasanta and joiners.
            if (out.length && (JOINER_END.test(out[out.length - 1]) || JOINER_START.test(g))) out[out.length - 1] += g;
            else out.push(g);
        }
        return out;
    }

    function tokenize(text, st) {
        const tokens = [];
        let cur = null;
        let last = 'none';
        const endWord = () => {
            if (cur !== null) { tokens.push({ space: false, text: cur, width: measure(cur, st) }); cur = null; }
        };
        const add = (t) => { cur = (cur || '') + t; };

        for (const seg of wordSegments(text)) {
            const t = seg.t;
            if (BREAK_SPACE.test(t)) {
                endWord();
                const lt = tokens[tokens.length - 1];
                if (lt && lt.space) lt.text += t;
                else tokens.push({ space: true, text: t, width: 0 });
                last = 'space';
            } else if (seg.word) {
                // Two words with no space between them (Chinese, Japanese, Thai…): a break is allowed.
                if (cur !== null && (last === 'word' || last === 'close')) endWord();
                add(t);
                last = 'word';
            } else if (cur === null) {
                add(t);                  // leading punctuation/symbol sticks to what follows
                last = 'open';
            } else if (OPEN_PUNCT.test(t)) {
                endWord();               // break allowed before an opening bracket/quote
                add(t);
                last = 'open';
            } else {
                add(t);                  // closing punctuation (, . ! ? । ॥ 。) never starts a line
                last = GLUE_SYMBOL.test(t) ? 'open' : 'close';
            }
        }
        endWord();
        for (const t of tokens) if (t.space) t.width = measure(t.text, st);
        return tokens;
    }

    function splitLongWord(tok, maxW, st) {
        const parts = [];
        let cur = '';
        let w = 0;
        for (const g of graphemes(tok.text)) {
            const gw = measure(g, st);
            if (w > 0 && w + gw > maxW + EPS) {
                parts.push({ space: false, text: cur, width: measure(cur, st) });
                cur = ''; w = 0;
            }
            cur += g; w += gw;
        }
        if (cur) parts.push({ space: false, text: cur, width: measure(cur, st) });
        return parts;
    }

    function breakLines(tokens, maxW, st) {
        const lines = [];
        let items = [];
        let width = 0;
        let words = 0;
        const flush = () => {
            while (items.length && items[items.length - 1].space) width -= items.pop().width;
            lines.push({ items, width: Math.max(0, width) });
            items = []; width = 0; words = 0;
        };
        for (const t of tokens) {
            if (t.space) {
                if (lines.length && !words) continue;       // no leading spaces on wrapped lines
                items.push(t); width += t.width;
                continue;
            }
            if (width + t.width <= maxW + EPS) {
                items.push(t); width += t.width; words++;
                continue;
            }
            if (words) flush(); else { items = []; width = 0; }
            if (t.width <= maxW + EPS) {
                items.push(t); width = t.width; words = 1;
            } else {
                // A single word wider than the line (URL, long number…): break between graphemes.
                splitLongWord(t, maxW, st).forEach((p, i) => {
                    if (i > 0) flush();
                    items.push(p); width = p.width; words = 1;
                });
            }
        }
        if (items.length || !lines.length) flush();
        return lines;
    }

    const isRtl = (text) => { const m = text.match(/\p{L}/u); return !!m && RTL_CHAR.test(m[0]); };

    // ---------------------------------------------------------------
    // Page layout -> list of drawing operations per page
    // ---------------------------------------------------------------
    function prepare(text, title, s) {
        const all = title + '\n' + text;
        const preset = FONT_PRESETS[s.fontFamily];
        const families = preset.families.slice();
        for (const sc of SCRIPTS) {
            if (sc.re.test(all)) {
                const f = (preset.kind === 'serif' && sc.serif) || sc.sans;
                if (!families.includes(f)) families.push(f);
            }
        }
        if (!families.includes(LATIN_FALLBACK[preset.kind])) families.push(LATIN_FALLBACK[preset.kind]);
        return {
            families,
            css: families.map((f) => `"${f}"`).join(', ') + ', ' + EMOJI + ', ' + GENERIC[preset.kind],
            sample: Array.from(new Set(all + '0123456789 /')).join(''),
            text: text.replace(/\r\n?/g, '\n').replace(/\t/g, '    '),
            title: title.trim(),
        };
    }

    function layoutDocument(prep, s) {
        const [pw, ph] = PAGE_SIZES[s.pageSize];
        const left = MARGIN, right = pw - MARGIN, top = MARGIN, bottom = ph - MARGIN;
        const contentW = right - left;
        const size = s.fontSize;
        const lineH = size * s.lineHeight;
        const bodySt = makeStyle(prep.css, size, false, TEXT_COLOR);

        const pages = [];
        let page = null;
        let y = 0;
        const newPage = () => { page = { ops: [] }; pages.push(page); y = top; };
        const atTop = () => y <= top + EPS;
        newPage();

        // Lays out one paragraph (a line of the input) and emits text ops.
        function flow(text, st, lh) {
            const rtl = isRtl(text);
            const lines = breakLines(tokenize(text, st), contentW, st);
            for (const line of lines) {
                if (y + lh > bottom + EPS && !atTop()) newPage();
                const baseline = y + lh / 2 + st.size * 0.3;
                if (rtl) {
                    // Whole line at once so the browser applies the full bidi algorithm.
                    const s2 = line.items.map((t) => t.text).join('');
                    page.ops.push({ x: right, y: baseline, s: s2, st, dir: 'rtl', align: 'right' });
                } else {
                    let x = left;
                    for (const t of line.items) {
                        if (!t.space) page.ops.push({ x, y: baseline, s: t.text, st, dir: 'ltr', align: 'left' });
                        x += t.width;
                    }
                }
                y += lh;
            }
        }

        if (prep.title) {
            const tSize = Math.min(size * 1.8, 40);
            flow(prep.title, makeStyle(prep.css, tSize, true, TEXT_COLOR), tSize * 1.3);
            y += size * 0.55;
            page.ops.push({ line: true, x1: left, x2: right, y });
            y += size * 1.3;
        }

        const paragraphs = prep.text.split('\n');
        while (paragraphs.length && !paragraphs[paragraphs.length - 1].trim()) paragraphs.pop();
        for (const para of paragraphs) {
            if (para === '\f') { newPage(); continue; }
            if (!para.trim()) {
                if (atTop() && pages.length > 1) continue;   // don't start a page with empty lines
                y += lineH;
                if (y > bottom) newPage();
                continue;
            }
            flow(para, bodySt, lineH);
        }

        // Page numbers (only for multi-page documents)
        if (pages.length > 1) {
            const numSt = makeStyle(prep.css, Math.max(7, size * 0.75), false, MUTED);
            pages.forEach((pg, i) => {
                const label = `${i + 1} / ${pages.length}`;
                pg.ops.push({ x: pw / 2 - measure(label, numSt) / 2, y: ph - MARGIN / 2 + numSt.size * 0.3, s: label, st: numSt, dir: 'ltr', align: 'left' });
            });
        }
        return { pages, pw, ph };
    }

    function renderPage(ctx, page, scale) {
        const c = ctx.canvas;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.textBaseline = 'alphabetic';
        let font = '';
        for (const op of page.ops) {
            if (op.line) {
                ctx.strokeStyle = RULE;
                ctx.lineWidth = Math.max(1, 0.8 * scale);
                ctx.beginPath();
                ctx.moveTo(op.x1 * scale, op.y * scale);
                ctx.lineTo(op.x2 * scale, op.y * scale);
                ctx.stroke();
                continue;
            }
            const f = cssFont(op.st, op.st.size * scale);
            if (f !== font) { ctx.font = f; font = f; }
            ctx.fillStyle = op.st.color;
            ctx.direction = op.dir;
            ctx.textAlign = op.align;
            ctx.fillText(op.s, op.x * scale, op.y * scale);
        }
    }

    async function computeLayout() {
        const s = readSettings();
        const prep = prepare(els.text.value, els.title.value, s);
        await ensureFonts(prep.families, !!prep.title, prep.sample);
        return { lay: layoutDocument(prep, s), prep };
    }

    // ---------------------------------------------------------------
    // Live preview
    // ---------------------------------------------------------------
    let layoutState = null;
    let layoutVersion = 0;
    let updateSeq = 0;
    const pageEls = [];

    const observer = 'IntersectionObserver' in window
        ? new IntersectionObserver((entries) => {
            for (const e of entries) {
                e.target._visible = e.isIntersecting;
                if (e.isIntersecting) drawPreviewPage(e.target);
            }
        }, { root: $('previewScroll'), rootMargin: '600px 0px' })
        : null;

    function drawPreviewPage(el) {
        if (!layoutState || el._drawn === layoutVersion) return;
        const page = layoutState.pages[el._index];
        if (!page) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const scale = ((el.clientWidth || 600) * dpr) / layoutState.pw;
        const canvas = el.firstChild;
        canvas.width = Math.round(layoutState.pw * scale);
        canvas.height = Math.round(layoutState.ph * scale);
        renderPage(canvas.getContext('2d'), page, scale);
        el._drawn = layoutVersion;
    }

    function renderPreview(lay) {
        layoutState = lay;
        layoutVersion++;
        const n = lay.pages.length;
        while (pageEls.length < n) {
            const el = document.createElement('div');
            el.className = 'page';
            const canvas = document.createElement('canvas');
            canvas.setAttribute('role', 'img');
            el.appendChild(canvas);
            el._index = pageEls.length;
            els.pages.appendChild(el);
            pageEls.push(el);
            if (observer) observer.observe(el); else el._visible = true;
        }
        while (pageEls.length > n) {
            const el = pageEls.pop();
            if (observer) observer.unobserve(el);
            el.remove();
        }
        pageEls.forEach((el, i) => {
            el.style.aspectRatio = `${lay.pw} / ${lay.ph}`;
            el.firstChild.setAttribute('aria-label', `Page ${i + 1} of ${n}`);
            if (el._visible || i < 2) drawPreviewPage(el);
        });
        els.pageBadge.textContent = `${n} page${n === 1 ? '' : 's'}`;
    }

    async function update() {
        const seq = ++updateSeq;
        try {
            const { lay } = await computeLayout();
            if (seq === updateSeq) renderPreview(lay);
        } catch (err) {
            console.error(err);
        }
    }

    let updateTimer = 0;
    function scheduleUpdate(delay) {
        clearTimeout(updateTimer);
        updateTimer = setTimeout(update, delay === undefined ? 220 : delay);
    }

    function updateStats() {
        const text = els.text.value;
        let words = 0;
        if (wordSegmenter && text.length < 400000) {
            for (const seg of wordSegmenter.segment(text)) if (seg.isWordLike) words++;
        } else {
            words = (text.match(/\S+/g) || []).length;
        }
        els.stats.textContent = `${words.toLocaleString()} word${words === 1 ? '' : 's'}`;
    }

    // ---------------------------------------------------------------
    // PDF export
    // ---------------------------------------------------------------
    function loadJsPDF() {
        if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
        return new Promise((resolve, reject) => {
            const sc = document.createElement('script');
            sc.src = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js';
            sc.onload = () => (window.jspdf ? resolve(window.jspdf.jsPDF) : reject(new Error('PDF library failed to load.')));
            sc.onerror = () => reject(new Error('Could not load the PDF library. Please check your internet connection.'));
            document.head.appendChild(sc);
        });
    }

    function canvasToJpeg(canvas) {
        return new Promise((resolve, reject) => {
            if (!canvas.toBlob) return resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
            canvas.toBlob((blob) => {
                if (!blob) return reject(new Error('Could not encode the page image.'));
                blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
            }, 'image/jpeg', JPEG_QUALITY);
        });
    }

    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

    function fileName() {
        const source = els.title.value.trim() || (els.text.value.split('\n').find((l) => l.trim()) || '');
        const name = graphemes(source.trim()).slice(0, 48).join('')
            .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
        return (name || 'document') + '.pdf';
    }

    let busy = false;

    async function buildPdf(button) {
        if (!els.text.value.trim() && !els.title.value.trim()) {
            toast('Please enter some text first.', true);
            els.text.focus();
            return null;
        }
        const labelEl = button.querySelector('.btn-label');
        const original = labelEl.textContent;
        busy = true;
        els.download.disabled = els.share.disabled = true;
        labelEl.textContent = 'Preparing…';
        try {
            const [jsPDF, { lay, prep }] = await Promise.all([loadJsPDF(), computeLayout()]);
            const { pw, ph, pages } = lay;
            const scale = EXPORT_DPI / 72;
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(pw * scale);
            canvas.height = Math.round(ph * scale);
            const ctx = canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d');
            const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: [pw, ph], compress: true });
            pdf.setProperties({ title: prep.title || fileName().replace(/\.pdf$/, ''), creator: 'Text to PDF by Suman' });
            for (let i = 0; i < pages.length; i++) {
                labelEl.textContent = pages.length > 1 ? `Creating… ${i + 1}/${pages.length}` : 'Creating…';
                if (i > 0) pdf.addPage([pw, ph], 'portrait');
                renderPage(ctx, pages[i], scale);
                pdf.addImage(await canvasToJpeg(canvas), 'JPEG', 0, 0, pw, ph, `page${i}`, 'NONE');
                await nextFrame();
            }
            return { blob: pdf.output('blob'), name: fileName() };
        } catch (err) {
            console.error(err);
            toast(err && err.message ? err.message : 'Something went wrong while creating the PDF.', true);
            return null;
        } finally {
            busy = false;
            labelEl.textContent = original;
            els.download.disabled = els.share.disabled = false;
        }
    }

    async function downloadPdf() {
        if (busy) return;
        const result = await buildPdf(els.download);
        if (!result) return;
        const url = URL.createObjectURL(result.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        toast(`Saved ${result.name}`);
    }

    async function sharePdf() {
        if (busy) return;
        const result = await buildPdf(els.share);
        if (!result) return;
        try {
            await navigator.share({ files: [new File([result.blob], result.name, { type: 'application/pdf' })] });
        } catch (err) {
            if (err && err.name !== 'AbortError') toast('Sharing failed. Try downloading instead.', true);
        }
    }

    let toastTimer = 0;
    function toast(message, isError) {
        els.toast.textContent = message;
        els.toast.classList.toggle('error', !!isError);
        els.toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => els.toast.classList.remove('show'), isError ? 5000 : 3000);
    }

    // ---------------------------------------------------------------
    // Opening files & images (OCR)
    // ---------------------------------------------------------------
    const ocrEls = { box: $('ocrStatus'), label: $('ocrLabel'), bar: $('ocrBar'), detail: $('ocrDetail') };
    let ocrBusy = false;
    let ocrRun = 0;

    function insertText(text) {
        if (!text) return;
        const ta = els.text;
        if (!ta.value.trim()) {
            ta.value = text;
        } else {
            const start = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
            const end = ta.selectionEnd != null ? ta.selectionEnd : start;
            const before = ta.value.slice(0, start);
            const after = ta.value.slice(end);
            const pre = !before || /\n\n$/.test(before) ? '' : (/\n$/.test(before) ? '\n' : '\n\n');
            const post = !after || /^\n/.test(after) ? '' : '\n\n';
            ta.setRangeText(pre + text + post, start, end, 'end');
        }
        onTextChange();
    }

    function showOcr(label, detail, progress) {
        ocrEls.box.hidden = false;
        if (label) ocrEls.label.textContent = label;
        if (detail != null) ocrEls.detail.textContent = detail;
        ocrEls.bar.style.width = `${Math.round(Math.max(0, Math.min(1, progress || 0)) * 100)}%`;
    }

    function hideOcr() {
        ocrEls.box.hidden = true;
        ocrEls.bar.style.width = '0%';
    }

    const OCR_STAGES = {
        load: ['Loading OCR engine…', 'First time only — about 8 MB', 0, 0.15],
        recognize: ['Reading text from image…', 'English & Bengali', 0.15, 0.45],
        retry: ['Improving accuracy…', 'Comparing enhanced versions', 0.45, 0.9],
        refine: ['Checking Bengali words…', 'Final pass', 0.9, 1],
    };

    async function openFiles(files) {
        if (ocrBusy) { toast('Please wait for the current image to finish.', true); return; }
        const images = files.filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif|heic|tiff?)$/i.test(f.name));
        const texts = files.filter((f) => !images.includes(f));
        for (const f of texts) {
            if (f.size > 10 * 1024 * 1024) { toast(`${f.name} is too large (max 10 MB).`, true); continue; }
            try { insertText((await f.text()).replace(/\r\n?/g, '\n')); } catch (e) { toast(`Could not read ${f.name}.`, true); }
        }
        if (!images.length) return;
        if (!window.TextOCR) { toast('OCR is not available.', true); return; }

        ocrBusy = true;
        const run = ++ocrRun;
        const cancelled = () => run !== ocrRun;
        let lowConfidence = false;
        let found = 0;
        try {
            for (let i = 0; i < images.length && !cancelled(); i++) {
                const prefix = images.length > 1 ? `Image ${i + 1} of ${images.length} · ` : '';
                let lastStage = 'load';
                showOcr(OCR_STAGES.load[0], prefix + OCR_STAGES.load[1], 0);
                const result = await window.TextOCR.recognize(images[i], (stage, p) => {
                    const st = OCR_STAGES[stage] || OCR_STAGES[lastStage];
                    lastStage = stage;
                    showOcr(st[0], prefix + st[1], st[2] + (st[3] - st[2]) * (p || 0));
                });
                if (cancelled()) return;
                if (result.text) {
                    insertText(result.text);
                    found++;
                    if (result.confidence < 75) lowConfidence = true;
                }
            }
            if (!found) toast('No text was found in the image.', true);
            else if (lowConfidence) toast('Text extracted, but the image is unclear — please review it carefully.');
            else toast(found > 1 ? `Text extracted from ${found} images` : 'Text extracted from image');
        } catch (err) {
            if (!cancelled()) {
                console.error(err);
                toast(err && err.message ? err.message : 'Could not read the image.', true);
            }
        } finally {
            if (!cancelled()) {
                ocrBusy = false;
                hideOcr();
            }
        }
    }

    // ---------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------
    let draftTimer = 0;
    function onTextChange() {
        updateStats();
        scheduleUpdate();
        clearTimeout(draftTimer);
        draftTimer = setTimeout(() => {
            store.set('ttp.draft', els.text.value);
            store.set('ttp.title', els.title.value);
        }, 400);
    }

    function init() {
        // Visit counter (stored on this device only)
        const visits = (parseInt(store.get('visitcount'), 10) || 0) + 1;
        store.set('visitcount', String(visits));
        $('visit').textContent = visits.toLocaleString();

        let saved = {};
        try { saved = JSON.parse(store.get('ttp.settings') || '{}') || {}; } catch (e) { saved = {}; }
        applySettings(saved);
        els.text.value = store.get('ttp.draft') || '';
        els.title.value = store.get('ttp.title') || '';

        els.text.addEventListener('input', onTextChange);
        els.title.addEventListener('input', onTextChange);
        for (const key of SETTING_KEYS) {
            els[key].addEventListener('change', () => {
                const s = {};
                SETTING_KEYS.forEach((k) => { s[k] = els[k].value; });
                store.set('ttp.settings', JSON.stringify(s));
                scheduleUpdate(30);
            });
        }

        // Open / drop / paste: images go through OCR, text files are inserted as-is.
        const fileInput = $('fileInput');
        fileInput.addEventListener('change', () => {
            openFiles(Array.from(fileInput.files));
            fileInput.value = '';
        });
        ['dragenter', 'dragover'].forEach((type) => els.dropZone.addEventListener(type, (e) => {
            if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
            e.preventDefault();
            els.dropZone.classList.add('dragging');
        }));
        ['dragleave', 'drop'].forEach((type) => els.dropZone.addEventListener(type, () => els.dropZone.classList.remove('dragging')));
        els.dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
            if (!files.length) return;
            e.preventDefault();
            openFiles(files);
        });
        els.text.addEventListener('paste', (e) => {
            const items = e.clipboardData ? Array.from(e.clipboardData.items) : [];
            const images = items.filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean);
            if (!images.length) return;
            e.preventDefault();
            openFiles(images);
        });
        $('ocrCancel').addEventListener('click', () => {
            ocrRun++;
            ocrBusy = false;
            if (window.TextOCR) window.TextOCR.cancel();
            hideOcr();
            toast('Cancelled.');
        });

        els.download.addEventListener('click', downloadPdf);
        els.share.addEventListener('click', sharePdf);
        try {
            const probe = new File(['x'], 'probe.pdf', { type: 'application/pdf' });
            if (navigator.canShare && navigator.canShare({ files: [probe] })) els.share.hidden = false;
        } catch (e) { /* sharing unsupported */ }

        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                downloadPdf();
            }
        });

        // Re-measure once web fonts finish loading so metrics are exact.
        if (document.fonts && document.fonts.addEventListener) {
            document.fonts.addEventListener('loadingdone', () => {
                measureCache = new Map();
                measureFont = '';
                scheduleUpdate(50);
            });
        }
        let resizeTimer = 0;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => { if (layoutState) { layoutVersion++; pageEls.forEach((el) => el._visible && drawPreviewPage(el)); } }, 150);
        });

        updateStats();
        update();
    }

    init();
})();
