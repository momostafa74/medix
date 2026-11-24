import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private ds: DataSource) {}

  @Public()
  @Get()
  async health() {
    const started = Date.now();
    let db = 'up';
    try {
      await this.ds.query('SELECT 1');
    } catch {
      db = 'down';
    }
    return { status: db === 'up' ? 'ok' : 'degraded', db, latencyMs: Date.now() - started, time: new Date().toISOString() };
  }
}
