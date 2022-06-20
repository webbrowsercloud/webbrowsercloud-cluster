import { Controller, Get } from '@nestjs/common';
import { WorkerService } from '../service/worker.service';

@Controller()
export class WorkerController {
  constructor(private readonly workerService: WorkerService) {}

  @Get('pressure')
  async getHello() {
    return await this.workerService.getClusterPressure();
  }
}
