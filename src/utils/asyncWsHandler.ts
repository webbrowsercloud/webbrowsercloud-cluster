import { IncomingMessage } from 'http';
import net from 'net';
import url from 'url';
import { rejectSocket } from './rejectSocket';

export type IUpgradeHandler = (
  req: IncomingMessage,
  socket: net.Socket,
  head: Buffer,
) => Promise<any>;

export interface IHTTPRequest extends IncomingMessage {
  parsed: url.UrlWithParsedQuery;
}

export class AuthorizedError extends Error {}

export class GatewayBusyError extends Error {}

export class EmptyWorkerError extends Error {}

export const asyncWsHandler = (handler: IUpgradeHandler) => {
  return (req: IncomingMessage, socket: net.Socket, head: Buffer) => {
    Promise.resolve(handler(req, socket, head)).catch((error: Error) => {
      if (error instanceof GatewayBusyError) {
        // 分配不出来浏览器，拒绝客户端 ws 升级请求
        rejectSocket({
          header:
            'HTTP/1.1 429 Server Error\nX-WebSocket-Reject-Reason: Browser worker busy!',
          message: 'Server Error',
          socket,
        });

        return;
      }

      if (error instanceof AuthorizedError) {
        rejectSocket({
          header: `HTTP/1.1 403 Forbidden\nX-WebSocket-Reject-Reason: Invalid api token!`,
          message: `Forbidden`,
          socket,
        });

        return;
      }

      if (error instanceof EmptyWorkerError) {
        rejectSocket({
          header: `HTTP/1.1 500 Forbidden\nX-WebSocket-Reject-Reason: Empty browser worker!`,
          message: `Server Error`,
          socket,
        });

        return;
      }

      rejectSocket({
        header: `HTTP/1.1 400 Bad Request`,
        message: error?.message,
        socket,
      });
    });
  };
};
