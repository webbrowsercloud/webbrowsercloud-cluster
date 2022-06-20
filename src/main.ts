import { NestFactory } from '@nestjs/core';
import { CoreModule } from './app/core/core.module';
import 'dotenv/config';
import { asyncWsHandler } from './utils/asyncWsHandler';
import { IncomingMessage } from 'http';
import { Socket } from 'net';

async function bootstrap() {
  const app = await NestFactory.create(CoreModule);

  await app.listen(process.env.PROT || 3000, () => {
    const server = app.getHttpServer();

    server.on(
      'upgrade',
      asyncWsHandler(
        async (req: IncomingMessage, socket: Socket, head: Buffer) => {
          // 分配一个可用的浏览器入口
          console.log('upgrade----------------');
        },
      ),
    );
  });
}
bootstrap();
