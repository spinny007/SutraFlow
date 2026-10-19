import fs from 'node:fs';
import path from 'node:path';
import { zipFiles } from './bundles.js';

/**
 * Documents for the RAG samples: the policies of Asha Traders (the samples' tea and crockery shop)
 * as a PDF, a Word document, a PowerPoint deck and a Markdown FAQ. Made here, not stored as binary
 * files, so they are always the same and open in Office, LibreOffice and PDF readers.
 */

const xmlEsc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

// ---------- content ----------
const RETURNS = {
  title: 'Asha Traders - Returns and refunds policy',
  pages: [[
    'Asha Traders - Returns and refunds policy',
    'Effective 1 April 2026. Applies to orders from our website, phone and WhatsApp.',
    '',
    '1. Returns window',
    'You can return an item within 30 days of delivery. The item must be unused, in its',
    'original packing, with the invoice or order number.',
    '',
    '2. What cannot be returned',
    'Opened tea packs, opened spice blends and gift cards cannot be returned, for hygiene',
    'reasons. Unopened tea packs can be returned within 30 days like any other item.',
    '',
    '3. Damaged or wrong items',
    'If an item arrives broken or is not what you ordered, tell the order desk within 48 hours',
    'of delivery with a photo of the item and the packing. We send a replacement or a full',
    'refund, including shipping, and you do not need to send the broken item back.',
  ], [
    '4. Refunds',
    'Refunds go to the original payment method within 5 to 7 working days after we receive',
    'the returned item. Cash on delivery orders are refunded by bank transfer (UPI or NEFT)',
    'to the account you give us. Shipping charges are refunded only for damaged or wrong items.',
    '',
    '5. How to request a return',
    'Write to the order desk with your order number (for example A-1001) and the reason.',
    'We arrange a pickup in Pune and the metro cities; elsewhere you send the item by any',
    'courier and we refund the courier charge up to Rs. 100.',
    '',
    '6. Exchanges',
    'Clay cups and crockery can be exchanged for another design of the same price within',
    '30 days. Exchanges are shipped free of charge.',
  ]],
};
const SHIPPING = {
  title: 'Shipping and delivery guide',
  blocks: [
    ['h', 'Shipping and delivery guide'],
    ['p', 'Asha Traders ships from its warehouse in Pune, Maharashtra, Monday to Saturday.'],
    ['h', 'Delivery times'],
    ['p', 'Pune: same day for orders placed before 12:00, otherwise the next day.'],
    ['p', 'Mumbai, Delhi, Bengaluru, Chennai, Hyderabad and Kolkata: 2 to 4 working days.'],
    ['p', 'Rest of India: 4 to 7 working days. We do not ship outside India yet.'],
    ['h', 'Carriers and tracking'],
    ['p', 'Orders travel with Blue Dart or Delhivery. The tracking number is sent by SMS and email when the order leaves the warehouse; the order desk can also tell you where an order is.'],
    ['h', 'Charges'],
    ['p', 'Shipping is free for orders of Rs. 999 or more. Smaller orders pay Rs. 79. Cash on delivery is available for orders up to Rs. 5,000 and costs Rs. 40 extra.'],
    ['h', 'Fragile items'],
    ['p', 'Clay cups and crockery are packed in double boxes with paper padding. Check the box when it arrives; if it is damaged, note it on the courier receipt and send us a photo within 48 hours.'],
  ] as ['h' | 'p', string][],
};
const CATALOGUE = {
  title: 'Asha Traders tea and crockery catalogue 2026',
  slides: [
    ['Asha Traders catalogue 2026', 'Teas from Assam and Darjeeling, spice blends and hand-made clay cups. Pune, since 1998.'],
    ['Assam tea 500 g (TEA-01)', 'Price Rs. 240. Strong, malty black tea for milk tea. Brew with water at 95 C for 3 to 4 minutes; one teaspoon per cup.'],
    ['Darjeeling first flush 250 g (TEA-07)', 'Price Rs. 520. Light and flowery. Brew at 85 C for 3 minutes, without milk. Do not boil the leaves.'],
    ['Masala chai blend 250 g (CHAI-03)', 'Price Rs. 300. Assam tea with cardamom, ginger, cinnamon and clove. Simmer with milk and sugar for 5 minutes.'],
    ['Clay cups, set of 6 (CUP-02)', 'Price Rs. 450. Hand-made kulhad cups, 150 ml. Wash by hand in warm water; not for the microwave or dishwasher.'],
    ['Storage', 'Keep tea in an airtight tin away from light and spices. Opened packs stay fresh for 6 months.'],
  ],
};
const FAQ = `# Order desk FAQ

## Can I change my delivery address?
Yes, until the order leaves the warehouse. Write to the order desk with the order number and the new address.

## Do you sell wholesale?
Cafes and shops can buy in bulk from 10 kg of tea or 60 cups, with 15 percent off the list price. Ask the order desk for a quote.

## Which tea is best for milk tea?
Assam tea (TEA-01) or the masala chai blend (CHAI-03). Darjeeling is best without milk.

## How do I pay?
UPI, cards, net banking, or cash on delivery for orders up to Rs. 5,000.
`;

// ---------- PDF ----------
function pdf(title: string, pages: string[][]) {
  const objs: string[] = [];
  const add = (s: string) => { objs.push(s); return objs.length; };
  const catalog = add(''), pagesId = add(''), font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'), bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageIds: number[] = [];
  for (const lines of pages) {
    const esc = (s: string) => s.replace(/[\\()]/g, m => '\\' + m);
    let y = 790;
    const body = lines.map((l, i) => {
      const head = i === 0 || /^\d+\. /.test(l) || l === lines[0];
      const t = l ? `BT /${head ? 'F2' : 'F1'} ${i === 0 && l === pages[0][0] ? 16 : head ? 12 : 11} Tf 56 ${y} Td (${esc(l)}) Tj ET` : '';
      y -= l ? (i === 0 ? 26 : 16) : 10;
      return t;
    }).filter(Boolean).join('\n');
    const content = add(`<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R /F2 ${bold} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(p => `${p} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const info = add(`<< /Title (${title.replace(/[\\()]/g, m => '\\' + m)}) /Producer (SutraFlow) >>`);
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ---------- Word ----------
function docx(blocks: ['h' | 'p', string][]) {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const paras = blocks.map(([k, t], i) => k === 'h'
    ? `<w:p><w:pPr><w:spacing w:before="${i ? 240 : 0}" w:after="120"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="${i ? 28 : 36}"/></w:rPr><w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r></w:p>`
    : `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:t xml:space="preserve">${xmlEsc(t)}</w:t></w:r></w:p>`).join('');
  return zipFiles([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${paras}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`],
  ]);
}

// ---------- PowerPoint ----------
function pptx(slides: string[][]) {
  const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const rels = (items: [string, string, string][]) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`).join('')}</Relationships>`;
  const tree = (shapes = '') => `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes}</p:spTree></p:cSld>`;
  const box = (id: number, name: string, y: number, h: number, size: number, bold: boolean, text: string) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="${y}"/><a:ext cx="8229600" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="en-IN" sz="${size}"${bold ? ' b="1"' : ''} dirty="0"/><a:t>${xmlEsc(text)}</a:t></a:r></a:p></p:txBody></p:sp>`;
  const sysClr = (n: string, v: string, last: string) => `<a:${n}><a:sysClr val="${v}" lastClr="${last}"/></a:${n}>`;
  const srgb = (n: string, v: string) => `<a:${n}><a:srgbClr val="${v}"/></a:${n}>`;
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const theme = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="SutraFlow"><a:themeElements><a:clrScheme name="SutraFlow">${sysClr('dk1', 'windowText', '000000')}${sysClr('lt1', 'window', 'FFFFFF')}${srgb('dk2', '1F2937')}${srgb('lt2', 'F3F4F6')}${srgb('accent1', '2F6FD8')}${srgb('accent2', 'D97706')}${srgb('accent3', '059669')}${srgb('accent4', '7C3AED')}${srgb('accent5', 'DB2777')}${srgb('accent6', '0891B2')}${srgb('hlink', '2F6FD8')}${srgb('folHlink', '7C3AED')}</a:clrScheme><a:fontScheme name="SutraFlow"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="SutraFlow"><a:fillStyleLst>${fill}${fill}${fill}</a:fillStyleLst><a:lnStyleLst><a:ln w="6350">${fill}</a:ln><a:ln w="12700">${fill}</a:ln><a:ln w="19050">${fill}</a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst>${fill}${fill}${fill}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
  const clrMap = 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"';
  const files: [string, string][] = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((_s, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', rels([['rId1', 'officeDocument', 'ppt/presentation.xml']])],
    ['ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_s, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000" type="screen4x3"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`],
    ['ppt/_rels/presentation.xml.rels', rels([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ...slides.map((_s, i) => [`rId${i + 2}`, 'slide', `slides/slide${i + 1}.xml`] as [string, string, string]), [`rId${slides.length + 2}`, 'theme', 'theme/theme1.xml']])],
    ['ppt/slideMasters/slideMaster1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster ${NS}>${tree()}<p:clrMap ${clrMap}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`],
    ['ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']])],
    ['ppt/slideLayouts/slideLayout1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ${NS} type="blank" preserve="1">${tree().replace('<p:cSld>', '<p:cSld name="Blank">')}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`],
    ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']])],
    ['ppt/theme/theme1.xml', theme],
  ];
  slides.forEach(([title, body], i) => {
    files.push([`ppt/slides/slide${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}>${tree(box(2, 'Title', 457200, 1143000, i ? 3200 : 4000, true, title) + box(3, 'Text', 1828800, 3657600, 2200, false, body))}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`]);
    files.push([`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']])]);
  });
  return zipFiles(files);
}

/** The sample documents, by file name. */
export function sampleDocuments(): [string, Buffer][] {
  return [
    ['returns-policy.pdf', pdf(RETURNS.title, RETURNS.pages)],
    ['shipping-guide.docx', docx(SHIPPING.blocks)],
    ['tea-catalogue.pptx', pptx(CATALOGUE.slides)],
    ['faq.md', Buffer.from(FAQ, 'utf8')],
  ];
}

/** Writes the sample documents into a folder (kept when already there, so edits survive). */
export function writeSampleDocuments(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  const written: string[] = [];
  for (const [name, data] of sampleDocuments()) {
    const f = path.join(dir, name);
    if (!fs.existsSync(f)) { fs.writeFileSync(f, data); written.push(name); }
  }
  return written;
}
