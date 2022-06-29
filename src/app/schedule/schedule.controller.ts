import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get } from '@nestjs/common';
import { Queue } from 'bullmq';

import { ScheduleType } from './schedule-type.enum';

@Controller('schedules')
export class ScheduleController {
  constructor(@InjectQueue('schedule') private readonly scheduleQueue: Queue) {}

  @Get()
  async findAll() {
    return (await this.scheduleQueue.getRepeatableJobs()).map((item) => {
      const type = /^\d+$/.test(item.cron)
        ? ScheduleType.INTERVAL
        : ScheduleType.CRON;

      return {
        type,
        method: item.name,
        cron: type === ScheduleType.CRON ? item.cron : null,
        interval: type === ScheduleType.INTERVAL ? Number(item.cron) : null,
        nextDate: item.next && new Date(item.next),
        endDate: item.endDate && new Date(item.endDate),
        timezone: item.tz,
      };
    });
  }
}
