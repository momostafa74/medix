import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, ReqMeta, RequestMeta, RequireAnyPermission } from '../../common/decorators';
import { AuthUser } from '../../common/auth-user';
import { P } from '../../common/permissions';
import { ChatService } from './chat.service';
import { MessagesQuery, OpenRoomDto, ReportDto, RoomsQuery, SendMessageDto } from './chat.dto';

@ApiTags('Chat')
@ApiBearerAuth()
@Controller('chat')
@RequireAnyPermission(P.CHAT_USE, P.CHAT_SUPPORT)
export class ChatController {
  constructor(private chat: ChatService) {}

  @Post('rooms')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  open(@CurrentUser() u: AuthUser, @Body() dto: OpenRoomDto) {
    return this.chat.open(u, dto);
  }

  @Get('rooms')
  list(@CurrentUser() u: AuthUser, @Query() q: RoomsQuery) {
    return this.chat.list(u, q);
  }

  @Get('unread-count')
  unread(@CurrentUser() u: AuthUser) {
    return this.chat.unreadTotal(u);
  }

  @Get('rooms/:id')
  room(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.getRoom(u, id);
  }

  @Get('rooms/:id/messages')
  messages(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: MessagesQuery, @ReqMeta() meta: RequestMeta) {
    return this.chat.messages(u, id, q, meta);
  }

  @Post('rooms/:id/messages')
  send(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendMessageDto) {
    return this.chat.send(u, id, dto);
  }

  @HttpCode(200)
  @Post('rooms/:id/read')
  read(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.markRead(u, id);
  }

  @HttpCode(200)
  @Post('rooms/:id/block')
  block(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.chat.block(u, id, meta);
  }

  @HttpCode(200)
  @Post('rooms/:id/unblock')
  unblock(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMeta) {
    return this.chat.unblock(u, id, meta);
  }

  @HttpCode(200)
  @Post('rooms/:id/report')
  report(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReportDto, @ReqMeta() meta: RequestMeta) {
    return this.chat.report(u, id, dto.reason, meta);
  }

  @HttpCode(200)
  @Post('rooms/:id/dismiss-report')
  dismiss(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.chat.dismissReport(u, id);
  }
}
