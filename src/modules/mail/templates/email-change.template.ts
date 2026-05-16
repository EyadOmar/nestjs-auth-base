import { button, e, layout, Locale, RenderedTemplate } from './template-utils';

export interface EmailChangeArgs {
  firstName?: string | null;
  newEmail: string;
  confirmUrl: string;
}

const COPY = {
  en: {
    subject: 'Confirm your new email',
    preheader: 'Approve the email change on your account.',
    greeting: (name?: string | null) => `Hi${name ? ` ${name}` : ''},`,
    body: (email: string) =>
      `You asked to change the email on your account to ${email}. Click below to confirm the change. This link expires in 1 hour.`,
    cta: 'Confirm email change',
    fallback: 'Or copy and paste this URL into your browser:',
    ignore:
      "If you didn't request this change, you can safely ignore this email — your email won't be changed.",
  },
  ar: {
    subject: 'تأكيد البريد الإلكتروني الجديد',
    preheader: 'الموافقة على تغيير البريد الإلكتروني لحسابك.',
    greeting: (name?: string | null) => `مرحبًا${name ? ` ${name}` : ''}،`,
    body: (email: string) =>
      `طلبت تغيير البريد الإلكتروني لحسابك إلى ${email}. اضغط أدناه لتأكيد التغيير. هذا الرابط صالح لمدة ساعة واحدة.`,
    cta: 'تأكيد تغيير البريد',
    fallback: 'أو انسخ هذا الرابط والصقه في متصفحك:',
    ignore:
      'إذا لم تطلب هذا التغيير، يمكنك تجاهل هذه الرسالة — لن يتم تغيير بريدك.',
  },
} as const;

export function renderEmailChange(
  args: EmailChangeArgs,
  locale: Locale = 'en',
): RenderedTemplate {
  const c = COPY[locale] ?? COPY.en;
  const bodyHtml = `
    <p>${e(c.greeting(args.firstName))}</p>
    <p>${e(c.body(args.newEmail))}</p>
    ${button(args.confirmUrl, c.cta, locale)}
    <p style="color:#64748b;font-size:13px;">${e(c.fallback)}<br><span style="word-break:break-all;">${e(args.confirmUrl)}</span></p>
    <p style="color:#64748b;font-size:13px;">${e(c.ignore)}</p>
  `;
  const text = [
    c.greeting(args.firstName),
    '',
    c.body(args.newEmail),
    '',
    args.confirmUrl,
    '',
    c.ignore,
  ].join('\n');
  return {
    subject: c.subject,
    html: layout({ locale, preheader: c.preheader, bodyHtml }),
    text,
  };
}
