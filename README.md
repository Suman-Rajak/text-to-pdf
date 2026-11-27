# Text to PDF

Convert plain text into clean, professionally typeset PDFs. It works with **any language**, with first-class support for **Bengali (বাংলা)**.

## Features

- **Correct rendering for complex scripts.** Bengali conjuncts (যুক্তাক্ষর), vowel signs and reph, Devanagari, Arabic and Hebrew (right-to-left), Thai, Chinese, Japanese, Korean and more. Text is shaped by the browser's own typesetting engine, then placed into the PDF.
- **Smart word wrapping.** Lines break at real word boundaries for every language, including dictionary-based breaking for Thai and CJK. Punctuation such as `,` `।` `॥` `。` never starts a line, and very long words or URLs are split safely without breaking a conjunct.
- **Live, page-accurate preview.**
- Fonts: Noto Sans/Serif, Hind Siliguri, Noto Sans/Serif Bengali, Tiro Bangla, Baloo Da 2, Roboto, Merriweather and Noto Sans Mono. Fonts for other scripts load automatically when needed.
- Page size (A4, Letter, Legal, A5), orientation, margins, line spacing, alignment (including justify) and text colour.
- Optional document title, running header and page numbers.
- Optional basic formatting: `# headings`, `**bold**`, `*italic*`, lists, `> quotes`, `---` dividers and `[pagebreak]`.
- Open or drag-and-drop `.txt` files, auto-saved drafts, share on mobile, and <kbd>Ctrl</kbd>+<kbd>S</kbd> to download.
- Runs 100% in the browser, so your text never leaves your device.

## Usage

Open `index.html` in a browser, or host the folder on any static host such as GitHub Pages. An internet connection is needed the first time, to load the fonts and the jsPDF library.

> Note: pages are embedded as high-resolution images (150–300 DPI). This is what guarantees correct Bengali rendering, which PDF libraries can't do on their own. The trade-off is that text in the PDF can't be selected or searched.
