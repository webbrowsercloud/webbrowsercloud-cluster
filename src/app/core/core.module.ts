import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '../schedule';
import { RedisModule, Redis } from '@nest-boot/redis';
import {
  RefreshWorkerRecordsQueueConsumer,
  REFRESH_WORKER_RECORDS,
} from './queues/refresh-worker-records.queue';
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

const queues = [RefreshWorkerRecordsQueueConsumer];

const services = [WorkerService];

const RedisDynamicModule = RedisModule.registerAsync({
  inject: [ConfigService],
  useFactory: (configService: ConfigService) => ({
    host: configService.get('REDIS_HOST', 'localhost'),
    port: +configService.get('REDIS_PORT', '6379'),
    username: configService.get('REDIS_USERNAME'),
    password: configService.get('REDIS_PASSWORD'),
    db: +configService.get('REDIS_DB', '0'),
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }),
});

@Module({
  imports: [
    LoggerModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true, expandVariables: true }),
    PrometheusModule.register(),
    RedisDynamicModule,
    BullModule.forRootAsync({
      inject: [Redis],
      imports: [RedisDynamicModule],
      useFactory: (redis: Redis) => ({
        connection: redis,
      }),
    }),
    BullModule.registerQueue({
      name: REFRESH_WORKER_RECORDS,
    }),
    ScheduleModule,
  ],
  controllers: [...controllers],
  providers: [...providers, ...services, ...queues],
  exports: [...services, ...queues],
})
export class CoreModule {}
