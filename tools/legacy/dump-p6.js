const fs = require('fs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');

(async () => {
  const data = new Uint8Array(fs.readFileSync('uploads/DMI 06-2026.pdf'));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items = content.items.filter(it => it.str.trim()).map(it => ({
      str: it.str.trim(), x: Math.round(it.transform[4]), y: Math.round(it.transform[5])
    }));
    console.log('--- PAGE ' + i + ' ---');
    items.forEach(it => console.log('  Y=' + it.y + ' X=' + it.x + ' "' + it.str + '"'));
  }
})();
