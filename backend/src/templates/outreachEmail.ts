function escapeHtml(input: string): string {
  return input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function humanizeEmailLocalPart(email: string): string {
  const localPart = email.split("@")[0] ?? "";
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

function initialsFor(displayName: string): string {
  const words = displayName.split(" ").filter(Boolean);
  if (words.length === 0) return "BO";
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

export interface EmailHtmlParams {
  subject: string;
  body: string;
  unsubscribeUrl: string;
  // Email of the rep who approved/sent this draft (emailDrafts.approvedBy).
  // Falls back to a generic team sign-off when absent (e.g. auto-scheduled sends).
  senderEmail?: string | null;
  // Optional booking-page link (BOOKING_URL env var). CTA button is omitted when unset.
  bookingUrl?: string | null;
}

export function buildEmailHtml(params: EmailHtmlParams): string {
  const { subject, body, unsubscribeUrl, senderEmail, bookingUrl } = params;
  const subjectHtml = escapeHtml(subject);
  const bodyHtml = escapeHtml(body).replace(/\n/g, "<br>");

  const displayName = senderEmail ? humanizeEmailLocalPart(senderEmail) : "The BlueOcean Team";
  const initials = senderEmail ? initialsFor(displayName) : "BO";

  const ctaRow = bookingUrl
    ? `
          <!-- CTA -->
          <tr>
            <td style="padding:8px 32px 4px;text-align:center;">
              <a href="${bookingUrl}"
                 style="display:inline-block;background-color:#1b3d8a;color:#ffffff;font-size:14px;font-weight:700;padding:14px 34px;border-radius:999px;text-decoration:none;letter-spacing:0.2px;">
                Book a time to chat
              </a>
            </td>
          </tr>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <title>BlueOcean</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f7fa;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f5f7fa;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:18px;overflow:hidden;box-shadow:0 12px 32px rgba(2,23,69,0.16);">

          <!-- Gradient hero -->
          <tr>
            <td bgcolor="#021745" style="background-color:#021745;background-image:linear-gradient(135deg,#021745 0%,#123a8f 55%,#1b3d8a 100%);padding:32px 32px 40px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:34px;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width:34px;height:34px;background-color:rgba(255,255,255,0.14);border:1px solid rgba(255,255,255,0.32);border-radius:10px;text-align:center;vertical-align:middle;">
                          <span style="color:#ffffff;font-size:16px;font-weight:800;line-height:34px;">B</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td style="padding-left:10px;" valign="middle">
                    <span style="color:#ffffff;font-size:14px;font-weight:700;letter-spacing:0.01em;">BlueOcean</span>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-top:26px;">
                    <span style="display:inline-block;background-color:rgba(255,255,255,0.14);color:#ffffff;font-size:10px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;padding:6px 14px;border-radius:999px;">
                      Worth 30 seconds
                    </span>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:16px;">
                    <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:800;line-height:1.28;letter-spacing:-0.5px;">
                      ${subjectHtml}
                    </h1>
                  </td>
                </tr>
                <tr>
                  <td style="padding-top:14px;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width:44px;height:4px;background-color:rgba(255,255,255,0.5);border-radius:2px;font-size:0;line-height:0;">&nbsp;</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Message card -->
          <tr>
            <td style="padding:40px 32px 8px;">
              <span style="font-family:Georgia,'Times New Roman',serif;font-size:64px;line-height:0.4;color:#1b3d8a;font-weight:700;">&#8220;</span>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-top:14px;color:#1b1b1f;font-size:16px;line-height:1.8;">
                    ${bodyHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Signature -->
          <tr>
            <td style="padding:24px 32px 4px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:40px;height:40px;background-color:#eef1fa;border-radius:999px;text-align:center;vertical-align:middle;">
                    <span style="color:#1b3d8a;font-weight:700;font-size:14px;">${initials}</span>
                  </td>
                  <td style="padding-left:12px;" valign="middle">
                    <div style="font-size:14px;font-weight:700;color:#1b1b1f;line-height:1.4;">${displayName}</div>
                    <div style="font-size:12px;color:#7d8799;line-height:1.4;">BlueOcean &middot; Outreach Team</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
${ctaRow}

          <!-- Divider -->
          <tr>
            <td style="padding:28px 32px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-top:2px dotted #c9d3e8;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer (navy bookend) -->
          <tr>
            <td bgcolor="#021745" style="background-color:#021745;padding:28px 32px 32px;text-align:center;">
              <p style="margin:0 0 16px 0;font-size:12px;color:rgba(255,255,255,0.65);line-height:1.6;">
                You received this email because your business contact is publicly listed.
              </p>
              <a href="${unsubscribeUrl}"
                 style="display:inline-block;background-color:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.32);color:#ffffff;font-size:12px;font-weight:600;padding:9px 24px;border-radius:999px;text-decoration:none;letter-spacing:0.2px;">
                Unsubscribe
              </a>
              <p style="margin:18px 0 0 0;font-size:10px;font-weight:700;color:rgba(255,255,255,0.4);letter-spacing:0.16em;text-transform:uppercase;">
                BlueOcean
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
