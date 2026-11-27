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
    const PAGE_SIZES = {               // points (1/72 inch)
        a4: [595.28, 841.89],
        letter: [612, 792],
        legal: [612, 1008],
        a5: [419.53, 595.28],
    };
    const MARGINS = { narrow: 36, normal: 64, wide: 96 };
    const DPI = { standard: 150, high: 220, print: 300 };
    const JPEG_QUALITY = 0.85;
    const MEASURE_PX = 64;
    const EPS = 0.01;

    const MUTED = '#6b7280';
    const RULE = '#d5d9e2';
    const QUOTE_BAR = '#c5cad6';

    const DEFAULTS = {
        fontFamily: 'noto-sans',
        fontSize: 12,
        lineHeight: '1.5',
        align: 'left',
        color: '#111827',
        pageSize: 'a4',
        orientation: 'portrait',
        margins: 'normal',
        pageNumbers: 'simple',
        formatting: true,
        runningHeader: false,
        quality: 'high',
    };

    // Google Fonts axis specs (only loaded on demand)
    const FONT_SPECS = {
        'Noto Sans': 'ital,wght@0,400;0,700;1,400;1,700',
        'Noto Serif': 'ital,wght@0,400;0,700;1,400;1,700',
        'Noto Sans Mono': 'wght@400;700',
        'Hind Siliguri': 'wght@400;700',
        'Noto Sans Bengali': 'wght@400;700',
        'Noto Serif Bengali': 'wght@400;700',
        'Tiro Bangla': 'ital@0;1',
        'Baloo Da 2': 'wght@400;700',
        'Roboto': 'ital,wght@0,400;0,700;1,400;1,700',
        'Merriweather': 'ital,wght@0,400;0,700;1,400;1,700',
    };

    const FONT_PRESETS = {
        'noto-sans': { families: ['Noto Sans'], kind: 'sans' },
        'noto-serif': { families: ['Noto Serif'], kind: 'serif' },
        'hind-siliguri': { families: ['Hind Siliguri'], kind: 'sans' },
        'noto-sans-bengali': { families: ['Noto Sans Bengali', 'Noto Sans'], kind: 'sans' },
        'noto-serif-bengali': { families: ['Noto Serif Bengali', 'Noto Serif'], kind: 'serif' },
        'tiro-bangla': { families: ['Tiro Bangla'], kind: 'serif' },
        'baloo-da-2': { families: ['Baloo Da 2'], kind: 'sans' },
        'roboto': { families: ['Roboto'], kind: 'sans' },
        'merriweather': { families: ['Merriweather'], kind: 'serif' },
        'mono': { families: ['Noto Sans Mono'], kind: 'mono' },
    };
    const LATIN_FALLBACK = { sans: 'Noto Sans', serif: 'Noto Serif', mono: 'Noto Sans Mono' };
    const GENERIC = { sans: 'sans-serif', serif: 'serif', mono: 'monospace' };
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

    const wordSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter
        ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null;
    const graphemeSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter
        ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

    // ---------------------------------------------------------------
    // DOM
    // ---------------------------------------------------------------
    const $ = (id) => document.getElementById(id);
    const els = {
        text: $('textInput'), title: $('docTitle'), fileName: $('fileName'),
        fontFamily: $('fontFamily'), fontSize: $('fontSize'), lineHeight: $('lineHeight'),
        pageSize: $('pageSize'), orientation: $('orientation'), margins: $('margins'),
        pageNumbers: $('pageNumbers'), formatting: $('formatting'), runningHeader: $('runningHeader'),
        quality: $('quality'), pages: $('pages'), pageBadge: $('pageBadge'),
        download: $('downloadBtn'), share: $('shareBtn'), toast: $('toast'),
        statWords: $('statWords'), statChars: $('statChars'), statPages: $('statPages'),
        fileInput: $('fileInput'), dropZone: $('dropZone'),
    };

    // ---------------------------------------------------------------
    // Storage helpers (never throw)
    // ---------------------------------------------------------------
    const store = {
        get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
        set(key, val) { try { localStorage.setItem(key, val); } catch (e) { /* ignore */ } },
    };

    // ---------------------------------------------------------------
    // Settings
    // ---------------------------------------------------------------
    function readSettings() {
        const size = parseFloat(els.fontSize.value);
        return {
            fontFamily: FONT_PRESETS[els.fontFamily.value] ? els.fontFamily.value : DEFAULTS.fontFamily,
            fontSize: Number.isFinite(size) ? Math.min(72, Math.max(6, size)) : DEFAULTS.fontSize,
            lineHeight: els.lineHeight.value,
            align: (document.querySelector('input[name="align"]:checked') || {}).value || DEFAULTS.align,
            color: (document.querySelector('input[name="color"]:checked') || {}).value || DEFAULTS.color,
            pageSize: els.pageSize.value,
            orientation: els.orientation.value,
            margins: els.margins.value,
            pageNumbers: els.pageNumbers.value,
            formatting: els.formatting.checked,
            runningHeader: els.runningHeader.checked,
            quality: els.quality.value,
        };
    }

    function applySettings(s) {
        s = Object.assign({}, DEFAULTS, s);
        els.fontFamily.value = s.fontFamily;
        if (!els.fontFamily.value) els.fontFamily.value = DEFAULTS.fontFamily;
        els.fontSize.value = s.fontSize;
        els.lineHeight.value = s.lineHeight;
        if (!els.lineHeight.value) els.lineHeight.value = DEFAULTS.lineHeight;
        els.pageSize.value = s.pageSize;
        els.orientation.value = s.orientation;
        els.margins.value = s.margins;
        els.pageNumbers.value = s.pageNumbers;
        els.formatting.checked = !!s.formatting;
        els.runningHeader.checked = !!s.runningHeader;
        els.quality.value = s.quality;
        const a = document.querySelector(`input[name="align"][value="${s.align}"]`) ||
            document.querySelector(`input[name="align"][value="${DEFAULTS.align}"]`);
        a.checked = true;
        const c = document.querySelector(`input[name="color"][value="${s.color}"]`) ||
            document.querySelector(`input[name="color"][value="${DEFAULTS.color}"]`);
        c.checked = true;
    }

    // ---------------------------------------------------------------
    // Parsing: text -> blocks -> inline runs
    // ---------------------------------------------------------------
    const PAGEBREAK = '\u0000PAGEBREAK\u0000';

    function parseInline(text, formatting, flags) {
        if (!formatting) return [{ text, bold: false, italic: false }];
        const runs = [];
        const re = /\\([*\\#>_\-`[\]])|\*\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*\*|\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*|\*(?=[^\s*])([^*]+?)(?<=\S)\*/g;
        let last = 0;
        let m;
        const push = (t, bold, italic) => {
            if (!t) return;
            const prev = runs[runs.length - 1];
            if (prev && prev.bold === bold && prev.italic === italic) prev.text += t;
            else runs.push({ text: t, bold, italic });
            if (bold) flags.bold = true;
            if (italic) flags.italic = true;
            if (bold && italic) flags.boldItalic = true;
        };
        while ((m = re.exec(text))) {
            push(text.slice(last, m.index), false, false);
            if (m[1] !== undefined) push(m[1], false, false);
            else if (m[2] !== undefined) push(m[2], true, true);
            else if (m[3] !== undefined) push(m[3], true, false);
            else push(m[4], false, true);
            last = re.lastIndex;
        }
        push(text.slice(last), false, false);
        return runs.length ? runs : [{ text: '', bold: false, italic: false }];
    }

    function parseBlocks(text, formatting) {
        const flags = { bold: false, italic: false, boldItalic: false };
        const src = text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/\f/g, '\n' + PAGEBREAK + '\n');
        const blocks = [];
        for (const raw of src.split('\n')) {
            if (raw === PAGEBREAK || (formatting && /^\s*\[pagebreak\]\s*$/i.test(raw))) {
                blocks.push({ type: 'pagebreak' });
                continue;
            }
            if (raw.trim() === '') { blocks.push({ type: 'blank' }); continue; }
            if (!formatting) { blocks.push({ type: 'para', runs: parseInline(raw, false, flags) }); continue; }

            let m;
            if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) { blocks.push({ type: 'hr' }); continue; }
            if ((m = raw.match(/^\s*(#{1,3})\s+(.*)$/))) {
                flags.bold = true;
                blocks.push({ type: 'heading', level: m[1].length, runs: parseInline(m[2].replace(/\s+#+\s*$/, ''), true, flags) });
                continue;
            }
            if ((m = raw.match(/^(\s*)([-*+•●▪◦])\s+(.*)$/))) {
                blocks.push({ type: 'list', level: Math.min(6, Math.floor(m[1].length / 2)), bullet: true, runs: parseInline(m[3], true, flags) });
                continue;
            }
            if ((m = raw.match(/^(\s*)((?:\d{1,4}|[০-৯]{1,4}|[०-९]{1,4}|[a-zA-Z]|[ivxIVX]{1,5})[.)])\s+(.*)$/))) {
                blocks.push({ type: 'list', level: Math.min(6, Math.floor(m[1].length / 2)), label: m[2], runs: parseInline(m[3], true, flags) });
                continue;
            }
            if ((m = raw.match(/^\s*>\s?(.*)$/))) {
                blocks.push({ type: 'quote', runs: parseInline(m[1], true, flags) });
                continue;
            }
            blocks.push({ type: 'para', runs: parseInline(raw, true, flags) });
        }
        // Drop trailing blank lines — they would only create empty space or pages.
        while (blocks.length && blocks[blocks.length - 1].type === 'blank') blocks.pop();
        return { blocks, flags };
    }

    function plainText(runs) { return runs.map((r) => r.text).join(''); }

    function isRtl(text) {
        const m = text.match(/\p{L}/u);
        return !!m && RTL_CHAR.test(m[0]);
    }

    // ---------------------------------------------------------------
    // Fonts
    // ---------------------------------------------------------------
    const cssRequests = new Map();

    function googleFontsUrl(families) {
        const q = families.map((f) => 'family=' + encodeURIComponent(f).replace(/%20/g, '+') + ':' + FONT_SPECS[f]);
        return 'https://fonts.googleapis.com/css2?' + q.join('&') + '&display=swap';
    }

    function loadFontCss(families) {
        const missing = families.filter((f) => FONT_SPECS[f] && !cssRequests.has(f));
        if (missing.length) {
            const p = new Promise((resolve) => {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = googleFontsUrl(missing);
                link.onload = resolve;
                link.onerror = resolve; // offline: fall back to system fonts
                document.head.appendChild(link);
            });
            missing.forEach((f) => cssRequests.set(f, p));
        }
        return Promise.all(families.map((f) => cssRequests.get(f)).filter(Boolean));
    }

    function timeout(promise, ms) {
        return Promise.race([promise, new Promise((r) => setTimeout(r, ms))]);
    }

    async function ensureFonts(families, variants, sample) {
        await timeout(loadFontCss(families), 8000);
        if (!document.fonts || !document.fonts.load) return;
        const jobs = [];
        for (const f of families) {
            for (const v of variants) {
                jobs.push(document.fonts.load(`${v.italic ? 'italic ' : ''}${v.bold ? 700 : 400} 16px "${f}"`, sample)
                    .catch(() => null));
            }
        }
        await timeout(Promise.all(jobs), 12000);
    }

    function uniqueChars(str) {
        return Array.from(new Set(str)).join('');
    }

    // ---------------------------------------------------------------
    // Styles & measurement
    // ---------------------------------------------------------------
    const styleCache = new Map();

    function makeStyle(css, size, bold, italic, color) {
        const key = `${css}|${size}|${bold ? 1 : 0}|${italic ? 1 : 0}|${color}`;
        let st = styleCache.get(key);
        if (!st) {
            st = { css, size, bold: !!bold, italic: !!italic, color, fkey: `${italic ? 'i' : 'n'}${bold ? 'b' : 'r'}|${css}` };
            styleCache.set(key, st);
        }
        return st;
    }

    function cssFont(st, px) {
        return `${st.italic ? 'italic ' : ''}${st.bold ? 700 : 400} ${px}px ${st.css}`;
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

    function resetMeasurements() {
        measureCache = new Map();
        measureFont = '';
    }

    // ---------------------------------------------------------------
    // Tokenising: runs -> unbreakable "words" and breakable spaces
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

    function finishWord(tok) {
        let w = 0;
        for (const p of tok.pieces) { p.width = measure(p.text, p.st); w += p.width; }
        tok.width = w;
        return tok;
    }

    function tokenize(runs) {
        const tokens = [];
        let cur = null;
        let last = 'none';
        const endWord = () => { if (cur) { tokens.push(finishWord(cur)); cur = null; } };
        const add = (text, st) => {
            if (!cur) cur = { space: false, pieces: [], width: 0 };
            const lp = cur.pieces[cur.pieces.length - 1];
            if (lp && lp.st === st) lp.text += text;
            else cur.pieces.push({ text, st, width: 0 });
        };

        for (const run of runs) {
            const st = run.st;
            for (const seg of wordSegments(run.text)) {
                const t = seg.t;
                if (BREAK_SPACE.test(t)) {
                    endWord();
                    const lt = tokens[tokens.length - 1];
                    if (lt && lt.space && lt.st === st) lt.text += t;
                    else tokens.push({ space: true, text: t, st, width: 0 });
                    last = 'space';
                } else if (seg.word) {
                    // Two words with no space between them (Chinese, Japanese, Thai…): a break is allowed.
                    if (cur && (last === 'word' || last === 'close')) endWord();
                    add(t, st);
                    last = 'word';
                } else if (!cur) {
                    add(t, st);              // leading punctuation/symbol sticks to what follows
                    last = 'open';
                } else if (OPEN_PUNCT.test(t)) {
                    endWord();               // break allowed before an opening bracket/quote
                    add(t, st);
                    last = 'open';
                } else {
                    add(t, st);              // closing punctuation (, . ! ? । ॥ 。) never starts a line
                    last = GLUE_SYMBOL.test(t) ? 'open' : 'close';
                }
            }
        }
        endWord();
        for (const t of tokens) if (t.space) t.width = measure(t.text, t.st);
        return tokens;
    }

    function splitLongWord(tok, maxW) {
        const parts = [];
        let cur = { space: false, pieces: [], width: 0 };
        let w = 0;
        for (const p of tok.pieces) {
            for (const g of graphemes(p.text)) {
                const gw = measure(g, p.st);
                if (w > 0 && w + gw > maxW + EPS) {
                    parts.push(finishWord(cur));
                    cur = { space: false, pieces: [], width: 0 };
                    w = 0;
                }
                const lp = cur.pieces[cur.pieces.length - 1];
                if (lp && lp.st === p.st) lp.text += g;
                else cur.pieces.push({ text: g, st: p.st, width: 0 });
                w += gw;
            }
        }
        if (cur.pieces.length) parts.push(finishWord(cur));
        return parts;
    }

    function breakLines(tokens, maxW) {
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
                const parts = splitLongWord(t, maxW);
                parts.forEach((p, i) => {
                    if (i > 0) flush();
                    items.push(p); width = p.width; words = 1;
                });
            }
        }
        if (items.length || !lines.length) flush();
        return lines;
    }

    // ---------------------------------------------------------------
    // Page layout
    // ---------------------------------------------------------------
    function prepare(text, title, s) {
        const { blocks, flags } = parseBlocks(text, s.formatting);
        const all = title + '\n' + text;
        const preset = FONT_PRESETS[s.fontFamily];
        const kind = preset.kind;
        const families = preset.families.slice();
        for (const sc of SCRIPTS) {
            if (sc.re.test(all)) {
                const f = (kind === 'serif' && sc.serif) || sc.sans;
                if (!families.includes(f)) families.push(f);
            }
        }
        const latin = LATIN_FALLBACK[kind];
        if (!families.includes(latin)) families.push(latin);

        const css = families.map((f) => `"${f}"`).join(', ') + ', ' + EMOJI + ', ' + GENERIC[kind];
        const variants = [{ bold: false, italic: false }];
        if (flags.bold || title.trim()) variants.push({ bold: true, italic: false });
        if (flags.italic) variants.push({ bold: false, italic: true });
        if (flags.boldItalic) variants.push({ bold: true, italic: true });
        const sample = uniqueChars(all + '0123456789 /Pageof•◦▪…') || ' ';
        return { blocks, families, css, variants, sample, title: title.trim() };
    }

    function layoutDocument(prep, s) {
        let [pw, ph] = PAGE_SIZES[s.pageSize] || PAGE_SIZES.a4;
        if ((s.orientation === 'landscape') !== (pw > ph)) [pw, ph] = [ph, pw];
        const margin = Math.min(MARGINS[s.margins] || MARGINS.normal, pw * 0.2);
        const left = margin, right = pw - margin, top = margin, bottom = ph - margin;
        const contentW = right - left;
        const base = s.fontSize;
        const spacing = parseFloat(s.lineHeight) || 1.5;
        const color = s.color;
        const css = prep.css;
        const st = (size, bold, italic, c) => makeStyle(css, size, bold, italic, c || color);

        const pages = [];
        let page = null;
        let y = 0;
        const newPage = () => { page = { ops: [] }; pages.push(page); y = top; };
        newPage();
        const atTop = () => y <= top + EPS;

        function toRuns(runs, size, c, forceBold) {
            return runs.map((r) => ({ text: r.text, st: st(size, forceBold || r.bold, r.italic, c) }));
        }

        // Lays out one paragraph-like block and emits drawing ops.
        function flow(runs, o) {
            const size = o.size;
            const lineH = o.lineH;
            const rtl = isRtl(plainText(runs));
            const offset = o.offset || 0;
            const avail = Math.max(size * 2, contentW - offset);
            const lines = breakLines(tokenize(runs), avail);
            let align = o.align || s.align;
            if (rtl && align === 'left') align = 'right';

            if (o.keepWithNext && !atTop() && y + lineH * lines.length + o.keepWithNext > bottom) newPage();

            lines.forEach((line, i) => {
                if (y + lineH > bottom + EPS && !atTop()) newPage();
                const baseline = y + lineH / 2 + size * 0.3;
                const areaL = rtl ? left : left + offset;
                const areaR = rtl ? right - offset : right;
                const areaW = areaR - areaL;
                const free = areaW - line.width;
                const isLast = i === lines.length - 1;

                if (i === 0 && o.label) {
                    const lst = o.labelStyle;
                    const lx = rtl ? right - o.labelOffset : left + o.labelOffset;
                    page.ops.push({ k: 't', x: lx, y: baseline, s: o.label, st: lst, dir: rtl ? 'rtl' : 'ltr', align: rtl ? 'right' : 'left' });
                }
                if (o.quote) {
                    const bx = rtl ? right - 2.2 : left;
                    page.ops.push({ k: 'r', x: bx, y: y, w: 2.2, h: lineH, color: QUOTE_BAR });
                }

                // Justification: spread the free space over the gaps between words.
                let extra = 0;
                let gapMode = 'space';
                if (align === 'justify' && !isLast && free > 0) {
                    const spaces = line.items.filter((t) => t.space).length;
                    const gaps = spaces || Math.max(0, line.items.length - 1);
                    gapMode = spaces ? 'space' : 'word';
                    if (gaps) extra = free / gaps;
                    if (extra > size * (spaces ? 1.6 : 0.6)) extra = 0; // avoid ugly rivers
                }
                const justified = extra > 0;

                if (!rtl) {
                    let x = areaL;
                    if (!justified) {
                        if (align === 'center') x += free / 2;
                        else if (align === 'right') x += free;
                    }
                    line.items.forEach((t, idx) => {
                        if (t.space) { x += t.width + (justified && gapMode === 'space' ? extra : 0); return; }
                        if (justified && gapMode === 'word' && idx > 0) x += extra;
                        for (const p of t.pieces) {
                            page.ops.push({ k: 't', x, y: baseline, s: p.text, st: p.st, dir: 'ltr', align: 'left' });
                            x += p.width;
                        }
                    });
                } else {
                    let xr = areaR;
                    if (!justified && align === 'center') xr -= free / 2;
                    const styles = new Set();
                    line.items.forEach((t) => (t.space ? styles.add(t.st) : t.pieces.forEach((p) => styles.add(p.st))));
                    if (!justified && styles.size === 1) {
                        // Single style: let the browser apply the full bidi algorithm to the whole line.
                        const text = line.items.map((t) => (t.space ? t.text : t.pieces.map((p) => p.text).join(''))).join('');
                        page.ops.push({ k: 't', x: xr, y: baseline, s: text, st: styles.values().next().value, dir: 'rtl', align: 'right' });
                    } else {
                        line.items.forEach((t, idx) => {
                            if (t.space) { xr -= t.width + (justified && gapMode === 'space' ? extra : 0); return; }
                            if (justified && gapMode === 'word' && idx > 0) xr -= extra;
                            for (const p of t.pieces) {
                                xr -= p.width;
                                page.ops.push({ k: 't', x: xr, y: baseline, s: p.text, st: p.st, dir: 'rtl', align: 'left' });
                            }
                        });
                    }
                }
                y += lineH;
            });
        }

        const lineH = base * spacing;

        // Document title
        if (prep.title) {
            const tSize = Math.min(base * 1.9, 40);
            const tAlign = s.align === 'center' || s.align === 'right' ? s.align : 'left';
            flow([{ text: prep.title, st: st(tSize, true, false) }], { size: tSize, lineH: tSize * 1.3, align: tAlign });
            y += base * 0.55;
            page.ops.push({ k: 'l', x1: left, y1: y, x2: right, y2: y, w: 0.8, color: RULE });
            y += base * 1.3;
        }

        const HEADING = { 1: 1.6, 2: 1.32, 3: 1.14 };
        const BULLETS = ['•', '◦', '▪'];
        const indentStep = base * 1.5;

        for (const b of prep.blocks) {
            switch (b.type) {
                case 'pagebreak':
                    if (!(atTop() && page.ops.length === 0)) newPage();
                    break;
                case 'blank':
                    if (atTop() && pages.length > 1) break;      // don't start a page with empty lines
                    y += lineH;
                    if (y > bottom) newPage();
                    break;
                case 'hr':
                    if (y + lineH > bottom) newPage();
                    page.ops.push({ k: 'l', x1: left, y1: y + lineH / 2, x2: right, y2: y + lineH / 2, w: 0.8, color: RULE });
                    y += lineH;
                    break;
                case 'heading': {
                    const size = base * HEADING[b.level];
                    if (!atTop()) y += base * (b.level === 1 ? 0.9 : 0.6);
                    const hAlign = s.align === 'justify' ? 'left' : s.align;
                    flow(toRuns(b.runs, size, null, true), {
                        size, lineH: size * Math.max(1.25, Math.min(spacing, 1.45)), align: hAlign, keepWithNext: lineH * 2,
                    });
                    y += base * 0.3;
                    break;
                }
                case 'list': {
                    const labelOffset = b.level * indentStep;
                    const label = b.bullet ? BULLETS[b.level % BULLETS.length] : b.label;
                    const lst = st(base, false, false);
                    const labelW = measure(label, lst);
                    const textOffset = labelOffset + Math.max(base * 1.3, labelW + base * 0.5);
                    flow(toRuns(b.runs, base), { size: base, lineH, offset: textOffset, label, labelStyle: lst, labelOffset });
                    break;
                }
                case 'quote':
                    flow(toRuns(b.runs, base, '#4b5563'), { size: base, lineH, offset: base * 1.1, quote: true });
                    break;
                default:
                    flow(toRuns(b.runs, base), { size: base, lineH });
            }
        }

        // Running header & page numbers
        const total = pages.length;
        const small = Math.max(7, base * 0.75);
        const smallSt = st(small, false, false, MUTED);
        pages.forEach((pg, i) => {
            if (s.pageNumbers !== 'none') {
                const label = s.pageNumbers === 'full' ? `Page ${i + 1} of ${total}` : `${i + 1} / ${total}`;
                const by = ph - margin / 2 + small * 0.3;
                const lx = pw / 2 - measure(label, smallSt) / 2;
                pg.ops.push({ k: 't', x: lx, y: by, s: label, st: smallSt, dir: 'ltr', align: 'left' });
            }
            if (s.runningHeader && prep.title && i > 0) {
                let label = prep.title;
                const maxW = contentW * 0.8;
                if (measure(label, smallSt) > maxW) {
                    const g = graphemes(label);
                    while (g.length > 1 && measure(g.join('') + '…', smallSt) > maxW) g.pop();
                    label = g.join('') + '…';
                }
                const rtl = isRtl(label);
                const hy = margin / 2 + small * 0.3;
                pg.ops.push({ k: 't', x: rtl ? right : left, y: hy, s: label, st: smallSt, dir: rtl ? 'rtl' : 'ltr', align: rtl ? 'right' : 'left' });
                const ry = hy + small * 0.6;
                if (ry < top - 4) pg.ops.push({ k: 'l', x1: left, y1: ry, x2: right, y2: ry, w: 0.5, color: RULE });
            }
        });

        return { pages, pw, ph };
    }

    // ---------------------------------------------------------------
    // Rendering
    // ---------------------------------------------------------------
    function renderPage(ctx, page, scale) {
        const c = ctx.canvas;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.textBaseline = 'alphabetic';
        let font = '';
        for (const op of page.ops) {
            if (op.k === 't') {
                const f = cssFont(op.st, op.st.size * scale);
                if (f !== font) { ctx.font = f; font = f; }
                ctx.fillStyle = op.st.color;
                ctx.direction = op.dir;
                ctx.textAlign = op.align;
                ctx.fillText(op.s, op.x * scale, op.y * scale);
            } else if (op.k === 'l') {
                ctx.strokeStyle = op.color;
                ctx.lineWidth = Math.max(1, op.w * scale);
                ctx.beginPath();
                ctx.moveTo(op.x1 * scale, op.y1 * scale);
                ctx.lineTo(op.x2 * scale, op.y2 * scale);
                ctx.stroke();
            } else if (op.k === 'r') {
                ctx.fillStyle = op.color;
                ctx.fillRect(op.x * scale, op.y * scale, op.w * scale, op.h * scale);
            }
        }
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
        const cssW = el.clientWidth || 600;
        const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
        const scale = (cssW * dpr) / layoutState.pw;
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
            const num = document.createElement('span');
            num.className = 'page-num';
            el.append(canvas, num);
            el._index = pageEls.length;
            els.pages.appendChild(el);
            pageEls.push(el);
            if (observer) observer.observe(el);
            else el._visible = true;
        }
        while (pageEls.length > n) {
            const el = pageEls.pop();
            if (observer) observer.unobserve(el);
            el.remove();
        }
        pageEls.forEach((el, i) => {
            el.style.aspectRatio = `${lay.pw} / ${lay.ph}`;
            el.lastChild.textContent = `${i + 1}`;
            el.firstChild.setAttribute('aria-label', `Page ${i + 1} of ${n}`);
            if (el._visible || (!observer) || i < 2) drawPreviewPage(el);
        });
        const label = `${n} page${n === 1 ? '' : 's'}`;
        els.pageBadge.textContent = label;
        els.statPages.textContent = n;
    }

    async function computeLayout() {
        const s = readSettings();
        const text = els.text.value;
        const title = els.title.value;
        const prep = prepare(text, title, s);
        await ensureFonts(prep.families, prep.variants, prep.sample);
        return { lay: layoutDocument(prep, s), s, prep };
    }

    async function update() {
        const seq = ++updateSeq;
        try {
            const { lay } = await computeLayout();
            if (seq !== updateSeq) return;
            renderPreview(lay);
        } catch (err) {
            console.error(err);
        }
    }

    let updateTimer = 0;
    function scheduleUpdate(delay) {
        clearTimeout(updateTimer);
        updateTimer = setTimeout(update, delay === undefined ? 220 : delay);
    }

    // ---------------------------------------------------------------
    // Stats
    // ---------------------------------------------------------------
    function updateStats() {
        const text = els.text.value;
        let words = 0;
        if (wordSegmenter && text.length < 400000) {
            for (const seg of wordSegmenter.segment(text)) if (seg.isWordLike) words++;
        } else {
            words = (text.match(/\S+/g) || []).length;
        }
        const chars = graphemeSegmenter && text.length < 400000
            ? Array.from(graphemeSegmenter.segment(text)).length : Array.from(text).length;
        els.statWords.textContent = words.toLocaleString();
        els.statChars.textContent = chars.toLocaleString();
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
            if (canvas.toBlob) {
                canvas.toBlob((blob) => {
                    if (!blob) return reject(new Error('Could not encode the page image.'));
                    blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
                }, 'image/jpeg', JPEG_QUALITY);
            } else {
                resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
            }
        });
    }

    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

    function defaultFileName() {
        const source = els.title.value.trim() ||
            (els.text.value.split('\n').find((l) => l.trim()) || '').replace(/^[\s#>*\-•]+/, '').replace(/[*_`]/g, '');
        const g = graphemes(source.trim());
        let name = g.slice(0, 48).join('');
        name = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
        return name || 'document';
    }

    function currentFileName() {
        let name = els.fileName.value.trim().replace(/\.pdf$/i, '');
        name = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
        return (name || defaultFileName()) + '.pdf';
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
        els.download.disabled = true;
        els.share.disabled = true;
        labelEl.textContent = 'Preparing…';
        try {
            const [jsPDF, { lay, s, prep }] = await Promise.all([loadJsPDF(), computeLayout()]);
            const { pw, ph, pages } = lay;
            const scale = (DPI[s.quality] || DPI.high) / 72;
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(pw * scale);
            canvas.height = Math.round(ph * scale);
            const ctx = canvas.getContext('2d', { alpha: false }) || canvas.getContext('2d');
            const orientation = pw > ph ? 'landscape' : 'portrait';
            const pdf = new jsPDF({ orientation, unit: 'pt', format: [pw, ph], compress: true });
            pdf.setProperties({
                title: prep.title || defaultFileName(),
                subject: 'Created with Text to PDF',
                creator: 'Text to PDF by Suman',
            });
            if (pdf.setLanguage) {
                const lang = /\p{Script=Bengali}/u.test(prep.sample) ? 'bn' : 'en';
                try { pdf.setLanguage(lang); } catch (e) { /* optional */ }
            }
            for (let i = 0; i < pages.length; i++) {
                labelEl.textContent = pages.length > 1 ? `Creating… ${i + 1}/${pages.length}` : 'Creating…';
                if (i > 0) pdf.addPage([pw, ph], orientation);
                renderPage(ctx, pages[i], scale);
                const img = await canvasToJpeg(canvas);
                pdf.addImage(img, 'JPEG', 0, 0, pw, ph, `page${i}`, 'NONE');
                await nextFrame();
            }
            return { blob: pdf.output('blob'), name: currentFileName(), pages: pages.length };
        } catch (err) {
            console.error(err);
            toast(err && err.message ? err.message : 'Something went wrong while creating the PDF.', true);
            return null;
        } finally {
            busy = false;
            labelEl.textContent = original;
            els.download.disabled = false;
            els.share.disabled = false;
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
        toast(`Saved ${result.name} · ${result.pages} page${result.pages === 1 ? '' : 's'} · ${formatBytes(result.blob.size)}`);
    }

    async function sharePdf() {
        if (busy) return;
        const result = await buildPdf(els.share);
        if (!result) return;
        const file = new File([result.blob], result.name, { type: 'application/pdf' });
        try {
            await navigator.share({ files: [file], title: result.name.replace(/\.pdf$/, '') });
        } catch (err) {
            if (err && err.name !== 'AbortError') toast('Sharing failed. Try downloading instead.', true);
        }
    }

    function formatBytes(n) {
        if (n < 1024) return n + ' B';
        if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
        return (n / 1024 / 1024).toFixed(1) + ' MB';
    }

    // ---------------------------------------------------------------
    // UI helpers
    // ---------------------------------------------------------------
    let toastTimer = 0;
    function toast(message, isError) {
        els.toast.textContent = message;
        els.toast.classList.toggle('error', !!isError);
        els.toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => els.toast.classList.remove('show'), isError ? 5000 : 3500);
    }

    function readFile(file) {
        if (!file) return;
        if (file.size > 10 * 1024 * 1024) { toast('That file is too large (max 10 MB).', true); return; }
        const reader = new FileReader();
        reader.onload = () => {
            els.text.value = String(reader.result || '');
            if (!els.title.value.trim()) {
                // Use the file name as the default PDF name, not as a visible title.
                els.fileName.value = file.name.replace(/\.[^.]+$/, '');
            }
            onTextChange();
            toast(`Loaded ${file.name}`);
        };
        reader.onerror = () => toast('Could not read that file.', true);
        reader.readAsText(file);
    }

    const SAMPLE_TITLE = 'বাংলা ও বহুভাষিক নমুনা';
    const SAMPLE_TEXT = [
        '# আমার সোনার বাংলা',
        '**রবীন্দ্রনাথ ঠাকুর** রচিত এই গানটি বাংলাদেশের জাতীয় সংগীত।',
        '',
        '> আমার সোনার বাংলা, আমি তোমায় ভালোবাসি।',
        '> চিরদিন তোমার আকাশ, তোমার বাতাস, আমার প্রাণে বাজায় বাঁশি॥',
        '',
        '## কেন এই টুল?',
        'বাংলা ভাষা পৃথিবীর অন্যতম সমৃদ্ধ ভাষা। এই টুলটি আপনার ব্রাউজারের নিজস্ব টাইপসেটিং ইঞ্জিন ব্যবহার করে প্রতিটি যুক্তাক্ষর, কার-চিহ্ন ও রেফ সঠিকভাবে প্রদর্শন করে, এবং দীর্ঘ অনুচ্ছেদকে পৃষ্ঠার প্রস্থ অনুযায়ী সুন্দরভাবে ভাঙে — কোনো শব্দ মাঝখান থেকে কাটা পড়ে না।',
        '',
        '- যুক্তাক্ষর: ক্ষ, জ্ঞ, ন্ত্র, স্ত্র, ক্র, র্ক, ঙ্গ, ষ্ণ',
        '- বাংলা সংখ্যা: ০১২৩৪৫৬৭৮৯',
        '- *Mixed text* works too — English, বাংলা, हिन्दी, العربية, 日本語',
        '',
        '## Smart wrapping',
        'Long paragraphs wrap at word boundaries in every language, punctuation never starts a new line, and very long words or links such as https://example.com/a/really/long/address/that/would/not/fit/on/one/line are broken safely between characters.',
        '',
        '1. Choose a font, size and alignment',
        '2. Watch the live preview on the right',
        '3. Click **Download PDF**',
    ].join('\n');

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
        els.fileName.placeholder = defaultFileName();
    }

    function onSettingsChange() {
        styleCache.clear();
        store.set('ttp.settings', JSON.stringify(readSettings()));
        scheduleUpdate(60);
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
        document.querySelectorAll('.settings select, .settings input:not(#fileName)').forEach((el) => {
            el.addEventListener(el.type === 'number' ? 'input' : 'change', onSettingsChange);
        });
        els.fontSize.addEventListener('blur', () => { els.fontSize.value = readSettings().fontSize; });

        $('resetBtn').addEventListener('click', () => {
            applySettings(DEFAULTS);
            onSettingsChange();
            toast('Settings reset to defaults');
        });
        $('sampleBtn').addEventListener('click', () => {
            if (els.text.value.trim() && !confirm('Replace your current text with the sample?')) return;
            els.text.value = SAMPLE_TEXT;
            els.title.value = SAMPLE_TITLE;
            if (!els.formatting.checked) { els.formatting.checked = true; onSettingsChange(); }
            onTextChange();
        });
        $('clearBtn').addEventListener('click', () => {
            if (!els.text.value && !els.title.value) return;
            if (!confirm('Clear all text?')) return;
            els.text.value = '';
            els.title.value = '';
            els.fileName.value = '';
            onTextChange();
            els.text.focus();
        });

        els.fileInput.addEventListener('change', () => {
            readFile(els.fileInput.files[0]);
            els.fileInput.value = '';
        });
        ['dragenter', 'dragover'].forEach((type) => els.dropZone.addEventListener(type, (e) => {
            if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
            e.preventDefault();
            els.dropZone.classList.add('dragging');
        }));
        ['dragleave', 'drop'].forEach((type) => els.dropZone.addEventListener(type, () => els.dropZone.classList.remove('dragging')));
        els.dropZone.addEventListener('drop', (e) => {
            if (!e.dataTransfer || !e.dataTransfer.files.length) return;
            e.preventDefault();
            readFile(e.dataTransfer.files[0]);
        });

        els.download.addEventListener('click', downloadPdf);
        els.share.addEventListener('click', sharePdf);
        try {
            const probe = new File(['x'], 'probe.pdf', { type: 'application/pdf' });
            if (navigator.canShare && navigator.canShare({ files: [probe] })) els.share.hidden = false;
        } catch (e) { /* sharing unsupported */ }

        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
                e.preventDefault();
                downloadPdf();
            }
        });

        // Re-measure once web fonts finish loading so metrics are exact.
        if (document.fonts && document.fonts.addEventListener) {
            document.fonts.addEventListener('loadingdone', () => {
                resetMeasurements();
                scheduleUpdate(50);
            });
        }
        let resizeTimer = 0;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => { if (layoutState) renderPreview(layoutState); }, 150);
        });

        updateStats();
        els.fileName.placeholder = defaultFileName();
        update();
    }

    init();
})();
