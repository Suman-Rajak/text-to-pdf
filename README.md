# Text to PDF

A minimal tool that turns text into a clean PDF, in **any language**, including **Bengali (বাংলা)**.

- Type or paste your text, add an optional title, then pick a font, size, line spacing and page size (A4 or Letter).
- Bengali conjuncts (যুক্তাক্ষর), vowel signs and reph render correctly. So do Hindi, Arabic, Chinese, Thai and other scripts, because the browser's own text engine draws the text.
- Long lines wrap at word boundaries, punctuation like `।` never starts a line, and very long links are split safely.
- **Image to text (OCR):** open, drop or paste (**Paste** button or <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>V</kbd> anywhere) a photo, scan or screenshot, and its English and Bengali text is extracted into the editor. It runs on-device with [Tesseract.js](https://github.com/naptha/tesseract.js) and these accuracy steps:
  - grayscale, resizing and lighting correction
  - several readings, keeping the one the engine is most confident about
  - a Bengali-only second pass for words the combined model gets wrong
  - danda (`।`/`॥`) cleanup, and rejoining wrapped lines into paragraphs while keeping short lines such as poems
- There's a live preview, page numbers on multi-page documents and <kbd>Ctrl</kbd>+<kbd>S</kbd> to download.
- Everything runs in the browser, so your text never leaves your device.

Open `index.html` or host the folder on any static host such as GitHub Pages. An internet connection is needed to load the fonts, jsPDF and, the first time you open an image, the OCR engine (about 8 MB, cached afterwards).

> Pages are embedded as high-resolution images (220 DPI). That keeps Bengali correct, but text in the PDF can't be selected or searched.
