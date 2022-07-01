import { Processor, WorkerHost } from '@nestjs/bullmq';
import { forwardRef, Inject } from '@nestjs/common';
import { WorkerService } from '../service/worker.service';

export const REFRESH_WORKER_RECORDS = 'refresh-worker-records';

@Processor(REFRESH_WORKER_RECORDS, {
  limiter: {
    max: 1,
    duration: 3000,
  },
})
export class RefreshWorkerRecordsQueueConsumer extends WorkerHost {
  constructor(
    @Inject(forwardRef(() => WorkerService))
    private readonly workerService: WorkerService,
  ) {
    super();
  }
  async process() {
    await this.workerService.refreshWorkerList();
  }
}
