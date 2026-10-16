const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { filePath } = require('./files');
const { STATUS_COLORS } = require('./constants');

// --- Look & feel -----------------------------------------------------------
const COLOR_DARK = '#0f172a';
const COLOR_LABEL = '#475569';
const COLOR_MUTED = '#94a3b8';
const COLOR_ACCENT = '#d65131'; // RT Automation brand orange, sampled from the logo
const COLOR_BAND_BG = '#fdf2ee'; // light accent-tinted band behind each section heading
const COLOR_BORDER = '#e2e8f0';
const COLOR_WHITE = '#ffffff';
const PAGE_MARGIN = 50;

// The RT Automation logo used on the website header (views/partials/header.ejs)
// also lives here as an actual image file, so the PDF letterhead can use it -
// see the comment above LOGO_PATH for what to do if it's ever missing.
const LOGO_PATH = path.join(__dirname, '..', 'public', 'images', 'logo.png');

// Strips/replaces characters that the PDF's standard font can't display.
// Text pasted in from Outlook/Word (e.g. into Test Notes) often carries
// Unicode punctuation and paragraph-separator characters that aren't part of
// this font's character set - previously these rendered as a stray "Ð" at
// the end of every pasted paragraph. Anything still left over after these
// substitutions is swapped for "?" rather than showing as a broken symbol.
function safeText(value) {
  if (value === null || value === undefined) return '';
  var str = String(value);
  var out = '';
  for (var i = 0; i < str.length; i++) {
    var code = str.charCodeAt(i);
    if (code === 0x2028 || code === 0x2029) { out += '\n'; continue; }
    if (code === 0x00A0 || (code >= 0x2000 && code <= 0x200A) || code === 0x202F || code === 0x205F || code === 0x3000) { out += ' '; continue; }
    if ((code >= 0x200B && code <= 0x200F) || code === 0x2060 || code === 0xFEFF) { continue; }
    if (code === 0x2018 || code === 0x2019 || code === 0x201A || code === 0x201B) { out += "'"; continue; }
    if (code === 0x201C || code === 0x201D || code === 0x201E || code === 0x201F) { out += '"'; continue; }
    if (code >= 0x2012 && code <= 0x2015) { out += '-'; continue; }
    if (code === 0x2026) { out += '...'; continue; }
    if (code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0x7E) || (code >= 0xA1 && code <= 0xFF)) { out += str[i]; continue; }
    out += '?';
  }
  return out;
}

// opts.internal controls whether staff-only content (Item Received
// Condition, and all uploaded photos) is included. This must stay false for
// anything that gets emailed to the customer - see generateReturnPdf vs
// generateReturnPdfBuffer below.
function buildReturnPdfDoc(doc, returnRecord, statusHistory, files, opts = {}) {
  const internal = !!opts.internal;
  const left = doc.page.margins.left;
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  // --- Letterhead: logo on the left, report title/timestamp on the right ---
  const logoWidth = 150;
  const logoHeight = 34; // matches the logo's own aspect ratio (520x119)
  let letterheadBottom = doc.y;

  if (fs.existsSync(LOGO_PATH)) {
    try {
      doc.image(LOGO_PATH, left, doc.y, { width: logoWidth });
      letterheadBottom = Math.max(letterheadBottom, doc.y + logoHeight);
    } catch (err) {
      // If the logo file is ever missing/corrupt, carry on without it
      // rather than failing to generate the report at all.
    }
  }

  const titleBlockWidth = contentWidth - logoWidth - 10;
  doc
    .font('Helvetica-Bold').fontSize(14).fillColor(COLOR_DARK)
    .text('Customer Return Report', left + logoWidth + 10, doc.y, { width: titleBlockWidth, align: 'right' });
  doc
    .font('Helvetica').fontSize(9).fillColor(COLOR_MUTED)
    .text(`Generated: ${new Date().toLocaleString('en-GB')}`, left + logoWidth + 10, doc.y, { width: titleBlockWidth, align: 'right' });
  letterheadBottom = Math.max(letterheadBottom, doc.y);

  doc.x = left;
  doc.y = letterheadBottom + 10;
  doc.moveTo(left, doc.y).lineTo(left + contentWidth, doc.y).lineWidth(2).strokeColor(COLOR_ACCENT).stroke();
  doc.lineWidth(1);
  doc.y += 16;
  doc.x = left;

  // --- Reference, with the current status as a coloured badge ---
  const refRowY = doc.y;
  doc.font('Helvetica-Bold').fontSize(17).fillColor(COLOR_DARK)
    .text(`Reference: ${returnRecord.reference}`, left, refRowY);

  const statusText = returnRecord.status || '';
  const statusColor = STATUS_COLORS[returnRecord.status] || COLOR_LABEL;
  doc.font('Helvetica-Bold').fontSize(10);
  const badgePadX = 10;
  const badgeHeight = 20;
  const badgeWidth = doc.widthOfString(statusText) + badgePadX * 2;
  const badgeX = left + contentWidth - badgeWidth;
  const badgeY = refRowY - 1;
  doc.roundedRect(badgeX, badgeY, badgeWidth, badgeHeight, 4).fill(statusColor);
  doc.fillColor(COLOR_WHITE)
    .text(statusText, badgeX, badgeY + 5, { width: badgeWidth, align: 'center' });

  doc.font('Helvetica');
  doc.x = left;
  doc.y = Math.max(refRowY + 24, badgeY + badgeHeight + 4);
  doc.moveDown(0.6);

  section(doc, 'Customer Details', [
    ['Company', returnRecord.company_name],
    ['Contact name', returnRecord.contact_name],
    ['Phone', returnRecord.phone],
    ['Email', returnRecord.email]
  ]);

  section(doc, 'Equipment Details', [
    ['Equipment type', returnRecord.equipment_type],
    ['Make', returnRecord.make],
    ['Model', returnRecord.model],
    ['Serial Number / BC Code', returnRecord.serial_number]
  ]);

  section(doc, 'Collection Details', [
    ['Address', returnRecord.collection_address],
    ['Premises type', returnRecord.premises_type],
    ['Open hours', returnRecord.collection_hours],
    ['Courier contact number', returnRecord.courier_contact_number]
  ]);

  // Internal-only: how the item looked/what was in the box on arrival,
  // plus any received-condition photos/videos/documents shown directly
  // underneath. Deliberately excluded when this PDF is built for the customer.
  const receivedPhotos = (files || []).filter((f) => f.kind === 'received_photo');
  const receivedVideos = (files || []).filter((f) => f.kind === 'received_video');
  const receivedDocuments = (files || []).filter((f) => f.kind === 'received_document');
  const hasReceivedMedia = receivedPhotos.length > 0 || receivedVideos.length > 0 || receivedDocuments.length > 0;

  if (internal && (returnRecord.received_parts_status || returnRecord.received_notes || returnRecord.received_condition_flags || hasReceivedMedia)) {
    section(doc, 'Item Received Condition', [
      ['Parts status', returnRecord.received_parts_status],
      ['Condition on arrival', returnRecord.received_condition_flags],
      ['Notes', returnRecord.received_notes]
    ]);
    if (hasReceivedMedia) {
      renderMediaInline(doc, receivedPhotos, receivedVideos, receivedDocuments, returnRecord.reference);
    }
  }

  if (returnRecord.insp_application_type || returnRecord.insp_product_type || returnRecord.insp_dimensions || returnRecord.insp_weight || returnRecord.insp_install_date) {
    section(doc, 'Installation Details', [
      ['Application type', returnRecord.insp_application_type],
      ['Door / product type', returnRecord.insp_product_type],
      ['Dimensions', returnRecord.insp_dimensions],
      ['Weight', returnRecord.insp_weight],
      ['Installation date', returnRecord.insp_install_date]
    ]);
  }

  // Internal-only: identification details from the Warranty Repair Return
  // Form's "Product Information" section. Excluded from the customer-facing
  // copy.
  if (internal && (returnRecord.insp_invoice_number || returnRecord.insp_rt_product_type || returnRecord.insp_installation_age)) {
    section(doc, 'Product Details', [
      ['Original invoice / order number', returnRecord.insp_invoice_number],
      ['Product type (Roger component)', returnRecord.insp_rt_product_type],
      ['Age of installation', returnRecord.insp_installation_age]
    ]);
  }

  section(doc, 'Fault Description', [[null, returnRecord.fault_description]]);

  // Internal-only: matches the Warranty Repair Return Form's "Reported
  // Fault" section. Excluded from the customer-facing copy.
  if (internal && returnRecord.insp_fault_occurrence) {
    section(doc, 'Reported Fault', [
      ['When does the fault occur', returnRecord.insp_fault_occurrence]
    ]);
  }

  if (internal && (returnRecord.test_result || returnRecord.test_notes)) {
    section(doc, 'Testing', [
      ['Test result', returnRecord.test_result],
      ['Test notes', returnRecord.test_notes]
    ]);
  }

  // Internal-only: final warranty decision, matching the Warranty Repair
  // Return Form's section 5. Excluded from the customer-facing copy.
  if (internal && (returnRecord.insp_warranty_verdict || returnRecord.insp_rejection_reason || returnRecord.insp_action_taken || returnRecord.fault_category || returnRecord.insp_warranty_summary)) {
    section(doc, 'Warranty Determination & Final Verdict', [
      ['Final status', returnRecord.insp_warranty_verdict],
      ['Reason for rejection', returnRecord.insp_rejection_reason],
      ['Action taken', returnRecord.insp_action_taken],
      ['Fault category', returnRecord.fault_category],
      ['Technician summary', returnRecord.insp_warranty_summary]
    ]);
  }

  // Internal-only: paperwork trail once a warranty claim has actually been
  // submitted over to the manufacturer. Excluded from the customer-facing copy.
  if (internal && (returnRecord.manufacturer_name || returnRecord.rt_italy_claim_date || returnRecord.rt_italy_claim_method || returnRecord.rt_italy_staff_name || returnRecord.rt_italy_batch_code || returnRecord.rt_italy_rma || returnRecord.warranty_covered_by || returnRecord.rt_italy_manufacturer_notes)) {
    section(doc, 'Manufacturer Warranty Claim', [
      ['Manufacturer', returnRecord.manufacturer_name],
      ['Date submitted', returnRecord.rt_italy_claim_date],
      ['How the claim was sent', returnRecord.rt_italy_claim_method],
      ["Staff's name", returnRecord.rt_italy_staff_name],
      ['Batch code', returnRecord.rt_italy_batch_code],
      ['Claim reference number', returnRecord.rt_italy_rma],
      ['Warranty covered by', returnRecord.warranty_covered_by],
      ['Manufacturer notes', returnRecord.rt_italy_manufacturer_notes]
    ]);
  }

  if (returnRecord.manufacturer_rma_number || returnRecord.rta_rt_number) {
    section(doc, 'Reference Numbers', [
      ['Manufacturer RMA number', returnRecord.manufacturer_rma_number],
      ['RTA RT number', returnRecord.rta_rt_number]
    ].filter(([, value]) => value));
  }

  // Staff Notes are deliberately never included on this report.

  // Status history - internal/staff copy only. The customer-facing copy
  // deliberately leaves this out (they only need to know where things stand
  // right now, shown above as "Current status" - not every intermediate
  // status change or which staff member made it).
  if (internal) {
    ensureSpace(doc, 60);
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLOR_DARK).text('Status History');
    doc.font('Helvetica');
    doc.moveDown(0.3);
    statusHistory.forEach((h) => {
      ensureSpace(doc, 16);
      doc
        .fontSize(10)
        .fillColor(COLOR_LABEL)
        .text(`${new Date(h.changed_at).toLocaleString('en-GB')}  -  ${safeText(h.status)}${h.note ? `  (${safeText(h.note)})` : ''}  [${safeText(h.changed_by)}]`);
    });
  }

  doc.moveDown(1);
  doc
    .fontSize(9)
    .fillColor(COLOR_MUTED)
    .text('This report was generated automatically by the Roger Technology Returns Portal.', {
      align: 'center'
    });

  // Internal-only: every general uploaded photo (received-condition photos
  // are shown earlier, directly under Item Received Condition instead),
  // embedded on their own page(s) at the end of the report. Deliberately
  // excluded when this PDF is built for the customer.
  if (internal && files && files.length) {
    addPhotosSection(doc, files, returnRecord.reference);
  }
}

// Adds a page break now if there isn't roughly enough room left on the
// current page for whatever's about to be drawn - used to stop a section
// heading (or a status history line) being stranded alone at the very
// bottom of a page, separated from its own content.
function ensureSpace(doc, neededHeight) {
  if (doc.y + neededHeight > doc.page.height - doc.page.margins.bottom) {
    doc.addPage();
  }
}

// Draws a list of images (and text-only lists of videos/documents) at the
// current cursor position, with no page break or heading of its own - used
// to embed received-condition photos right under the Item Received
// Condition text.
function renderMediaInline(doc, images, videos, documents, reference) {
  const maxWidth = 495;
  const maxHeight = 320;
  const left = doc.page.margins.left;

  images.forEach((f) => {
    const abspath = filePath(reference, f.filename);
    if (!fs.existsSync(abspath)) return;

    let img;
    try {
      img = doc.openImage(abspath);
    } catch (err) {
      return; // skip unreadable/corrupt image rather than crash the whole report
    }

    const ratio = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
    const renderWidth = img.width * ratio;
    const renderHeight = img.height * ratio;

    if (doc.y + renderHeight + 30 > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }

    const x = left + (maxWidth - renderWidth) / 2;
    const y = doc.y;

    try {
      doc.image(img, x, y, { width: renderWidth, height: renderHeight });
    } catch (err) {
      return;
    }

    // Set the cursor explicitly to just below the image we actually drew,
    // rather than trusting PDFKit to have moved it there itself.
    doc.x = left;
    doc.y = y + renderHeight + 6;

    let label = safeText(f.original_name);
    if (f.caption) label += ` - ${safeText(f.caption)}`;
    doc.fontSize(9).fillColor(COLOR_MUTED).text(label, left, doc.y, { width: maxWidth, align: 'center' });
    doc.moveDown(0.8);
    doc.x = left;
  });

  if (videos.length) {
    doc.x = left;
    doc.fontSize(10).fillColor(COLOR_LABEL).text('Videos (view in the Returns Portal - not embedded in this PDF):');
    videos.forEach((f) => {
      let label = safeText(f.original_name);
      if (f.caption) label += ` - ${safeText(f.caption)}`;
      doc.fontSize(10).fillColor(COLOR_DARK).text(`- ${label}`);
    });
    doc.moveDown(0.5);
  }

  if (documents.length) {
    doc.x = left;
    doc.fontSize(10).fillColor(COLOR_LABEL).text('Documents (view in the Returns Portal - not embedded in this PDF):');
    documents.forEach((f) => {
      let label = safeText(f.original_name);
      if (f.caption) label += ` - ${safeText(f.caption)}`;
      doc.fontSize(10).fillColor(COLOR_DARK).text(`- ${label}`);
    });
    doc.moveDown(0.5);
  }
}

function addPhotosSection(doc, files, reference) {
  const images = files.filter((f) => f.kind === 'photo');
  const videos = files.filter((f) => f.kind === 'video');
  const documents = files.filter((f) => f.kind === 'document');

  if (!images.length && !videos.length && !documents.length) return;

  doc.addPage();
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLOR_DARK).text('Photos, Videos & Documents');
  doc.font('Helvetica');
  doc.moveDown(0.3);

  const maxWidth = 495;
  const maxHeight = 320;
  const left = doc.page.margins.left;

  images.forEach((f) => {
    const abspath = filePath(reference, f.filename);
    if (!fs.existsSync(abspath)) return;

    // Work out the rendered size ourselves (preserving aspect ratio, never
    // upscaling) instead of relying on PDFKit's `fit`/`align` to advance the
    // page cursor - with photos of very different aspect ratios (e.g. a wide
    // logo next to a tall product shot) that left the cursor in the wrong
    // place and captions/images ended up overlapping.
    let img;
    try {
      img = doc.openImage(abspath);
    } catch (err) {
      return; // skip unreadable/corrupt image rather than crash the whole report
    }

    const ratio = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
    const renderWidth = img.width * ratio;
    const renderHeight = img.height * ratio;

    if (doc.y + renderHeight + 30 > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }

    const x = left + (maxWidth - renderWidth) / 2;
    const y = doc.y;

    try {
      doc.image(img, x, y, { width: renderWidth, height: renderHeight });
    } catch (err) {
      return;
    }

    // Set the cursor explicitly to just below the image we actually drew,
    // rather than trusting PDFKit to have moved it there itself.
    doc.x = left;
    doc.y = y + renderHeight + 6;

    let label = safeText(f.original_name);
    if (f.caption) label += ` - ${safeText(f.caption)}`;
    doc.fontSize(9).fillColor(COLOR_MUTED).text(label, left, doc.y, { width: maxWidth, align: 'center' });
    doc.moveDown(0.8);
    doc.x = left;
  });

  if (videos.length) {
    doc.x = left;
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor(COLOR_LABEL).text('Videos (view in the Returns Portal - not embedded in this PDF):');
    videos.forEach((f) => {
      let label = safeText(f.original_name);
      if (f.caption) label += ` - ${safeText(f.caption)}`;
      doc.fontSize(10).fillColor(COLOR_DARK).text(`- ${label}`);
    });
  }

  if (documents.length) {
    doc.x = left;
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor(COLOR_LABEL).text('Documents (view in the Returns Portal - not embedded in this PDF):');
    documents.forEach((f) => {
      let label = safeText(f.original_name);
      if (f.caption) label += ` - ${safeText(f.caption)}`;
      doc.fontSize(10).fillColor(COLOR_DARK).text(`- ${label}`);
    });
  }
}

// Draws "<reference>  -  Page X of Y" at the bottom of every page. Needs to
// run after all of a document's content has been drawn (and the document
// built with { bufferPages: true }), since the total page count isn't known
// until then.
function addPageFooters(doc, reference) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottomMargin = doc.page.margins.bottom;
    // PDFKit auto-inserts a new page if text would land past the bottom
    // margin, even when given an explicit y - temporarily zeroing the
    // bottom margin lets this draw inside that reserved space, on the
    // existing page, instead of silently creating a blank extra one.
    doc.page.margins.bottom = 0;
    const bottom = doc.page.height - bottomMargin + 16;
    doc
      .font('Helvetica').fontSize(8).fillColor(COLOR_MUTED)
      .text(
        `${reference}  -  Page ${i - range.start + 1} of ${range.count}`,
        doc.page.margins.left,
        bottom,
        { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center', lineBreak: false }
      );
    doc.page.margins.bottom = bottomMargin;
  }
}

// Streams the PDF straight to an HTTP response (used by staff's "Download
// PDF Report" button). This is the internal/staff copy - it includes the
// Item Received Condition section and every uploaded photo.
function generateReturnPdf(returnRecord, statusHistory, files, res) {
  const doc = new PDFDocument({ margin: PAGE_MARGIN, bufferPages: true });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${returnRecord.reference}-report.pdf"`
  );
  doc.pipe(res);

  buildReturnPdfDoc(doc, returnRecord, statusHistory, files, { internal: true });
  addPageFooters(doc, returnRecord.reference);

  doc.end();
}

// Streams the customer-facing copy straight to an HTTP response (used by the
// public "Download PDF Report" link on the Track a Return page). Same
// content as generateReturnPdfBuffer below, just streamed instead of
// buffered - internal-only content is left out entirely.
function generateCustomerReturnPdf(returnRecord, statusHistory, res) {
  const doc = new PDFDocument({ margin: PAGE_MARGIN, bufferPages: true });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${returnRecord.reference}-report.pdf"`
  );
  doc.pipe(res);

  buildReturnPdfDoc(doc, returnRecord, statusHistory, [], { internal: false });
  addPageFooters(doc, returnRecord.reference);

  doc.end();
}

// Builds the same PDF in memory and resolves a Buffer (used to attach it to
// the "Email Report to Customer" email). This is the customer-facing copy -
// internal-only content (Item Received Condition, Staff Notes, photos) is
// left out entirely.
function generateReturnPdfBuffer(returnRecord, statusHistory) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: PAGE_MARGIN, bufferPages: true });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    buildReturnPdfDoc(doc, returnRecord, statusHistory, [], { internal: false });
    addPageFooters(doc, returnRecord.reference);

    doc.end();
  });
}

function section(doc, title, rows) {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const bandHeight = 20;

  ensureSpace(doc, bandHeight + 30);

  const bandY = doc.y;
  doc.rect(left, bandY, width, bandHeight).fill(COLOR_BAND_BG);
  doc.rect(left, bandY, 3, bandHeight).fill(COLOR_ACCENT);
  doc
    .font('Helvetica-Bold').fontSize(10.5).fillColor(COLOR_DARK)
    .text(title.toUpperCase(), left + 12, bandY + 6, { width: width - 24, characterSpacing: 0.3 });
  doc.font('Helvetica');

  doc.x = left;
  doc.y = bandY + bandHeight + 8;

  rows.forEach(([label, value]) => {
    const text = safeText(value) || '-';
    ensureSpace(doc, 14);
    doc.fontSize(10).fillColor(COLOR_LABEL);
    if (label) {
      doc.text(`${label}: `, left, doc.y, { continued: true }).fillColor(COLOR_DARK).text(text);
    } else {
      doc.fillColor(COLOR_DARK).text(text, left, doc.y, { width });
    }
    doc.x = left;
  });
  doc.moveDown();
}

module.exports = { generateReturnPdf, generateReturnPdfBuffer, generateCustomerReturnPdf };
