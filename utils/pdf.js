const PDFDocument = require('pdfkit');

function generateReturnPdf(returnRecord, statusHistory, res) {
  const doc = new PDFDocument({ margin: 50 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${returnRecord.reference}-report.pdf"`
  );
  doc.pipe(res);

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

  section(doc, 'Fault Description', [[null, returnRecord.fault_description]]);

  if (returnRecord.staff_notes) {
    section(doc, 'Staff Notes', [[null, returnRecord.staff_notes]]);
  }

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

  doc.end();
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

module.exports = { generateReturnPdf };
