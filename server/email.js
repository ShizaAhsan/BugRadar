const nodemailer = require('nodemailer');
const config = require('./config');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  if (!config.email.user || !config.email.pass) {
    console.warn('SMTP not configured - emails will be logged to console');
    return null;
  }

  transporter = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: config.email.secure,
    auth: {
      user: config.email.user,
      pass: config.email.pass,
    },
  });

  return transporter;
}

async function sendEmail(to, subject, html) {
  const transport = getTransporter();

  if (!transport) {
    console.log(`[EMAIL] To: ${to} | Subject: ${subject}`);
    console.log(`[EMAIL] Body: ${html.substring(0, 200)}...`);
    return { messageId: 'console-' + Date.now() };
  }

  return transport.sendMail({
    from: config.email.from,
    to,
    subject,
    html,
  });
}

function generateVerificationEmail(name, verifyUrl) {
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #0a0a0f; color: #e4e4e7;">
      <div style="background: linear-gradient(135deg, #1a1a2e, #16213e); border-radius: 16px; padding: 40px; border: 1px solid #27273a;">
        <h1 style="color: #fff; font-size: 24px; margin-bottom: 16px;">Verify your BugRadar account</h1>
        <p style="color: #a1a1aa; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #a1a1aa; line-height: 1.6;">Welcome to BugRadar! Please verify your email address to get started.</p>
        <a href="${verifyUrl}" style="display: inline-block; background: linear-gradient(135deg, #3b82f6, #06b6d4); color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; margin: 20px 0;">Verify Email Address</a>
        <p style="color: #71717a; font-size: 13px; margin-top: 30px;">If you didn't create this account, you can ignore this email.</p>
      </div>
    </body>
    </html>
  `;
}

function generateInviteEmail(inviterName, orgName, inviteUrl) {
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #0a0a0f; color: #e4e4e7;">
      <div style="background: linear-gradient(135deg, #1a1a2e, #16213e); border-radius: 16px; padding: 40px; border: 1px solid #27273a;">
        <h1 style="color: #fff; font-size: 24px; margin-bottom: 16px;">You're invited to BugRadar</h1>
        <p style="color: #a1a1aa; line-height: 1.6;">Hi,</p>
        <p style="color: #a1a1aa; line-height: 1.6;"><strong>${inviterName}</strong> has invited you to join <strong>${orgName}</strong> on BugRadar.</p>
        <a href="${inviteUrl}" style="display: inline-block; background: linear-gradient(135deg, #3b82f6, #06b6d4); color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; margin: 20px 0;">Accept Invitation</a>
        <p style="color: #71717a; font-size: 13px; margin-top: 30px;">If you weren't expecting this invitation, you can ignore this email.</p>
      </div>
    </body>
    </html>
  `;
}

function generateAlertEmail(ruleName, issueTitle, projectName, issueUrl) {
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #0a0a0f; color: #e4e4e7;">
      <div style="background: linear-gradient(135deg, #1a1a2e, #16213e); border-radius: 16px; padding: 40px; border: 1px solid #27273a;">
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 20px;">
          <div style="width: 40px; height: 40px; border-radius: 10px; background: rgba(239,68,68,0.15); display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 20px;">🚨</span>
          </div>
          <h1 style="color: #fff; font-size: 20px; margin: 0;">BugRadar Alert</h1>
        </div>
        <p style="color: #a1a1aa; line-height: 1.6;">Alert <strong>${ruleName}</strong> triggered on project <strong>${projectName}</strong></p>
        <div style="background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: 10px; padding: 16px; margin: 20px 0;">
          <p style="color: #ef4444; font-weight: 600; margin: 0 0 8px 0;">${issueTitle}</p>
        </div>
        <a href="${issueUrl}" style="display: inline-block; background: linear-gradient(135deg, #3b82f6, #06b6d4); color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; margin: 20px 0;">View Issue</a>
      </div>
    </body>
    </html>
  `;
}

module.exports = { sendEmail, generateVerificationEmail, generateInviteEmail, generateAlertEmail };
