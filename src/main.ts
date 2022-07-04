import { NestFactory } from '@nestjs/core';
import { CoreModule } from './app/core/core.module';
import 'dotenv/config';
import { asyncWsHandler } from './utils/asyncWsHandler';
import { IncomingMessage } from 'http';
import { Socket } from 'net';
import { WorkerService } from './app/core/service/worker.service';
import { createProxyServer } from 'http-proxy';
import { ServerResponse } from 'http';
import { Logger } from 'nestjs-pino';
import { v4 as uuidv4 } from 'uuid';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.create(CoreModule);

  await app.listen(process.env.PROT || 3000, async () => {
    const server = app.getHttpServer();

    const workerService = app.get(WorkerService);
    const configService = app.get(ConfigService);
    const logger = app.get(Logger);

    // 刷新一下工人列表
    await workerService.refreshWorkerList();

    const proxy = createProxyServer();

    proxy.on('error', (err, _req, res) => {
      if (res instanceof ServerResponse) {
        res.writeHead && res.writeHead(500, { 'Content-Type': 'text/plain' });

        logger.error(`Issue communicating with Chrome: "${err.message}"`);
        res.end(`Issue communicating with Chrome`);
      }

      if (res instanceof Socket) {
        logger.warn('代理连接失败', { socketId: _req.headers?.socketId, err });
      }
    });

    server.on(
      'upgrade',
      asyncWsHandler(
        async (req: IncomingMessage, socket: Socket, head: Buffer) => {
          try {
            const socketId = uuidv4();

            socket.on('error', (error) => {
              logger.error(`socket 连接错误 ${error}\n${error.stack}`, {
                socketId,
              });
            });

            // 处理 url 参数、校验用户 token、删除 --user-data-dir 等参数对数据挂载的影响
            req.url = workerService.verifyWsEndpointParams(req.url);

            // 分配一个可用的浏览器入口
            const worker = await workerService.dispatchWorker();

            socket.once('close', (hadError) => {
              logger.log('socket 连接关闭', { socketId, hadError });
              socket.removeAllListeners();
            });

            req.headers.socketId = socketId;

            proxy.ws(req, socket, head, {
              target: `ws://${worker.ip}:${configService.get(
                'WORKER_ENDPOINT_PORT',
                3000,
              )}`,
              changeOrigin: true,
              toProxy: true,
            });

            logger.log('建立 socket 连接', { socketId, workerIp: worker.ip });
          } catch (err) {
            logger.error('连接失败浏览器失败', { stack: err?.stack });
            throw err;
          }
        },
      ),
    );
  });
}
bootstrap();
