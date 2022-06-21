import { CoreV1Api } from '@kubernetes/client-node';
import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { K8S_CLIENT } from '../providers/k8s-client.provider';
import { Promise } from 'bluebird';
import { meanBy, omit, sumBy, minBy, sortBy } from 'lodash';
import axios from 'axios';
import { Logger } from '@nest-boot/common';

export type WorkerPressure = {
  ip: string;
  date: Date;
  isAvailable: boolean;
  queued: number;
  recentlyRejected: number;
  running: number;
  maxConcurrent: number;
  maxQueued: number;
  cpu: number;
  memory: number;
};

@Injectable()
export class WorkerService {
  private workers: Map<string, WorkerPressure> = new Map();

  constructor(
    @Inject(K8S_CLIENT) private readonly coreApiClient: CoreV1Api,
    private readonly configService: ConfigService,
    private readonly logger: Logger,
  ) {
    return this;
  }

  // 分配一个可用 worker
  async dispatchWorker(): Promise<WorkerPressure> {
    const target = sortBy([...this.workers.values()], (item) => {
      return item.running / item.maxConcurrent;
    }).find((item) => item.running / item.maxConcurrent < 0.8);

    if (target) {
      return target;
    }
  }

  // 获取集群状态
  async getClusterPressure() {
    const workerIps = [...this.workers.keys()];

    await Promise.map(
      workerIps,
      async (ip) => {
        try {
          const pressure = await this.getWorkerPressure(ip);

          this.workers.set(ip, pressure);
        } catch (err) {
          this.workers.delete(ip);
        }
      },
      { concurrency: 5 },
    );

    const workerPressures = [...this.workers.values()];

    return {
      date: new Date().getTime(),
      running: sumBy(workerPressures, 'running'),
      queued: sumBy(workerPressures, 'queued'),
      recentlyRejected: sumBy(workerPressures, 'recentlyRejected'),
      isAvailable: workerPressures.some((item) => item.isAvailable === true),
      maxConcurrent: sumBy(workerPressures, 'maxConcurrent'),
      maxQueued: sumBy(workerPressures, 'maxQueued'),
      cpu: Math.ceil(meanBy(workerPressures, 'cpu')),
      memory: Math.ceil(meanBy(workerPressures, 'memory')),
      workerPressures,
    };
  }

  // 更新工人列表
  async refreshWorkerList(): Promise<void> {
    const response = await this.coreApiClient.listNamespacedPod(
      this.configService.get('KUBE_NAMESPACE'),
    );

    const pods = response.body.items.filter(
      (pod) => pod.status.phase === 'Running',
    );

    await Promise.map(
      pods,
      async (pod) => {
        try {
          // 获取当前 pod 运行状况
          const pressure = await this.getWorkerPressure(pod.status.podIP);

          this.workers.set(pod.status.podIP, pressure);
        } catch (err) {
          //
        }
      },
      {
        concurrency: 5,
      },
    );
  }

  // 获取工人运行状态
  async getWorkerPressure(ip: string): Promise<WorkerPressure> {
    try {
      return {
        ip,
        ...omit((await axios.get(`http://${ip}:3000/pressure`)).data.pressure, [
          'reason',
          'message',
        ]),
      } as WorkerPressure;
    } catch (err) {
      this.logger.error('获取 pod 状态失败', { podIp: ip, err });
      throw new Error(err);
    }
  }
}
