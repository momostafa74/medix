import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface OutboundMessage {
  to: { email?: string | null; phone?: string | null; name?: string };
  title: string;
  body: string;
}

/** Each external channel is an adapter; swapping SMS/WhatsApp vendors never touches business code. */
export interface NotificationChannelAdapter {
  readonly name: 'EMAIL' | 'SMS' | 'WHATSAPP';
  isConfigured(): boolean;
  send(msg: OutboundMessage): Promise<void>;
}

@Injectable()
export class EmailChannel implements NotificationChannelAdapter {
  readonly name = 'EMAIL' as const;
  private readonly logger = new Logger('EmailChannel');
  private transporter?: nodemailer.Transporter;

  constructor(private config: ConfigService) {
    const smtp = this.config.get('smtp');
    if (smtp?.host) {
      this.transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.port === 465,
        auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
      });
    }
  }

  isConfigured() {
    return !!this.transporter;
  }

  async send(msg: OutboundMessage) {
    if (!msg.to.email) return;
    if (!this.transporter) {
      this.logger.debug(`[dev] email to ${msg.to.email}: ${msg.title}`);
      return;
    }
    await this.transporter.sendMail({
      from: this.config.get('smtp.from'),
      to: msg.to.email,
      subject: msg.title,
      text: msg.body,
      html: `<div dir="rtl" style="font-family:Tahoma,Arial">${escapeHtml(msg.body).replace(/\n/g, '<br>')}</div>`,
    });
  }
}

@Injectable()
export class SmsChannel implements NotificationChannelAdapter {
  readonly name = 'SMS' as const;
  private readonly logger = new Logger('SmsChannel');
  isConfigured() {
    return false; // plug a vendor (e.g. Vodafone / Twilio) here
  }
  async send(msg: OutboundMessage) {
    this.logger.debug(`[dev] sms to ${msg.to.phone}: ${msg.title}`);
  }
}

@Injectable()
export class WhatsAppChannel implements NotificationChannelAdapter {
  readonly name = 'WHATSAPP' as const;
  private readonly logger = new Logger('WhatsAppChannel');
  constructor(private config: ConfigService) {}
  isConfigured() {
    return this.config.get('whatsapp.provider') === 'cloud_api' && !!this.config.get('whatsapp.token');
  }
  async send(msg: OutboundMessage) {
    // Ready for WhatsApp Business Cloud API: POST /{phone-number-id}/messages with a template.
    this.logger.debug(`[dev] whatsapp to ${msg.to.phone}: ${msg.title}`);
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
