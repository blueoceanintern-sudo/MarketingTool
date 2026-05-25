export function buildEmailHtml(body: string, leadId: string, apiBaseUrl: string): string {
  const unsubscribeUrl = `${apiBaseUrl}/unsubscribe?id=${leadId}`;
  const bodyHtml = body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");

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
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background-color:#021745;padding:20px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:32px;height:32px;background-color:#1b3d8a;border-radius:6px;text-align:center;vertical-align:middle;">
                    <span style="color:#ffffff;font-size:18px;font-weight:700;line-height:32px;">B</span>
                  </td>
                  <td style="padding-left:10px;">
                    <span style="color:#ffffff;font-size:17px;font-weight:700;letter-spacing:-0.3px;">BlueOcean</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 32px 24px;color:#1b1b1f;font-size:15px;line-height:1.75;">
              ${bodyHtml}
            </td>
          </tr>

          <!-- Divider -->
          <tr>
            <td style="padding:0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="border-top:1px solid #eceef2;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px 32px;text-align:center;">
              <p style="margin:0 0 16px 0;font-size:12px;color:#7d8799;line-height:1.5;">
                You received this email because your business contact is publicly listed.<br />
                To stop receiving emails from us, click the button below.
              </p>
              <a href="${unsubscribeUrl}"
                 style="display:inline-block;background-color:#f5f7fa;border:1px solid #c2c8d4;color:#3d4557;font-size:12px;font-weight:500;padding:9px 22px;border-radius:6px;text-decoration:none;letter-spacing:0.1px;">
                Unsubscribe
              </a>
              <p style="margin:20px 0 0 0;font-size:11px;color:#b0b8c8;">
                BlueOcean &middot; Singapore &middot; Australia &middot; United States
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
