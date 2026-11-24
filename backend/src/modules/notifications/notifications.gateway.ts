import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthUserLoader } from '../auth/auth-user.loader';

type PresenceListener = (userId: string, online: boolean) => void;

/**
 * Real-time channel shared by notifications and chat. Clients connect to
 * namespace /realtime with `auth: { token: <accessToken> }`. The token is
 * verified AND the account is re-checked (active, token version) before the
 * socket joins its private room `user:<id>`. Presence is tracked per user.
 */
@WebSocketGateway({ namespace: '/realtime', cors: { origin: true, credentials: true } })
export class NotificationsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('Realtime');
  @WebSocketServer() server!: Server;
  private online = new Map<string, number>();
  private listeners: PresenceListener[] = [];

  constructor(
    private jwt: JwtService,
    private config: ConfigService,
    private loader: AuthUserLoader,
  ) {}

  onPresence(fn: PresenceListener) {
    this.listeners.push(fn);
  }

  isOnline(userId: string) {
    return (this.online.get(userId) ?? 0) > 0;
  }

  async authenticate(client: Socket): Promise<string | null> {
    if (client.data.userId) return client.data.userId;
    try {
      const token = (client.handshake.auth?.token as string) || '';
      const payload = await this.jwt.verifyAsync(token, { secret: this.config.get('jwt.accessSecret'), algorithms: ['HS256'] });
      const user = await this.loader.load(payload.sub);
      if (!user || user.status !== 'ACTIVE' || user.tokenVersion !== payload.tv) return null;
      client.data.userId = user.id;
      return user.id;
    } catch {
      return null;
    }
  }

  async handleConnection(client: Socket) {
    const userId = await this.authenticate(client);
    if (!userId) {
      client.emit('error', { message: 'unauthorized' });
      client.disconnect(true);
      return;
    }
    await client.join(`user:${userId}`);
    const n = (this.online.get(userId) ?? 0) + 1;
    this.online.set(userId, n);
    if (n === 1) this.listeners.forEach((l) => l(userId, true));
  }

  handleDisconnect(client: Socket) {
    const userId = client.data.userId as string | undefined;
    if (!userId) return;
    const n = (this.online.get(userId) ?? 1) - 1;
    if (n <= 0) {
      this.online.delete(userId);
      this.listeners.forEach((l) => l(userId, false));
    } else this.online.set(userId, n);
  }

  emitToUser(userId: string, event: string, data: unknown) {
    try {
      this.server?.to(`user:${userId}`).emit(event, data);
    } catch (e) {
      this.logger.warn(`emit failed: ${(e as Error).message}`);
    }
  }

  emitToUsers(userIds: Iterable<string>, event: string, data: unknown) {
    const rooms = [...new Set(userIds)].map((id) => `user:${id}`);
    if (rooms.length) this.server?.to(rooms).emit(event, data);
  }
}
