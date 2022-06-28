import { CoreV1Api } from '@kubernetes/client-node';
import { Injectable } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { K8S_CLIENT } from '../providers/k8s-client.provider';
import { Promise } from 'bluebird';
import { meanBy, omit, sumBy, sortBy, floor } from 'lodash';
import axios from 'axios';
import { Logger } from 'nestjs-pino';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Gauge } from 'prom-client';
import { join as pathJoin } from 'path';
import {
  BROWSER_RUNNING,
  BROWSER_QUEUED,
  AVERAGE_CPU,
  AVERAGE_MEMORY,
  BROWSER_CONCURRENT_AVG_UTILIZATION,
  BROWSER_CONCURRENT_MAX_UTILIZATION,
  BROWSER_CONCURRENT_MIN_UTILIZATION,
} from '../providers/browser-worker-metrics.provider';

export type WorkerPressure = {
  ip: string;
  date: number;
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
    @InjectMetric(BROWSER_RUNNING) public browserRunningGauge: Gauge<string>,
    @InjectMetric(BROWSER_QUEUED) public browserQueuedGauge: Gauge<string>,
    @InjectMetric(AVERAGE_CPU) public averageCpuGauge: Gauge<string>,
    @InjectMetric(AVERAGE_MEMORY) public averageMemoryGauge: Gauge<string>,
    @InjectMetric(BROWSER_CONCURRENT_AVG_UTILIZATION)
    public browserConcurrentAvgUtilization: Gauge<string>,
    @InjectMetric(BROWSER_CONCURRENT_MAX_UTILIZATION)
    public browserConcurrentMaxUtilization: Gauge<string>,
    @InjectMetric(BROWSER_CONCURRENT_MIN_UTILIZATION)
    public browserConcurrentMinUtilization: Gauge<string>,
    @Inject(K8S_CLIENT) private readonly coreApiClient: CoreV1Api,
    private readonly configService: ConfigService,
    private readonly logger: Logger,
  ) {
    return this;
  }

  /**
   * 分配一个可用 worker
   * 条件：cpu 利用率小于 80%、内存利用率小于 80%、并发利用率小于 80%
   * @returns
   */
  async dispatchWorker(): Promise<WorkerPressure> {
    const target = sortBy([...this.workers.values()], (item) => {
      return item.running / item.maxConcurrent;
    }).find((item) => {
      return (
        item.memory < 80 &&
        item.cpu < 80 &&
        item.running / item.maxConcurrent < 0.8
      );
    });

    if (target) {
      // 更新本地记录
      this.workers.set(target.ip, { ...target, running: target.running + 1 });

      return target;
    }

    this.logger.warn('Browserless worker busy!');
  }

  // 获取 worker 列表和整体集群状态，
  async getClusterPressure(): Promise<
    Omit<WorkerPressure, 'ip'> & { workerPressures: WorkerPressure[] }
  > {
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

    const result = {
      date: new Date().getTime(),
      running: sumBy(workerPressures, 'running'),
      queued: sumBy(workerPressures, 'queued'),
      recentlyRejected: sumBy(workerPressures, 'recentlyRejected'),
      isAvailable: workerPressures.some((item) => item.isAvailable === true),
      maxConcurrent: sumBy(workerPressures, 'maxConcurrent'),
      maxQueued: sumBy(workerPressures, 'maxQueued'),
      cpu: Math.ceil(
        meanBy(
          workerPressures.filter((item) => item.cpu !== null),
          'cpu',
        ),
      ),
      memory: Math.ceil(meanBy(workerPressures, 'memory')),
      workerPressures,
    };

    this.browserRunningGauge.set(result.running);
    this.browserQueuedGauge.set(result.queued);
    this.averageCpuGauge.set(result.cpu);
    this.averageMemoryGauge.set(result.memory);

    const browserConcurrentUtilizations = workerPressures.map(
      ({ maxConcurrent, running }) => floor((running * 100) / maxConcurrent, 2),
    );

    this.browserConcurrentAvgUtilization.set(
      floor(meanBy(browserConcurrentUtilizations), 2),
    );

    this.browserConcurrentMaxUtilization.set(
      Math.max(...browserConcurrentUtilizations),
    );

    this.browserConcurrentMinUtilization.set(
      Math.min(...browserConcurrentUtilizations),
    );

    return result;
  }

  // 更新工人列表
  async refreshWorkerList(): Promise<void> {
    const response = await this.coreApiClient.listNamespacedPod(
      this.configService.get('KUBE_NAMESPACE', 'default'),
      undefined,
      undefined,
      undefined,
      undefined,
      this.configService.get('WORKER_SELECTOR', 'component=worker'),
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

    // 更新指标
    await this.getClusterPressure();
  }

  // 获取工人运行状态
  async getWorkerPressure(ip: string): Promise<WorkerPressure> {
    const url = new URL(`http://${ip}:3000/pressure`);

    const token = this.configService.get('TOKEN');

    if (token) {
      url.searchParams.set('token', token);
    }

    try {
      return {
        ip,
        ...omit((await axios.get(url.toString())).data.pressure, [
          'reason',
          'message',
        ]),
      } as WorkerPressure;
    } catch (err) {
      this.logger.error('获取 pod 状态失败', { podIp: ip, err });
      throw new Error(err);
    }
  }

  /**
   * 验证处理用户传入的 url 参数，删除用户传入的 token、use-data-dir 等
   * @param querystring
   * @returns 返回处理过的 url
   */
  verifyWsEndpointParams(querystring: string): string {
    const newUrl = new URL(`https://localhost${querystring}`);

    const token = this.configService.get('TOKEN');

    // 处理 token
    if (token) {
      newUrl.searchParams.set('token', token);
    } else {
      // 删除用户自己输入的 token
      newUrl.searchParams.delete('token');
    }

    // 删除用户传入的 --user-data-dir，并校验用户传入的 --user-data-id
    newUrl.searchParams.delete('--user-data-dir');

    const userDataId = newUrl.searchParams.get('--user-data-id');

    if (userDataId) {
      if (!new RegExp(/^[a-z0-9-]+$/).test(userDataId)) {
        throw new Error('无效用户 id ，仅支持 0~9、a~z、中划线组成的字符串');
      }

      newUrl.searchParams.set(
        '--user-data-dir',
        pathJoin(
          `${(this.configService.get('USER_DATA_DIR'), '/userdata')}`,
          userDataId,
        ),
      );
    }

    return newUrl.search;
  }
}
