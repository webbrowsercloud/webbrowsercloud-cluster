import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';

import { ScheduleExplorer } from './schedule.explorer';

@Processor({ name: 'schedule' })
export class ScheduleWorker extends WorkerHost {
  constructor(private readonly scheduleExplorer: ScheduleExplorer) {
    super();
  }

  async process(job: Job) {
    const scheduler = this.scheduleExplorer.schedulerMap.get(job.name);
    await scheduler?.handler();
  }
}
