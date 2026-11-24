import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

const STATUS_MESSAGES: Record<number, string> = {
  400: 'البيانات المرسلة غير صحيحة',
  401: 'يجب تسجيل الدخول أولاً',
  403: 'غير مصرح لك بتنفيذ هذا الإجراء',
  404: 'العنصر المطلوب غير موجود',
  409: 'تعارض مع بيانات موجودة',
  413: 'حجم الملف أكبر من المسموح',
  423: 'الحساب مقفول مؤقتاً',
  429: 'طلبات كثيرة، حاول مرة أخرى بعد قليل',
  500: 'حدث خطأ غير متوقع، حاول مرة أخرى لاحقاً',
};

/**
 * Centralised error handling. Clients get a stable shape with a friendly Arabic
 * message; stack traces, SQL and internals are ONLY written to the server log.
 *   { statusCode, error, message, details?, requestId }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();
    const requestId = req.id;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = STATUS_MESSAGES[500];
    let error = 'INTERNAL_ERROR';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as any;
      error = body?.error ? String(body.error).toUpperCase().replace(/\s+/g, '_') : 'ERROR';
      if (typeof body === 'string') message = body;
      else if (Array.isArray(body?.message)) {
        message = STATUS_MESSAGES[400];
        details = body.message;
        error = 'VALIDATION_ERROR';
      } else if (body?.message) message = body.message;
      if (body?.code) error = body.code;
      // Never echo framework-English defaults to Arabic users
      if (/^(Unauthorized|Forbidden|Not Found|Cannot \w+ \/)/i.test(message)) {
        message = STATUS_MESSAGES[status] || message;
      }
      if (status === 413) message = STATUS_MESSAGES[413];
    } else if (exception instanceof QueryFailedError) {
      const code = (exception as any).driverError?.code;
      if (code === '23P01') {
        status = 409;
        error = 'SLOT_UNAVAILABLE';
        message = 'هذا الموعد تم حجزه للتو، من فضلك اختر موعداً آخر';
      } else if (code === '23505') {
        status = 409;
        error = 'DUPLICATE';
        message = 'هذه البيانات مسجلة من قبل';
      } else if (code === '23503') {
        status = 400;
        error = 'INVALID_REFERENCE';
        message = 'أحد العناصر المرتبطة غير موجود';
      } else if (code === '23514' || code === '22P02' || code === '22007' || code === '22008') {
        status = 400;
        error = 'INVALID_DATA';
        message = STATUS_MESSAGES[400];
      }
      if (status === 500) this.logger.error(`[${requestId}] DB error: ${exception.message}`, exception.stack);
      else this.logger.warn(`[${requestId}] DB constraint ${code}: ${exception.message}`);
    } else {
      const err = exception as Error;
      this.logger.error(`[${requestId}] ${req.method} ${req.url} → ${err?.message}`, err?.stack);
    }

    if (status >= 500 && exception instanceof HttpException) {
      this.logger.error(`[${requestId}] ${req.method} ${req.url} → ${status}`, (exception as Error).stack);
      message = STATUS_MESSAGES[500];
    }

    res.status(status).json({ statusCode: status, error, message, ...(details ? { details } : {}), requestId });
  }
}
