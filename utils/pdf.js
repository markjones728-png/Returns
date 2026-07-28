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

  // Internal-only: how the item looked/what was in the box on arrival.
  // Deliberately excluded when this PDF is built for the customer.
  if (internal && (returnRecord.received_parts_status || returnRecord.received_notes)) {
    section(doc, 'Item Received Condition', [
      ['Parts status', returnRecord.received_parts_status],
      ['Notes', returnRecord.received_notes]
    ]);
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

  // Internal-only: full product/nameplate identification from the
  // inspection form. Excluded from the customer-facing copy.
  if (internal && (returnRecord.insp_product_code || returnRecord.insp_quantity || returnRecord.insp_guarantee_status)) {
    section(doc, 'Product Details', [
      ['Product code', returnRecord.insp_product_code],
      ['Quantity', returnRecord.insp_quantity],
      ['Warranty status', returnRecord.insp_guarantee_status]
    ]);
  }

  if (internal && (returnRecord.insp_plate_p_code || returnRecord.insp_plate_voltage || returnRecord.insp_plate_batch || returnRecord.insp_plate_in || returnRecord.insp_plate_pm)) {
    section(doc, 'Nameplate Data', [
      ['P.CODE', returnRecord.insp_plate_p_code],
      ['Voltage', returnRecord.insp_plate_voltage],
      ['Batch', returnRecord.insp_plate_batch],
      ['IN', returnRecord.insp_plate_in],
      ['PM', returnRecord.insp_plate_pm]
    ]);
  }

  section(doc, 'Fault Description', [[null, returnRecord.fault_description]]);

  // Internal-only: the engineer's own diagnosis notes. Excluded from the
  // customer-facing copy since these can be frank/internal in tone.
  if (internal && (returnRecord.insp_problem_by_client || returnRecord.insp_problem_by_dealer || returnRecord.insp_action_suggested || returnRecord.insp_repairable || returnRecord.insp_request_type)) {
    section(doc, 'Problem Found', [
      ['Problem identified by client', returnRecord.insp_problem_by_client],
      ['Problem identified by dealer/engineer', returnRecord.insp_problem_by_dealer],
      ['Action suggested', returnRecord.insp_action_suggested],
      ['Repairable', returnRecord.insp_repairable],
      ['Request type', returnRecord.insp_request_type]
    ]);
  }

  if (internal && (returnRecord.test_result || returnRecord.test_notes)) {
    section(doc, 'Testing', [
      ['Test result', returnRecord.test_result],
      ['Test notes', returnRecord.test_notes]
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

  // Internal-only: every uploaded photo (general + received-condition),
  // embedded on their own page(s) at the end of the report. Deliberately
  // excluded when this PDF is built for the customer.
  if (internal && files && files.length) {
    addPhotosSection(doc, files, returnRecord.reference);
  }
}

function addPhotosSection(doc, files, reference) {
  const images = files.filter((f) => f.kind === 'photo' || f.kind === 'received_photo');
  const videos = files.filter((f) => f.kind === 'video' || f.kind === 'received_video');

  if (!images.length && !videos.length) return;

  doc.addPage();
  doc.fontSize(13).fillColor('#0f172a').text('Photos & Videos');
  doc.moveDown(0.3);

  const maxWidth = 495;
  const maxHeight = 320;

  images.forEach((f) => {
    const abspath = filePath(reference, f.filename);
    if (!fs.existsSync(abspath)) return;

    if (doc.y + maxHeight + 30 > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }

    try {
      doc.image(abspath, { fit: [maxWidth, maxHeight], align: 'center' });
    } catch (err) {
      return; // skip unreadable/corrupt image rather than crash the whole report
    }
    doc.moveDown(0.2);
    let label = f.kind === 'received_photo' ? `${f.original_name} (Item Received Condition)` : f.original_name;
    if (f.caption) label += ` — ${f.caption}`;
    doc.fontSize(9).fillColor('#64748b').text(label, { align: 'center' });
    doc.moveDown(0.8);
  });

  if (videos.length) {
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#475569').text('Videos (view in the Returns Portal - not embedded in this PDF):');
    videos.forEach((f) => {
      let label = f.kind === 'received_video' ? `${f.original_name} (Item Received Condition)` : f.original_name;
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
