import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { AuthUserLoader } from '../auth/auth-user.loader';
import { NotificationsGateway } from '../notifications/notifications.gateway';
import { P } from '../../common/permissions';
import { ChatService } from './chat.service';
import { SendMessageDto } from './chat.dto';

/**
 * Socket events on the shared /realtime namespace:
 *   → chat:send   { roomId, body?, fileId?, clientId? }   (ack: { ok, message } | { ok:false, error })
 *   → chat:typing { roomId }
 *   → chat:read   { roomId }
 *   ← chat:message, chat:typing, chat:read, chat:presence, chat:room
 * Each event re-resolves the principal from the DB-backed loader and re-checks membership.
 */
@WebSocketGateway({ namespace: '/realtime', cors: { origin: true, credentials: true } })
export class ChatGateway {
  private readonly logger = new Logger('ChatGateway');

  constructor(
    private chat: ChatService,
    private realtime: NotificationsGateway,
    private loader: AuthUserLoader,
  ) {}

  private async principal(client: Socket) {
    const id = await this.realtime.authenticate(client);
    if (!id) return null;
    const user = await this.loader.load(id);
    if (!user || user.status !== 'ACTIVE') return null;
    if (!user.permissions.has(P.CHAT_USE) && !user.permissions.has(P.CHAT_SUPPORT)) return null;
    return user;
  }

  private err(e: unknown) {
    const r = (e as any)?.getResponse?.();
    return { ok: false, error: (typeof r === 'object' ? r?.message : r) || 'تعذّر تنفيذ الطلب' };
  }

  @SubscribeMessage('chat:send')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async send(@ConnectedSocket() client: Socket, @MessageBody() data: SendMessageDto & { roomId: string }) {
    const user = await this.principal(client);
    if (!user) return { ok: false, error: 'unauthorized' };
    try {
      const message = await this.chat.send(user, String(data?.roomId), { body: data?.body, fileId: data?.fileId, clientId: data?.clientId });
      return { ok: true, message };
    } catch (e) {
      return this.err(e);
    }
  }

  @SubscribeMessage('chat:typing')
  async typing(@ConnectedSocket() client: Socket, @MessageBody() data: { roomId: string }) {
    const user = await this.principal(client);
    if (!user) return;
    try {
      await this.chat.typing(user, String(data?.roomId));
    } catch {
      /* not a member — ignore silently */
    }
  }

  @SubscribeMessage('chat:read')
  async read(@ConnectedSocket() client: Socket, @MessageBody() data: { roomId: string }) {
    const user = await this.principal(client);
    if (!user) return { ok: false };
    try {
      return await this.chat.markRead(user, String(data?.roomId));
    } catch (e) {
      return this.err(e);
    }
  }
}
