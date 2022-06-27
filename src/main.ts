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

async function bootstrap() {
  const app = await NestFactory.create(CoreModule);

  await app.listen(process.env.PROT || 3000, async () => {
    const server = app.getHttpServer();

    const workerService = app.get(WorkerService);
    const logger = app.get(Logger);

    // 刷新一下工人列表
    await workerService.refreshWorkerList();

    setInterval(() => workerService.refreshWorkerList(), 3000);

    const proxy = createProxyServer();

    proxy.on('error', (err, _req, res) => {
      if (res instanceof ServerResponse) {
        res.writeHead && res.writeHead(500, { 'Content-Type': 'text/plain' });

        console.log(`Issue communicating with Chrome: "${err.message}"`);
        res.end(`Issue communicating with Chrome`);
      }
    });

    server.on(
      'upgrade',
      asyncWsHandler(
        async (req: IncomingMessage, socket: Socket, head: Buffer) => {
          try {
            // 分配一个可用的浏览器入口
            const worker = await workerService.dispatchWorker();

            if (!worker) {
              throw new Error('browserless busy!');
            }

            const socketId = uuidv4();

            socket.once('close', () => {
              logger.log('socket 连接关闭', { socketId });
              socket.removeAllListeners();
            });

            socket.on('connect', () => {
              logger.log('建立 socket 连接成功', { socketId });
            });

            socket.on('error', (error) => {
              logger.error(`建立 socket 连接失败 ${error}\n${error.stack}`, {
                socketId,
              });
            });

            // 处理 url 参数，删除 --user-data-dir 等参数对数据挂载的影响
            req.url = workerService.verifyWsEndpointParams(req.url);

            proxy.ws(req, socket, head, {
              target: `ws://${worker.ip}:3000`,
              changeOrigin: true,
              toProxy: true,
            });
          } catch (err) {
            logger.error('连接失败浏览器失败', { stack: err?.stack });
          }
        },
      ),
    );
  });
}
bootstrap();
