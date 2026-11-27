# Text to PDF

A minimal tool that turns text into a clean PDF, in **any language**, including **Bengali (বাংলা)**.

- Type or paste your text, add an optional title, then pick a font, size, line spacing and page size (A4 or Letter).
- Bengali conjuncts (যুক্তাক্ষর), vowel signs and reph render correctly. So do Hindi, Arabic, Chinese, Thai and other scripts, because the browser's own text engine draws the text.
- Long lines wrap at word boundaries, punctuation like `।` never starts a line, and very long links are split safely.
- There's a live preview, page numbers on multi-page documents, drag-and-drop for `.txt` files and <kbd>Ctrl</kbd>+<kbd>S</kbd> to download.
- Everything runs in the browser, so your text never leaves your device.

Open `index.html` or host the folder on any static host such as GitHub Pages. An internet connection is needed to load the fonts and jsPDF.

> Pages are embedded as high-resolution images (220 DPI). That keeps Bengali correct, but text in the PDF can't be selected or searched.
