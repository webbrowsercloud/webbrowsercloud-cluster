import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { K8sClientProvider } from './providers/k8s-client.provider';
import { LoggerModule } from 'nestjs-pino';
import { WorkerController } from '../core/controllers/worker.controller';
import { WorkerService } from '../core/service/worker.service';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import {
  BrowserRunningProvider,
  BrowserQueuedProvider,
  AverageCpuProvider,
  AverageMemoryProvider,
  BrowserConcurrentAvgUtilizationProvider,
  BrowserConcurrentMaxUtilizationProvider,
  BrowserConcurrentMinUtilizationProvider,
} from '../core/providers/browser-worker-metrics.provider';
import { UserDataController } from './controllers/userdata.controller';

const providers = [
  K8sClientProvider,
  BrowserRunningProvider,
  BrowserQueuedProvider,
  AverageCpuProvider,
  AverageMemoryProvider,
  BrowserConcurrentAvgUtilizationProvider,
  BrowserConcurrentMaxUtilizationProvider,
  BrowserConcurrentMinUtilizationProvider,
];

const controllers = [WorkerController, UserDataController];

const services = [WorkerService];

@Module({
  imports: [
    LoggerModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true, expandVariables: true }),
    PrometheusModule.register(),
  ],
  controllers: [...controllers],
  providers: [...providers, ...services],
  exports: [...services],
})
export class CoreModule {}
