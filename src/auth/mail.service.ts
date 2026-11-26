import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

/** Gmail delivery for the 6-digit onboarding code. */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const user =
      this.config.get<string>('SMTP_USER') ?? 'arifindepayjr@gmail.com';
    // Gmail displays App Passwords in spaced groups; Nodemailer needs them
    // without whitespace. Never log or echo this value.
    const pass = this.config
      .get<string>('SMTP_APP_PASSWORD')
      ?.replace(/\s/g, '');
    this.from = this.config.get<string>('SMTP_FROM') ?? `TradeLog <${user}>`;

    // Without an App Password we stay in development mode: the API returns the
    // code as `devCode` instead of pretending to send an email.
    this.transporter = pass
      ? nodemailer.createTransport({
          service: 'gmail',
          auth: { user, pass },
        })
      : null;

    if (this.transporter) {
      this.logger.log('Gmail OTP delivery is configured.');
    } else {
      this.logger.warn('Gmail OTP delivery is not configured; using devCode fallback.');
    }
  }

  get isConfigured(): boolean {
    return this.transporter !== null;
  }

  /** Returns false when email is not configured; throws on delivery failure. */
  async sendOtp(
    to: string,
    name: string,
    code: string,
    expiresInMinutes = 10,
  ): Promise<boolean> {
    if (!this.transporter) return false;

    try {
      await this.transporter.sendMail({
        from: this.from,
        to,
        subject: 'Your TradeLog verification code',
        text:
          `Hi ${name},\n\n` +
          `Your TradeLog verification code is ${code}.\n` +
          `It expires in ${expiresInMinutes} minutes. ` +
          `If you did not request this, you can ignore this email.\n\n` +
          `— TradeLog`,
        html: `
          <div style="font-family:Arial,sans-serif;background:#111411;color:#f0fdf4;padding:24px;">
            <h2 style="color:#b7f7c4;margin:0 0 12px;">TradeLog verification code</h2>
            <p style="color:#889088;margin:0 0 18px;">Hi ${escapeHtml(name)},</p>
            <div style="display:inline-block;padding:14px 22px;border:1px solid #b7f7c4;border-radius:10px;font-size:28px;letter-spacing:8px;font-weight:700;color:#b7f7c4;">${code}</div>
            <p style="color:#889088;margin:18px 0 0;">This single-use code expires in ${expiresInMinutes} minutes. If you did not request it, ignore this email.</p>
          </div>
        `,
      });
      this.logger.log(`Verification email sent to ${to}`);
      return true;
    } catch (error) {
      this.logger.error(`Could not send verification email to ${to}: ${error}`);
      throw new InternalServerErrorException({
        error: 'Could not send the verification email. Please try again.',
      });
    }
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
