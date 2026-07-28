const PDFDocument = require('pdfkit');
const { DEALER_DETAILS } = require('./constants');

// Generates a filled copy of Roger Technology's official
// "Request for Authorisation to Return Product for Inspection" form,
// ready to email to service@rogertechnology.it, using the data captured
// by the returns engineer in the inspection/test form.
function generateRtAuthorisationPdf(r, res) {
  const doc = new PDFDocument({ margin: 50 });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${r.reference}-RT-Authorisation-Request.pdf"`
  );
  doc.pipe(res);

  doc
    .fontSize(16)
    .fillColor('#0f172a')
    .text('Request for Authorisation to Return Product for Inspection', { align: 'center' });
  doc.moveDown(0.3);
  doc
    .fontSize(10)
    .fillColor('#64748b')
    .text('Roger Technology S.r.l. — service@rogertechnology.it', { align: 'center' });
  doc.moveDown(0.3);
  doc
    .fontSize(9)
    .fillColor('#94a3b8')
    .text(`Our reference: ${r.reference}   |   Generated: ${new Date().toLocaleString('en-GB')}`, { align: 'center' });
  doc.moveDown();
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').stroke();
  doc.moveDown();

  section(doc, 'Dealer Details', [
    ['Trading name', DEALER_DETAILS.tradingName],
    ['Operator', DEALER_DETAILS.operator],
    ['Telephone No.', DEALER_DETAILS.telephone],
    ['E-mail', DEALER_DETAILS.email]
  ]);

  section(doc, 'Client / Installer Details', [
    ['Company', r.company_name],
    ['Contact name', r.contact_name],
    ['Telephone No.', r.phone],
    ['E-mail', r.email]
  ]);

  section(doc, 'Installation Details', [
    ['Application type', r.insp_application_type],
    ['Door / product type', r.insp_product_type],
    ['Dimensions', r.insp_dimensions],
    ['Weight', r.insp_weight],
    ['Installation date', r.insp_install_date]
  ]);

  section(doc, 'Product Details', [
    ['Make', r.make],
    ['Model', r.model],
    ['Product code', r.insp_product_code],
    ['Serial number', r.serial_number],
    ['Quantity', r.insp_quantity],
    ['Guarantee status', r.insp_guarantee_status]
  ]);

  section(doc, 'Nameplate Data', [
    ['P.CODE', r.insp_plate_p_code],
    ['Voltage', r.insp_plate_voltage],
    ['Batch', r.insp_plate_batch],
    ['IN', r.insp_plate_in],
    ['PM', r.insp_plate_pm]
  ]);

  section(doc, 'Problem Found', [
    ['Fault reported by customer', r.fault_description],
    ['Problem identified by client', r.insp_problem_by_client],
    ['Problem identified by dealer / engineer', r.insp_problem_by_dealer],
    ['Action suggested', r.insp_action_suggested],
    ['Repairable?', r.insp_repairable],
    ['Request type', r.insp_request_type]
  ]);

  if (r.test_result || r.test_notes) {
    section(doc, 'Testing Carried Out', [
      ['Test result', r.test_result],
      ['Test notes', r.test_notes],
      ['Tested by', r.test_completed_by],
      ['Tested on', r.test_completed_at ? new Date(r.test_completed_at).toLocaleString('en-GB') : '']
    ]);
  }

  doc.moveDown(1);
  doc
    .fontSize(9)
    .fillColor('#94a3b8')
    .text(
      `Prepared by ${r.insp_completed_by || DEALER_DETAILS.operator} on behalf of ${DEALER_DETAILS.tradingName}. ` +
      'This document was generated automatically by the Roger Technology Returns Portal from the data recorded against this return.',
      { align: 'center' }
    );

  doc.end();
}

function section(doc, title, rows) {
  doc.fontSize(13).fillColor('#0f172a').text(title);
  doc.moveDown(0.3);
  rows.forEach(([label, value]) => {
    doc.fontSize(10).fillColor('#475569');
    doc.text(`${label}: `, { continued: true }).fillColor('#0f172a').text(value || '-');
  });
  doc.moveDown();
}

module.exports = { generateRtAuthorisationPdf };
