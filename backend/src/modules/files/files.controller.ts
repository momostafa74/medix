import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { AllowUnsubscribed, CurrentUser, Public, ReqMeta, RequestMeta, RequirePermissions } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { FILE_PURPOSES, FilesService } from './files.service';

class UploadDto {
  @ApiProperty({ enum: Object.keys(FILE_PURPOSES) })
  @IsIn(Object.keys(FILE_PURPOSES))
  purpose!: string;
}

@ApiTags('Files')
@AllowUnsubscribed()
@Controller('files')
export class FilesController {
  constructor(private files: FilesService) {}

  @ApiBearerAuth()
  @Post()
  @RequirePermissions(P.FILES_UPLOAD)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, purpose: { type: 'string' } } } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } }))
  upload(@CurrentUser() u: AuthUser, @UploadedFile() file: Express.Multer.File, @Body() dto: UploadDto) {
    return this.files.upload(u, file, dto.purpose);
  }

  /**
   * Public files stream to anyone; private ones require a Bearer token and pass
   * ownership/relationship checks. Private files are never served from a static URL.
   */
  @Public()
  @Get(':id')
  async download(
    @CurrentUser() u: AuthUser | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @ReqMeta() meta: RequestMeta,
    @Res() res: Response,
  ) {
    const { file, stream } = await this.files.open(u, id, meta);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`);
    res.setHeader('Cache-Control', file.visibility === 'PUBLIC' ? 'public, max-age=86400' : 'private, no-store');
    stream.pipe(res);
  }
}
