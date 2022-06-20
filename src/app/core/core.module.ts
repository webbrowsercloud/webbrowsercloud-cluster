import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { K8sClientProvider } from './providers/k8s-client.provider';
import { LoggerModule } from '@nest-boot/common';
import { WorkerController } from '../core/controllers/worker.controller';
import { WorkerService } from '../core/service/worker.service';

const providers = [K8sClientProvider];

const controllers = [WorkerController];

const services = [WorkerService];

@Module({
  imports: [
    LoggerModule.register(),
    ConfigModule.forRoot({ isGlobal: true, expandVariables: true }),
  ],
  controllers: [...controllers],
  providers: [...providers, ...services],
  exports: [...services],
})
export class CoreModule {}
