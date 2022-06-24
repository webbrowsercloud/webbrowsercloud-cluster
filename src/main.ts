import { NestFactory } from '@nestjs/core';
import { CoreModule } from './app/core/core.module';
import 'dotenv/config';
import { asyncWsHandler } from './utils/asyncWsHandler';
import { IncomingMessage } from 'http';
import { Socket } from 'net';
import { WorkerService } from './app/core/service/worker.service';
import { createProxyServer } from 'http-proxy';
import { ServerResponse } from 'http';
import { verifyWsEndpointParams } from './utils/verifyWsEndpointParams';

async function bootstrap() {
  const app = await NestFactory.create(CoreModule);

  await app.listen(process.env.PROT || 3000, async () => {
    const server = app.getHttpServer();

    const workerService = app.get(WorkerService);

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
          // 分配一个可用的浏览器入口
          const worker = await workerService.dispatchWorker();

          if (!worker) {
            socket.destroy();
            return 'browserless busy!';
          }

          // 处理 url 参数，删除 --user-data-dir 等参数对数据挂载的影响
          req.url = verifyWsEndpointParams(req.url, process.env?.TOKEN);

          proxy.ws(req, socket, head, {
            target: `ws://${worker.ip}:3000`,
            changeOrigin: true,
            toProxy: true,
          });
        },
      ),
    );
  });
}
bootstrap();
