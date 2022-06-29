import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { ScheduleController } from './schedule.controller';
import { ScheduleExplorer } from './schedule.explorer';
import { ScheduleWorker } from './schedule.worker';

@Global()
@Module({
  imports: [
    DiscoveryModule,
    BullModule.registerQueue({
      name: 'schedule',
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: true,
      },
    }),
  ],
  controllers: [ScheduleController],
  providers: [ScheduleExplorer, ScheduleWorker],
})
export class ScheduleModule {}
