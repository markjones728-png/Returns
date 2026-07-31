const fs = require('fs');
const PDFDocument = require('pdfkit');
const { filePath } = require('./files');

// opts.internal controls whether staff-only content (Item Received
// Condition, and all uploaded photos) is included. This must stay false for
// anything that gets emailed to the customer - see generateReturnPdf vs
// generateReturnPdfBuffer below.
function buildReturnPdfDoc(doc, returnRecord, statusHistory, files, opts = {}) {
  const internal = !!opts.internal;
  // Header
  doc
    .fontSize(20)
    .fillColor('#0f172a')
    .text('Roger Technology', { continued: false })
    .fontSize(14)
    .fillColor('#334155')
    .text('Customer Return Report');
  doc.moveDown(0.5);
  doc
    .fontSize(10)
    .fillColor('#64748b')
    .text(`Generated: ${new Date().toLocaleString('en-GB')}`);
  doc.moveDown();
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').stroke();
  doc.moveDown();

  // Reference & status
  doc.fontSize(16).fillColor('#0f172a').text(`Reference: ${returnRecord.reference}`);
  doc.fontSize(12).fillColor('#0284c7').text(`Current status: ${returnRecord.status}`);
  doc.moveDown();

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
    ['Serial number', returnRecord.serial_number]
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
  if (internal && (returnRecord.insp_warranty_verdict || returnRecord.insp_rejection_reason || returnRecord.insp_action_taken || returnRecord.insp_warranty_summary)) {
    section(doc, 'Warranty Determination & Final Verdict', [
      ['Final status', returnRecord.insp_warranty_verdict],
      ['Reason for rejection', returnRecord.insp_rejection_reason],
      ['Action taken', returnRecord.insp_action_taken],
      ['Technician summary', returnRecord.insp_warranty_summary]
    ]);
  }

  if (returnRecord.manufacturer_rma_number || returnRecord.rta_rt_number) {
    section(doc, 'Reference Numbers', [
      ['Manufacturer RMA number', returnRecord.manufacturer_rma_number],
      ['RTA RT number', returnRecord.rta_rt_number]
    ].filter(([, value]) => value));
  }

  // Staff Notes are deliberately never included on this report.

  // Status history
  doc.moveDown(0.5);
  doc.fontSize(13).fillColor('#0f172a').text('Status History');
  doc.moveDown(0.3);
  statusHistory.forEach((h) => {
    doc
      .fontSize(10)
      .fillColor('#334155')
      .text(`${new Date(h.changed_at).toLocaleString('en-GB')}  —  ${h.status}${h.note ? `  (${h.note})` : ''}  [${h.changed_by}]`);
  });

  doc.moveDown(1);
  doc
    .fontSize(9)
    .fillColor('#94a3b8')
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

    let label = f.original_name;
    if (f.caption) label += ` — ${f.caption}`;
    doc.fontSize(9).fillColor('#64748b').text(label, left, doc.y, { width: maxWidth, align: 'center' });
    doc.moveDown(0.8);
    doc.x = left;
  });

  if (videos.length) {
    doc.x = left;
    doc.fontSize(10).fillColor('#475569').text('Videos (view in the Returns Portal - not embedded in this PDF):');
    videos.forEach((f) => {
      let label = f.original_name;
      if (f.caption) label += ` — ${f.caption}`;
      doc.fontSize(10).fillColor('#0f172a').text(`- ${label}`);
    });
    doc.moveDown(0.5);
  }

  if (documents.length) {
    doc.x = left;
    doc.fontSize(10).fillColor('#475569').text('Documents (view in the Returns Portal - not embedded in this PDF):');
    documents.forEach((f) => {
      let label = f.original_name;
      if (f.caption) label += ` — ${f.caption}`;
      doc.fontSize(10).fillColor('#0f172a').text(`- ${label}`);
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
  doc.fontSize(13).fillColor('#0f172a').text('Photos, Videos & Documents');
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

    let label = f.original_name;
    if (f.caption) label += ` — ${f.caption}`;
    doc.fontSize(9).fillColor('#64748b').text(label, left, doc.y, { width: maxWidth, align: 'center' });
    doc.moveDown(0.8);
    doc.x = left;
  });

  if (videos.length) {
    doc.x = left;
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#475569').text('Videos (view in the Returns Portal - not embedded in this PDF):');
    videos.forEach((f) => {
      let label = f.original_name;
      if (f.caption) label += ` — ${f.caption}`;
      doc.fontSize(10).fillColor('#0f172a').text(`- ${label}`);
    });
  }

  if (documents.length) {
    doc.x = left;
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#475569').text('Documents (view in the Returns Portal - not embedded in this PDF):');
    documents.forEach((f) => {
      let label = f.original_name;
      if (f.caption) label += ` — ${f.caption}`;
      doc.fontSize(10).fillColor('#0f172a').text(`- ${label}`);
    });
  }
}

// Streams the PDF straight to an HTTP response (used by staff's "Download
// PDF Report" button). This is the internal/staff copy - it includes the
// Item Received Condition section and every uploaded photo.
function generateReturnPdf(returnRecord, statusHistory, files, res) {
  const doc = new PDFDocument({ margin: 50 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${returnRecord.reference}-report.pdf"`
  );
  doc.pipe(res);

  buildReturnPdfDoc(doc, returnRecord, statusHistory, files, { internal: true });

  doc.end();
}

// Streams the customer-facing copy straight to an HTTP response (used by the
// public "Download PDF Report" link on the Track a Return page). Same
// content as generateReturnPdfBuffer below, just streamed instead of
// buffered - internal-only content is left out entirely.
function generateCustomerReturnPdf(returnRecord, statusHistory, res) {
  const doc = new PDFDocument({ margin: 50 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${returnRecord.reference}-report.pdf"`
  );
  doc.pipe(res);

  buildReturnPdfDoc(doc, returnRecord, statusHistory, [], { internal: false });

  doc.end();
}

// Builds the same PDF in memory and resolves a Buffer (used to attach it to
// the "Email Report to Customer" email). This is the customer-facing copy -
// internal-only content (Item Received Condition, Staff Notes, photos) is
// left out entirely.
function generateReturnPdfBuffer(returnRecord, statusHistory) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    buildReturnPdfDoc(doc, returnRecord, statusHistory, [], { internal: false });

    doc.end();
  });
}

function section(doc, title, rows) {
  doc.fontSize(13).fillColor('#0f172a').text(title);
  doc.moveDown(0.3);
  rows.forEach(([label, value]) => {
    doc.fontSize(10).fillColor('#475569');
    if (label) {
      doc.text(`${label}: `, { continued: true }).fillColor('#0f172a').text(value || '-');
    } else {
      doc.fillColor('#0f172a').text(value || '-');
    }
  });
  doc.moveDown();
}

module.exports = { generateReturnPdf, generateReturnPdfBuffer, generateCustomerReturnPdf };
