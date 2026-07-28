const nodemailer = require('nodemailer');
const { DEALER_DETAILS } = require('./constants');

function buildTransport() {
  if (!process.env.SMTP_HOST) {
    return null; // Not configured - emails will be logged to console instead
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined
  });
}

const transporter = buildTransport();

async function sendMail({ to, subject, html, attachments }) {
  const from = process.env.MAIL_FROM || '"Roger Technology Returns" <returns@example.com>';

  if (!transporter) {
    console.log('--- SMTP not configured. Would have sent email: ---');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log('Body:', html);
    if (attachments && attachments.length) {
      console.log('Attachments:', attachments.map((a) => a.filename).join(', '));
    }
    console.log('----------------------------------------------------');
    return { skipped: true };
  }

  try {
    return await transporter.sendMail({ from, to, subject, html, attachments });
  } catch (err) {
    console.error('Failed to send email:', err.message);
    return { error: err.message };
  }
}

async function sendReturnSubmittedEmail(returnRecord) {
  const subject = `Your return ${returnRecord.reference} has been received`;
  const html = `
    <p>Dear ${escapeHtml(returnRecord.contact_name)},</p>
    <p>Thank you for submitting a return to Roger Technology. Your reference number is
    <strong>${escapeHtml(returnRecord.reference)}</strong>.</p>
    <p><strong>Equipment:</strong> ${escapeHtml(returnRecord.make)} ${escapeHtml(returnRecord.model)}
    (Serial: ${escapeHtml(returnRecord.serial_number)})</p>
    <p><strong>Fault reported:</strong> ${escapeHtml(returnRecord.fault_description)}</p>
    <p>Our returns team has started processing your return and will keep you updated as it
    progresses. Please quote your reference number in any correspondence.</p>
    <p>Kind regards,<br/>Returns Team</p>
  `;
  return sendMail({ to: returnRecord.email, subject, html });
}

async function sendStatusUpdateEmail(returnRecord) {
  const subject = `Update on your return ${returnRecord.reference}: ${returnRecord.status}`;
  const html = `
    <p>Dear ${escapeHtml(returnRecord.contact_name)},</p>
    <p>The status of your return <strong>${escapeHtml(returnRecord.reference)}</strong>
    (${escapeHtml(returnRecord.make)} ${escapeHtml(returnRecord.model)}) has been updated to:</p>
    <p style="font-size:16px;"><strong>${escapeHtml(returnRecord.status)}</strong></p>
    <p>Kind regards,<br/>Returns Team</p>
  `;
  return sendMail({ to: returnRecord.email, subject, html });
}

// Sent internally (not to the customer) once a return reaches "Return Closed",
// so someone always gets a full record of the completed return by email -
// a copy of everything captured, on top of what's stored in the app itself.
async function sendReturnCompletedEmail(returnRecord, statusHistory = []) {
  const notifyTo = process.env.RETURNS_NOTIFY_EMAIL || DEALER_DETAILS.email;
  const subject = `Return closed: ${returnRecord.reference} - ${returnRecord.company_name}`;

  const historyHtml = statusHistory
    .map((h) => `<li>${escapeHtml(new Date(h.changed_at).toLocaleString('en-GB'))} — ${escapeHtml(h.status)}${h.note ? ` (${escapeHtml(h.note)})` : ''} [${escapeHtml(h.changed_by)}]</li>`)
    .join('');

  const html = `
    <h2>Return Closed: ${escapeHtml(returnRecord.reference)}</h2>

    <h3>Customer Details</h3>
    <p>
      <strong>Company:</strong> ${escapeHtml(returnRecord.company_name)}<br/>
      <strong>Contact:</strong> ${escapeHtml(returnRecord.contact_name)}<br/>
      <strong>Phone:</strong> ${escapeHtml(returnRecord.phone)}<br/>
      <strong>Email:</strong> ${escapeHtml(returnRecord.email)}
    </p>

    <h3>Equipment Details</h3>
    <p>
      <strong>Type:</strong> ${escapeHtml(returnRecord.equipment_type)}<br/>
      <strong>Make / Model:</strong> ${escapeHtml(returnRecord.make)} ${escapeHtml(returnRecord.model)}<br/>
      <strong>Serial number:</strong> ${escapeHtml(returnRecord.serial_number)}<br/>
      <strong>Fault reported:</strong> ${escapeHtml(returnRecord.fault_description)}
    </p>

    <h3>Collection Details</h3>
    <p>
      <strong>Address:</strong> ${escapeHtml(returnRecord.collection_address)}<br/>
      <strong>Premises type:</strong> ${escapeHtml(returnRecord.premises_type)}<br/>
      <strong>Open hours:</strong> ${escapeHtml(returnRecord.collection_hours)}<br/>
      <strong>Courier contact number:</strong> ${escapeHtml(returnRecord.courier_contact_number)}
    </p>

    <h3>Installation Details</h3>
    <p>
      <strong>Application type:</strong> ${escapeHtml(returnRecord.insp_application_type)}<br/>
      <strong>Door / product type:</strong> ${escapeHtml(returnRecord.insp_product_type)}<br/>
      <strong>Dimensions:</strong> ${escapeHtml(returnRecord.insp_dimensions)}<br/>
      <strong>Weight:</strong> ${escapeHtml(returnRecord.insp_weight)}<br/>
      <strong>Installation date:</strong> ${escapeHtml(returnRecord.insp_install_date)}
    </p>

    <h3>Inspection &amp; Testing</h3>
    <p>
      <strong>Warranty status:</strong> ${escapeHtml(returnRecord.insp_guarantee_status)}<br/>
      <strong>Problem identified by client:</strong> ${escapeHtml(returnRecord.insp_problem_by_client)}<br/>
      <strong>Problem identified by dealer/engineer:</strong> ${escapeHtml(returnRecord.insp_problem_by_dealer)}<br/>
      <strong>Action suggested:</strong> ${escapeHtml(returnRecord.insp_action_suggested)}<br/>
      <strong>Repairable:</strong> ${escapeHtml(returnRecord.insp_repairable)}<br/>
      <strong>Request type:</strong> ${escapeHtml(returnRecord.insp_request_type)}<br/>
      <strong>Manufacturer RMA number:</strong> ${escapeHtml(returnRecord.manufacturer_rma_number)}<br/>
      <strong>RTA RT number:</strong> ${escapeHtml(returnRecord.rta_rt_number)}<br/>
      <strong>Test result:</strong> ${escapeHtml(returnRecord.test_result)}<br/>
      <strong>Test notes:</strong> ${escapeHtml(returnRecord.test_notes)}
    </p>

    ${returnRecord.staff_notes ? `<h3>Staff Notes</h3><p>${escapeHtml(returnRecord.staff_notes)}</p>` : ''}

    <h3>Status History</h3>
    <ul>${historyHtml}</ul>
  `;

  return sendMail({ to: notifyTo, subject, html });
}

// Emails the customer their PDF return report as an attachment - triggered
// by the "Email Report to Customer" button, which also moves the return to
// the "Report Sent" status.
async function sendReturnReportEmail(returnRecord, pdfBuffer) {
  const subject = `Your report for return ${returnRecord.reference}`;
  const html = `
    <p>Dear ${escapeHtml(returnRecord.contact_name)},</p>
    <p>Please find attached the report for your return <strong>${escapeHtml(returnRecord.reference)}</strong>
    (${escapeHtml(returnRecord.make)} ${escapeHtml(returnRecord.model)}).</p>
    <p>Please quote your reference number in any correspondence.</p>
    <p>Kind regards,<br/>Returns Team</p>
  `;
  return sendMail({
    to: returnRecord.email,
    subject,
    html,
    attachments: [
      {
        filename: `${returnRecord.reference}-report.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      }
    ]
  });
}

async function sendStaffInviteEmail({ email, name, invitedBy, acceptUrl }) {
  const subject = `You've been invited to the Returns Portal`;
  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>${escapeHtml(invitedBy)} has invited you to join the RT Automation Returns Portal as a staff member.</p>
    <p><a href="${acceptUrl}" style="display:inline-block;padding:10px 20px;background:#0284c7;color:#fff;text-decoration:none;border-radius:6px;">Accept invite &amp; set up your account</a></p>
    <p>Or copy this link into your browser:<br/>${acceptUrl}</p>
    <p>This invite link expires in 7 days.</p>
    <p>Kind regards,<br/>Returns Team</p>
  `;
  return sendMail({ to: email, subject, html });
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { sendMail, sendReturnSubmittedEmail, sendStatusUpdateEmail, sendReturnCompletedEmail, sendReturnReportEmail, sendStaffInviteEmail };
