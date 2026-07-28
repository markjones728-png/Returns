const nodemailer = require('nodemailer');

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

async function sendMail({ to, subject, html }) {
  const from = process.env.MAIL_FROM || '"Roger Technology Returns" <returns@example.com>';

  if (!transporter) {
    console.log('--- SMTP not configured. Would have sent email: ---');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log('Body:', html);
    console.log('----------------------------------------------------');
    return { skipped: true };
  }

  try {
    return await transporter.sendMail({ from, to, subject, html });
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

module.exports = { sendMail, sendReturnSubmittedEmail, sendStatusUpdateEmail, sendStaffInviteEmail };
