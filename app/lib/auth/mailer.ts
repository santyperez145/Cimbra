type AuthMail = {
  to: string;
  subject: string;
  heading: string;
  message: string;
  actionLabel?: string;
  actionUrl?: string;
  idempotencyKey: string;
};

function setting(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[character] ?? character));
}

export function emailDeliveryAvailable() {
  return Boolean(setting('RESEND_API_KEY') && setting('CIMBRA_FROM_EMAIL'));
}

export async function sendAuthMail(mail: AuthMail) {
  const apiKey = setting('RESEND_API_KEY');
  const from = setting('CIMBRA_FROM_EMAIL');
  if (!apiKey || !from) return false;
  const action = mail.actionUrl && mail.actionLabel
    ? `<p style="margin:28px 0"><a href="${escapeHtml(mail.actionUrl)}" style="background:#101b2f;color:#fff;text-decoration:none;padding:13px 18px;border-radius:7px;display:inline-block">${escapeHtml(mail.actionLabel)}</a></p><p style="font-size:12px;color:#6d7580;word-break:break-all">${escapeHtml(mail.actionUrl)}</p>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f5f4ef;color:#101b2f;font-family:Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:40px 24px"><p style="font-weight:800;letter-spacing:.14em">CIMBRA</p><div style="background:#fff;border:1px solid #e0e1dd;border-radius:10px;padding:30px"><h1 style="font-size:25px;margin:0 0 16px">${escapeHtml(mail.heading)}</h1><p style="font-size:15px;line-height:1.65;color:#4f5965">${escapeHtml(mail.message)}</p>${action}<p style="font-size:12px;line-height:1.6;color:#818993;margin-top:28px">Si no solicitaste esta acción, podés ignorar este mensaje. Nunca compartas contraseñas ni códigos de seguridad.</p></div></div></body></html>`;
  const text = `${mail.heading}\n\n${mail.message}${mail.actionUrl ? `\n\n${mail.actionUrl}` : ''}\n\nSi no solicitaste esta acción, ignorá este mensaje.`;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': mail.idempotencyKey.slice(0, 256),
    },
    body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, html, text }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Transactional email delivery failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  return true;
}
