import { Global, Injectable, Logger, Module, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import * as QRCode from 'qrcode';
import type { Browser } from 'puppeteer-core';

const CANDIDATES = [
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/opt/pw-browsers/chromium',
];

/**
 * HTML → PDF through headless Chromium. Chromium's text shaping renders Arabic
 * (joining, RTL, mixed Latin/Arabic numbers) correctly, which PDF libraries that
 * draw glyphs themselves do not. The Arabic font is embedded from /assets/fonts, so
 * output never depends on fonts installed on the server.
 */
@Injectable()
export class PdfService implements OnModuleDestroy {
  private readonly logger = new Logger('Pdf');
  private browser: Promise<Browser> | null = null;
  private fontCss: string | null = null;
  private readonly executablePath: string | null;

  constructor(config: ConfigService) {
    const configured = config.get<string>('pdf.chromiumPath');
    this.executablePath = [configured, ...CANDIDATES].find((p) => p && existsSync(p)) || null;
    if (configured && this.executablePath !== configured) this.logger.warn(`CHROMIUM_PATH ${configured} not found — using ${this.executablePath ?? 'none'}`);
    if (!this.executablePath) this.logger.warn('Chromium not found: PDF reports are disabled until CHROMIUM_PATH is set');
  }

  get available() {
    return !!this.executablePath;
  }

  /** @font-face rules with the bundled IBM Plex Sans Arabic (Arabic + Latin subsets), as data URLs. */
  fonts(): string {
    if (this.fontCss !== null) return this.fontCss;
    const dirs = [path.resolve(__dirname, '../../../assets/fonts'), path.resolve(process.cwd(), 'assets/fonts')];
    const dir = dirs.find((d) => existsSync(d));
    if (!dir) {
      this.logger.warn('assets/fonts not found — PDFs will use system fonts');
      return (this.fontCss = '');
    }
    const rules: string[] = [];
    for (const w of [400, 600, 700]) {
      for (const subset of ['arabic', 'latin']) {
        const f = path.join(dir, `ibm-plex-sans-arabic-${subset}-${w}-normal.woff2`);
        if (!existsSync(f)) continue;
        const range = subset === 'arabic' ? 'U+0600-06FF, U+0750-077F, U+08A0-08FF, U+FB50-FDFF, U+FE70-FEFF, U+200C-200F, U+25CC' : 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215';
        rules.push(
          `@font-face{font-family:'Plex Arabic';font-weight:${w};font-style:normal;src:url(data:font/woff2;base64,${readFileSync(f).toString('base64')}) format('woff2');unicode-range:${range};}`,
        );
      }
    }
    return (this.fontCss = rules.join('\n'));
  }

  qrDataUrl(text: string) {
    return QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 1, width: 220, color: { dark: '#13252B', light: '#FFFFFF' } });
  }

  private getBrowser(): Promise<Browser> {
    if (!this.executablePath) {
      throw new ServiceUnavailableException('خدمة إنشاء ملفات PDF غير مهيأة على الخادم (CHROMIUM_PATH)');
    }
    if (!this.browser) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const puppeteer = require('puppeteer-core');
      this.browser = puppeteer
        .launch({
          executablePath: this.executablePath,
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none', '--disable-gpu'],
        })
        .then((b: Browser) => {
          b.on('disconnected', () => (this.browser = null));
          return b;
        })
        .catch((e: Error) => {
          this.browser = null;
          this.logger.error(`Chromium failed to start: ${e.message}`);
          throw new ServiceUnavailableException('تعذر تشغيل خدمة PDF على الخادم');
        });
    }
    return this.browser!;
  }

  /**
   * Renders self-contained HTML (no network: JavaScript disabled, every external
   * request aborted) to a PDF buffer (A4 by default; prescriptions use A5).
   */
  async render(html: string, opts: { footerTemplate?: string; format?: 'A4' | 'A5' } = {}): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', (req) => (req.url().startsWith('data:') || req.url() === 'about:blank' ? req.continue() : req.abort()));
      await page.setContent(html, { waitUntil: 'load', timeout: 20_000 });
      await page.evaluateHandle('document.fonts.ready').catch(() => undefined);
      const pdf = await page.pdf({
        format: opts.format ?? 'A4',
        printBackground: true,
        margin: { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' },
        displayHeaderFooter: !!opts.footerTemplate,
        headerTemplate: '<span></span>',
        footerTemplate: opts.footerTemplate,
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async onModuleDestroy() {
    if (this.browser) {
      const b = await this.browser.catch(() => null);
      await b?.close().catch(() => undefined);
    }
  }
}

/** Escape text for HTML templates. */
export const esc = (v: unknown) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

@Global()
@Module({ providers: [PdfService], exports: [PdfService] })
export class PdfModule {}
