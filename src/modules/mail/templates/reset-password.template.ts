import { button, e, layout, Locale, RenderedTemplate } from './template-utils';

export interface ResetPasswordArgs {
  firstName?: string | null;
  resetUrl: string;
}

const COPY = {
  en: {
    subject: 'Reset your password',
    preheader: 'Use this link to choose a new password.',
    greeting: (name?: string | null) => `Hi${name ? ` ${name}` : ''},`,
    body: 'We received a request to reset your password. Click the button below to choose a new one. This link expires in 1 hour.',
    cta: 'Reset password',
    fallback: 'Or copy and paste this URL into your browser:',
    ignore:
      "If you didn't request a password reset, you can safely ignore this email — your password won't change.",
  },
  ar: {
    subject: 'إعادة تعيين كلمة المرور',
    preheader: 'استخدم هذا الرابط لاختيار كلمة مرور جديدة.',
    greeting: (name?: string | null) => `مرحبًا${name ? ` ${name}` : ''}،`,
    body: 'تلقينا طلبًا لإعادة تعيين كلمة المرور. اضغط على الزر أدناه لاختيار كلمة مرور جديدة. هذا الرابط صالح لمدة ساعة واحدة.',
    cta: 'إعادة تعيين كلمة المرور',
    fallback: 'أو انسخ هذا الرابط والصقه في متصفحك:',
    ignore:
      'إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذه الرسالة — لن تتغير كلمة المرور الخاصة بك.',
  },
} as const;

export function renderResetPassword(
  args: ResetPasswordArgs,
  locale: Locale = 'en',
): RenderedTemplate {
  const c = COPY[locale] ?? COPY.en;
  const bodyHtml = `
    <p>${e(c.greeting(args.firstName))}</p>
    <p>${e(c.body)}</p>
    ${button(args.resetUrl, c.cta, locale)}
    <p style="color:#64748b;font-size:13px;">${e(c.fallback)}<br><span style="word-break:break-all;">${e(args.resetUrl)}</span></p>
    <p style="color:#64748b;font-size:13px;">${e(c.ignore)}</p>
  `;
  const text = [
    c.greeting(args.firstName),
    '',
    c.body,
    '',
    args.resetUrl,
    '',
    c.ignore,
  ].join('\n');
  return {
    subject: c.subject,
    html: layout({ locale, preheader: c.preheader, bodyHtml }),
    text,
  };
}
