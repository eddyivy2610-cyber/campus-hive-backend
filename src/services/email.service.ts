import nodemailer from "nodemailer";

interface SendEmailServiceParams {
  to: string;
  title: string;
  text: string;
  htmlContent?: string;
}

const fromAddress = "campushiveng@gmail.com";
let transporter: nodemailer.Transporter | undefined;

export function resetEmailTransporterForTest(): void {
  transporter = undefined;
}

function getEmailTransporter(): nodemailer.Transporter {
  transporter ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === "true",
    family: 4,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    tls: {
      rejectUnauthorized: false,
    },
    auth: process.env.EMAIL_APP_PASSWORD
      ? {
          user: fromAddress,
          pass: process.env.EMAIL_APP_PASSWORD,
        }
      : undefined,
  } as nodemailer.TransportOptions);

  return transporter;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[character];
  });
}

function renderPlainEmail(title: string, text: string): string {
  return renderEmailLayout(
    title,
    `<h1 style="margin:0 0 20px; font-size:22px; line-height:1.35; font-weight:600; color:${BRAND.midPrimary};">${escapeHtml(title)}</h1>
    <p style="margin:0; font-size:15px; line-height:1.7; color:${BRAND.muted}; white-space:pre-line;">${escapeHtml(text)}</p>`,
  );
}

export const sendEmailService = async ({
  to,
  title,
  text,
  htmlContent,
}: SendEmailServiceParams) => {
  try {
    const html = htmlContent ?? renderPlainEmail(title, text);
    const brevoApiKey = process.env.BREVO_API_KEY?.trim();
    if (brevoApiKey) {
      const senderEmail = process.env.EMAIL_FROM_ADDRESS?.trim() || fromAddress;
      const senderName = process.env.EMAIL_FROM_NAME?.trim() || "CampusHive";
      const res = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": brevoApiKey,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          sender: { name: senderName, email: senderEmail },
          to: [{ email: to }],
          subject: title,
          htmlContent: html,
          textContent: text,
        }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`Brevo HTTP ${res.status}: ${errBody}`);
      }
      console.info(`Email sent successfully via Brevo to ${to}`);
      return { success: true, message: "Email sent successfully" };
    }

    const resendApiKey = process.env.RESEND_API_KEY?.trim();
    if (resendApiKey) {
      const from = process.env.EMAIL_FROM?.trim() || "CampusHive <onboarding@resend.dev>";
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to, subject: title, text, html }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        throw new Error(`Resend HTTP ${res.status}: ${errBody}`);
      }
      console.info(`Email sent successfully via Resend to ${to}`);
      return { success: true, message: "Email sent successfully" };
    }

    await getEmailTransporter().sendMail({
      from: `"CampusHive" <${fromAddress}>`,
      to,
      subject: title,
      text,
      html,
    });

    console.info(`Email sent successfully to ${to}`);
    return { success: true, message: "Email sent successfully" };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Failed to send email:", message);
    return { success: false, message: "Failed to send email" };
  }
};

type OtpPurpose =
  | "signup"
  | "password-reset"
  | "email-change"
  | "password-change"
  | "request-new-otp-code";

interface SendOtpEmailParams {
  otp: string;
  email: string;
  purpose: OtpPurpose;
}

// brand colors and styles for the email templates :gold, white and black

const BRAND = {
  primary: "#CA8A04",
  darkPrimary: "#A16207",
  lightPrimary: "#F8FAFC",
  midPrimary: "#0F172A",
  extraLightPrimary: "#F1F5F9",
  text: "#0F172A",
  muted: "#64748B",
  border: "#E2E8F0",
  cardBg: "#FFFFFF",
};

function getLogoUrl(): string {
  const explicit = process.env.EMAIL_LOGO_URL?.trim();
  if (explicit) return explicit;
  const origin = process.env.CLIENT_ORIGIN?.split(",")[0]?.trim().replace(/\/$/, "");
  if (origin && /^https?:\/\//i.test(origin) && !origin.includes("localhost") && !origin.includes("127.0.0.1")) {
    return `${origin}/LOGO.png`;
  }
  return "";
}

const purposeConfig: Record<
  OtpPurpose,
  { subject: string; heading: string; intro: string; action: string; emoji: string }
> = {
  signup: {
    subject: "Verify your CampusHive account",
    heading: "Welcome to CampusHive",
    intro: "Where real-life connections happen. You're one step away from joining.",
    action: "verify your email and complete your signup",
    emoji: "🎉",
  },
  "password-reset": {
    subject: "Reset your CampusHive password",
    heading: "Reset your password",
    intro: "We received a request to reset the password on your account.",
    action: "reset your password",
    emoji: "🔑",
  },
  "email-change": {
    subject: "Confirm your new email address",
    heading: "Confirm your new email",
    intro: "You recently asked to update the email address on your CampusHive account.",
    action: "confirm your new email address",
    emoji: "✉️",
  },
  "password-change": {
    subject: "Verify your identity to change password",
    heading: "Verify it's you",
    intro: "You recently asked to change the password on your CampusHive account.",
    action: "verify your identity and change your password",
    emoji: "🔒",
  },
"request-new-otp-code": {
    subject: "Your new CampusHive verification code",
    heading: "Here's your new code",
    intro: "You asked us to send you a fresh verification code — you're all set to continue.",
    action: "continue where you left off",
    emoji: "🔄",
  },
};

/**
 * Splits the OTP into individual boxed digits for the HTML email,
 * so it reads clearly and matches typical OTP-input UI patterns.
 */
function renderOtpBoxes(otp: string): string {
  const spaced = otp.split("").map((d) => escapeHtml(d)).join("&nbsp;&nbsp;");
  return `
    <td style="
      padding: 18px 32px;
      background-color: #F8FAFC;
      border: 1.5px dashed #CBD5E1;
      border-radius: 12px;
      text-align: center;
      font-family: 'Courier New', Courier, monospace;
      font-size: 30px;
      font-weight: 700;
      letter-spacing: 6px;
      color: #0F172A;
    ">${spaced}</td>`;
}

/**
 * Shared shell (head, header, card, footer) so every transactional email
 * — OTP, KYC, and future ones — shares one layout and one place to update it.
 */
function renderEmailLayout(subject: string, bodyHtml: string): string {
  const logoUrl = getLogoUrl();
  const logoImg = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="CampusHive" width="32" height="32" style="display:inline-block; vertical-align:middle; border-radius:6px; margin-right:10px; border:0;" />`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0; padding:0; background-color:${BRAND.extraLightPrimary}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BRAND.extraLightPrimary}; padding: 36px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px; width:100%; background-color:${BRAND.cardBg}; border:1px solid ${BRAND.border}; border-top:4px solid #EAB308; border-radius:14px; overflow:hidden;">

          <!-- Header -->
          <tr>
            <td align="center" style="padding: 28px 32px 20px; border-bottom:1px solid ${BRAND.border};">
              <div>
                ${logoImg}<span style="font-size:20px; font-weight:700; color:${BRAND.text}; vertical-align:middle;">CampusHive</span>
              </div>
              <p style="margin:6px 0 0; font-size:13px; color:${BRAND.muted};">
                Student Marketplace &amp; Community
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 28px 32px;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding: 18px 32px; border-top: 1px solid ${BRAND.border}; background-color:#FAFAFA;">
              <p style="margin:0; font-size:12px; color:${BRAND.muted};">
                CampusHive &bull; Connecting university students across campuses
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderHtml(otp: string, config: (typeof purposeConfig)[OtpPurpose]): string {
  const body = `
    <h1 style="margin:0 0 10px; font-size:20px; font-weight:700; line-height:1.35; color:${BRAND.text};">
      ${escapeHtml(config.heading)}
    </h1>
    <p style="margin:0 0 24px; font-size:15px; line-height:1.6; color:${BRAND.muted};">
      ${escapeHtml(config.intro)} Use the 6-digit code below to ${escapeHtml(config.action)}.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 24px;">
      <tr>${renderOtpBoxes(otp)}</tr>
    </table>

    <p style="margin:0 0 8px; font-size:13px; color:${BRAND.muted};">
      This code will expire in <strong style="color:${BRAND.text};">10 minutes</strong>.
    </p>
    <p style="margin:0; font-size:13px; color:${BRAND.muted};">
      If you did not request this verification code, you can safely ignore this email.
    </p>`;

  return renderEmailLayout(config.subject, body);
}

function renderText(otp: string, config: (typeof purposeConfig)[OtpPurpose]): string {
  return `${config.heading}

${config.intro}
Use the code below to ${config.action}:

${otp}

This code expires in 10 minutes. Never share it with anyone – not even CampusHive staff.

If you didn't request this, you can safely ignore this email.

The CampusHive Team`;
}

// ---------------------------------------------------------------------------
// KYC status emails
// ---------------------------------------------------------------------------

type KycStatus = "approved" | "rejected";

interface SendKycStatusEmailParams {
  email: string;
  name: string;
  status: KycStatus;
  /** Required when status is "rejected"; shown to the user so they know what to fix. */
  reason?: string;
  /** Link to wherever the user resubmits/reviews their KYC docs, e.g. deep link into the app. */
  actionUrl?: string;
}

const kycStatusConfig: Record<
  KycStatus,
  { subject: string; heading: string; emoji: string; accentColor: string; ctaLabel: string }
> = {
  approved: {
    subject: "Your CampusHive identity verification was approved",
    heading: "You're verified",
    emoji: "✅",
    accentColor: "#16A34A",
    ctaLabel: "Go to your dashboard",
  },
  rejected: {
    subject: "Action needed: your CampusHive identity verification",
    heading: "We couldn't verify your account",
    emoji: "⚠️",
    accentColor: "#DC2626",
    ctaLabel: "Resubmit your documents",
  },
};

function renderKycHtml(params: SendKycStatusEmailParams): string {
  const { name, status, reason, actionUrl } = params;
  const config = kycStatusConfig[status];
  const safeName = escapeHtml(name);
  const safeReason = escapeHtml(reason ?? "The submitted documents did not meet our verification requirements.");

  const approvedBody = `
    <h1 style="margin:0 0 12px; font-size:22px; line-height:1.3; color:${BRAND.text};">
      ${config.heading} ${config.emoji}
    </h1>
    <p style="margin:0 0 24px; font-size:15px; line-height:1.6; color:${BRAND.muted};">
      Hi ${safeName}, your identity verification has been approved. You now have full access
      to organizer features on CampusHive, including payouts.
    </p>`;

  const rejectedBody = `
    <h1 style="margin:0 0 12px; font-size:22px; line-height:1.3; color:${BRAND.text};">
      ${config.heading} ${config.emoji}
    </h1>
    <p style="margin:0 0 20px; font-size:15px; line-height:1.6; color:${BRAND.muted};">
      Hi ${safeName}, we reviewed the documents you submitted and weren't able to verify your
      identity this time.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#FEF2F2; border:1px solid #FECACA; border-radius:10px; padding:16px; margin-bottom:24px;">
      <tr>
        <td style="font-size:13px; line-height:1.6; color:#7F1D1D;">
          <strong>Reason:</strong> ${safeReason}
        </td>
      </tr>
    </table>
    <p style="margin:0 0 24px; font-size:15px; line-height:1.6; color:${BRAND.text};">
      Please resubmit clear, valid documents to continue.
    </p>`;

  const body = `
    ${status === "approved" ? approvedBody : rejectedBody}
    ${
      actionUrl
        ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin: 0 auto 8px;">
             <tr>
               <td style="border-radius:8px; background-color:${config.accentColor};">
                 <a href="${escapeHtml(actionUrl)}" style="display:inline-block; padding:12px 28px; font-size:14px; font-weight:600; color:#FFFFFF; text-decoration:none;">
                   ${config.ctaLabel}
                 </a>
               </td>
             </tr>
           </table>`
        : ""
    }`;

  return renderEmailLayout(config.subject, body);
}

function renderKycText(params: SendKycStatusEmailParams): string {
  const { name, status, reason, actionUrl } = params;
  const config = kycStatusConfig[status];

  if (status === "approved") {
    return `${config.heading}

  Hi ${name}, your identity verification has been approved. You now have full access to organizer features on CampusHive, including payouts.
  ${actionUrl ? `\n${config.ctaLabel}: ${actionUrl}\n` : ""}
  The CampusHive Team`;
    }

    return `${config.heading}

  Hi ${name}, we reviewed the documents you submitted and weren't able to verify your identity this time.

  Reason: ${reason ?? "The submitted documents did not meet our verification requirements."}

  Please resubmit clear, valid documents to continue.
  ${actionUrl ? `\n${config.ctaLabel}: ${actionUrl}\n` : ""}
  The CampusHive Team`;
}

export const sendKycStatusEmailService = async (params: SendKycStatusEmailParams) => {
  const { email, status } = params;
  const config = kycStatusConfig[status];

  try {
    const send = await sendEmailService({
      to: email,
      title: config.subject,
      text: renderKycText(params),
      htmlContent: renderKycHtml(params),
    });

    if (!send.success) {
      console.warn(`KYC ${status} email failed to send to ${email}`);
      return { success: false, message: `KYC ${status} email not sent` };
    }

    console.info(`KYC ${status} email sent successfully to ${email}`);
    return { success: true, message: `KYC ${status} email sent successfully` };
  } catch (error: any) {
    console.error("Failed to send KYC status email:", error?.message ?? error ?? "Unknown error");
    return { success: false, message: "Failed to send KYC status email" };
  }
};

export const sendOtpEmailService = async ({ otp, email, purpose }: SendOtpEmailParams) => {
  const config = purposeConfig[purpose];

  try {
    const send = await sendEmailService({
      to: email,
      title: config.subject,
      text: renderText(otp, config),
      htmlContent: renderHtml(otp, config),
    });

    if (!send.success) {
      console.warn(`OTP email (${purpose}) failed to send to ${email}`);
      return { success: false, message: `OTP email for ${purpose} not sent` };
    }

    console.info(`OTP email (${purpose}) sent successfully to ${email}`);
    return { success: true, message: `OTP email for ${purpose} sent successfully` };
  } catch (error: any) {
    console.error("Failed to send OTP email:", error?.message ?? error ?? "Unknown error");
    return { success: false, message: "Failed to send OTP email" };
  }
};