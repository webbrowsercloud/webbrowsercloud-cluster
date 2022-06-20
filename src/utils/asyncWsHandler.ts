import { IncomingMessage } from 'http';
import net from 'net';
import url from 'url';

export type IUpgradeHandler = (
  req: IncomingMessage,
  socket: net.Socket,
  head: Buffer,
) => Promise<any>;

export interface IHTTPRequest extends IncomingMessage {
  parsed: url.UrlWithParsedQuery;
}

export const asyncWsHandler = (handler: IUpgradeHandler) => {
  return (req: IncomingMessage, socket: net.Socket, head: Buffer) => {
    Promise.resolve(handler(req, socket, head)).catch((error: Error) => {
      socket.write(
        [
          'HTTP/1.1 400 Bad Request',
          'Content-Type: text/plain; charset=UTF-8',
          'Content-Encoding: UTF-8',
          'Accept-Ranges: bytes',
          'Connection: keep-alive',
        ].join('\n') + '\n\n',
      );
      socket.write(Buffer.from('Bad Request, ' + error.message));
      socket.end();
    });
  };
};
