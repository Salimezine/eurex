const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const fs = require('fs');

async function extractAll() {
  const data = new Uint8Array(fs.readFileSync('D:/base de paie/LP 06.2026.PDF'));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  
  let fullText = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map(item => ({
      str: item.str,
      x: Math.round(item.transform[4]),
      y: Math.round(item.transform[5]),
    }));
    // Sort by Y (descending = top to bottom), then X
    strings.sort((a, b) => b.y - a.y || a.x - b.x);
    
    fullText += '\n=== PAGE ' + i + ' ===\n';
    let lastY = null;
    for (const s of strings) {
      if (lastY !== null && Math.abs(s.y - lastY) > 5) fullText += '\n';
      fullText += s.str + ' ';
      lastY = s.y;
    }
  }
  
  fs.writeFileSync('D:/base de paie/bulletin_parsed.txt', fullText, 'utf8');
  console.log('Written to bulletin_parsed.txt, length:', fullText.length);
}

extractAll().catch(e => console.error('Error:', e.message));
