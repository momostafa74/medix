/** Centralised, typed configuration. Fails fast on missing secrets in production. */
export default () => {
  const env = process.env;
  const isProd = env.NODE_ENV === 'production';
  const required = ['DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET'];
  for (const key of required) {
    if (!env[key]) throw new Error(`Missing required environment variable: ${key}`);
  }
  if (isProd && (env.JWT_SECRET!.length < 32 || env.JWT_REFRESH_SECRET!.length < 32)) {
    throw new Error('JWT secrets must be at least 32 characters in production');
  }
  return {
    nodeEnv: env.NODE_ENV || 'development',
    isProd,
    port: parseInt(env.PORT || '4000', 10),
    timezone: env.APP_TIMEZONE || 'Africa/Cairo',
    frontendUrl: env.FRONTEND_URL || 'http://localhost:5173',
    backendUrl: env.BACKEND_URL || 'http://localhost:4000',
    databaseUrl: env.DATABASE_URL!,
    jwt: {
      accessSecret: env.JWT_SECRET!,
      refreshSecret: env.JWT_REFRESH_SECRET!,
      accessTtl: env.JWT_ACCESS_TTL || '15m',
      refreshTtlDays: parseInt(env.JWT_REFRESH_TTL_DAYS || '30', 10),
    },
    security: {
      /** Encrypts 2FA secrets at rest. Defaults to the refresh secret; set its own value in production (rotating it disables existing 2FA enrolments). */
      encryptionKey: env.ENCRYPTION_KEY || env.JWT_REFRESH_SECRET!,
      /** Requests slower than this are logged as warnings and counted in /system/health. */
      slowRequestMs: parseInt(env.SLOW_REQUEST_MS || '1000', 10),
      slowQueryMs: parseInt(env.SLOW_QUERY_MS || '500', 10),
    },
    cookies: {
      secure: (env.COOKIE_SECURE ?? (isProd ? 'true' : 'false')) === 'true',
      domain: env.COOKIE_DOMAIN || undefined,
    },
    storage: {
      driver: env.UPLOAD_STORAGE || 'local', // local | s3 | cloudinary
      localDir: env.UPLOAD_LOCAL_DIR || './storage',
      maxFileSizeMb: parseInt(env.UPLOAD_MAX_MB || '10', 10),
      s3: {
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
        bucket: env.S3_BUCKET,
        accessKeyId: env.S3_ACCESS_KEY_ID,
        secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      },
      cloudinary: {
        cloudName: env.CLOUDINARY_CLOUD_NAME,
        apiKey: env.CLOUDINARY_API_KEY,
        apiSecret: env.CLOUDINARY_API_SECRET,
      },
    },
    smtp: {
      host: env.SMTP_HOST,
      port: parseInt(env.SMTP_PORT || '587', 10),
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: env.SMTP_FROM || 'Medix <no-reply@medix.local>',
    },
    whatsapp: {
      provider: env.WHATSAPP_PROVIDER || 'link', // link (wa.me) | cloud_api
      token: env.WHATSAPP_TOKEN,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    },
    payment: {
      /** Online gateway: sandbox (built-in test checkout) | paymob | none. */
      gateway: env.PAYMENT_GATEWAY || (isProd ? 'none' : 'sandbox'),
      sandboxSecret: env.PAYMENT_SANDBOX_SECRET || `${env.JWT_SECRET}:sandbox`,
      paymobBaseUrl: env.PAYMOB_BASE_URL || 'https://accept.paymob.com',
      paymobApiKey: env.PAYMOB_API_KEY,
      paymobIntegrationId: env.PAYMOB_INTEGRATION_ID,
      paymobIframeId: env.PAYMOB_IFRAME_ID,
      paymobHmacSecret: env.PAYMOB_HMAC_SECRET,
    },
    pdf: {
      /** Chromium/Chrome binary used to render Arabic PDFs. Auto-detected when empty. */
      chromiumPath: env.CHROMIUM_PATH || undefined,
    },
    throttle: {
      ttlSeconds: parseInt(env.THROTTLE_TTL || '60', 10),
      limit: parseInt(env.THROTTLE_LIMIT || '120', 10),
    },
  };
};


