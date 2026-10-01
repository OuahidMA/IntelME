/**
 * Builds a real .docx and a real .pdf containing the same CV text, so the upload
 * pipeline can be tested against actual files rather than stubs.
 *
 * A .docx is a zip of XML, written here with no dependencies. The .pdf is
 * written by hand as a minimal uncompressed PDF with a single text object.
 */
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", "uploads", "__fixtures__");

export const CV_TEXT = `John Doe
john@example.com | +212 600 123 456 | Casablanca, Morocco
github.com/johndoe

PROFESSIONAL SUMMARY
Frontend developer with 3 years of experience building React and TypeScript applications. Shipped 8 projects and improved page load time by 40 percent.

SKILLS
React, TypeScript, JavaScript, REST APIs, Git, Tailwind CSS, Node.js, MongoDB

WORK EXPERIENCE
Senior Frontend Developer, Cartograph, 2023-04 - Present
Led the design system team and cut bundle size by 34 percent across 3 products.
Frontend Engineer, Meridian, 2021-01 - 2023-03
Shipped the checkout revamp serving 12000 users and owned the analytics pipeline.

EDUCATION
Master in Computer Science, University of Casablanca, 2019 - 2021

CERTIFICATIONS
AWS Certified Developer, Amazon, 2023

PROJECTS
Intelme - CV analysis platform. React, Node.js, MongoDB.
Design System - component library. Storybook, React.`;

const escapeXml = (value) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Minimal store/deflate zip writer, enough for a valid .docx. */
function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, "utf8");
    const deflated = zlib.deflateRawSync(data);
    const crc = zlib.crc32 ? zlib.crc32(data) : crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, deflated);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(0, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(deflated.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBuf.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(offset, 42);

    central.push(header, nameBuf);
    offset += local.length + nameBuf.length + deflated.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, end]);
}

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
  }

  let crc = -1;
  for (const byte of buf) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];

  return (crc ^ -1) >>> 0;
}

async function buildDocx() {
  const paragraphs = CV_TEXT.split("\n")
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`)
    .join("");

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${paragraphs}</w:body>
</w:document>`;

  return zip([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rels, "utf8") },
    { name: "word/document.xml", data: Buffer.from(document, "utf8") },
  ]);
}

/** Minimal single-page PDF with a real text layer, so pdf-parse reads it. */
async function buildPdf() {
  const lines = CV_TEXT.split("\n");
  const textOps = lines
    .map((line, i) => {
      const escaped = line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
      return `BT /F1 10 Tf 40 ${740 - i * 14} Td (${escaped}) Tj ET`;
    })
    .join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(textOps, "utf8")} >>\nstream\n${textOps}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [];

  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}

/**
 * A PDF whose page contains no text object at all — only a rasterised image of
 * the CV, which is what a scanner or a phone camera produces. This is the input
 * the OCR fallback exists for, so it has to be a real render rather than a stub.
 */
async function buildScannedPdf() {
  const { createCanvas, GlobalFonts } = await import("@napi-rs/canvas");

  // Any real TTF works; Arial ships with Windows and DejaVu with most Linux
  // distros, so one of the two is normally present.
  for (const fontPath of [
    "C:\\Windows\\Fonts\\arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
  ]) {
    if (await exists(fontPath)) {
      GlobalFonts.registerFromPath(fontPath, "ScanFont");
      break;
    }
  }

  const width = 1240;
  const height = 1754; // A4 at 150 dpi
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000000";
  ctx.font = '30px "ScanFont"';

  let y = 140;
  for (const line of CV_TEXT.split("\n")) {
    ctx.fillText(line, 80, y);
    y += 46;
  }

  const { data } = ctx.getImageData(0, 0, width, height);

  // PDF image data is raw samples, so drop the alpha channel.
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i];
    rgb[j + 1] = data[i + 1];
    rgb[j + 2] = data[i + 2];
  }

  const compressed = zlib.deflateSync(rgb);

  const imageObj =
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
    `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${compressed.length} >>\n` +
    `stream\n`;

  // Map the image onto the full page. Anything taller than the MediaBox would
  // push the first lines off the top of the page, where the renderer crops them
  // and OCR never sees them.
  const content = `q 612 0 0 792 0 0 cm /Im0 Do Q`;
  const contentObj = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>",
    imageObj + compressed.toString("binary") + "\nendstream",
    contentObj,
  ];

  return buildPdfFromObjects(objects);
}

/** Assembles the object list, xref table and trailer into a valid PDF. */
function buildPdfFromObjects(objects) {
  let pdf = "%PDF-1.4\n";
  const offsets = [];

  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "binary");
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

await fs.mkdir(OUT_DIR, { recursive: true });

const docxPath = path.join(OUT_DIR, "john-doe-cv.docx");
const pdfPath = path.join(OUT_DIR, "john-doe-cv.pdf");
const scannedPath = path.join(OUT_DIR, "scanned-cv.pdf");
const badPath = path.join(OUT_DIR, "not-a-cv.exe");

await fs.writeFile(docxPath, await buildDocx());
await fs.writeFile(pdfPath, await buildPdf());
await fs.writeFile(scannedPath, await buildScannedPdf());
await fs.writeFile(badPath, Buffer.from("MZ\u0000\u0000", "utf8"));

console.log("docx    :", docxPath, (await fs.stat(docxPath)).size, "bytes");
console.log("pdf     :", pdfPath, (await fs.stat(pdfPath)).size, "bytes");
console.log("scanned :", scannedPath, (await fs.stat(scannedPath)).size, "bytes");
console.log("rejected:", badPath, (await fs.stat(badPath)).size, "bytes");
