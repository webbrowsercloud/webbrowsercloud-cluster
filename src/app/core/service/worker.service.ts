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
import { Interval } from '../../schedule';
import ms from 'ms';
import { Redis } from '@nest-boot/redis';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { REFRESH_WORKER_RECORDS } from '../queues/refresh-worker-records.queue';
import {
  AuthorizedError,
  EmptyWorkerError,
  GatewayBusyError,
} from '../../../utils/asyncWsHandler';

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
  private readonly WORKERS_REDIS_KEY: string;

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
    private redis: Redis,
    @InjectQueue(REFRESH_WORKER_RECORDS)
    private refreshWorkerRecordsQueue: Queue,
  ) {
    this.WORKERS_REDIS_KEY = 'workers';

    this.redis.defineCommand('addWorkerRunningCount', {
      lua: `
        local json = redis.call('hget', '${this.WORKERS_REDIS_KEY}', KEYS[1])
        local obj = cjson.decode(json)
        obj.running = obj.running + 1
        redis.call('hset', '${this.WORKERS_REDIS_KEY}', KEYS[1], cjson.encode(obj))
        return 'ok'
      `,
      numberOfKeys: 1,
    });

    return this;
  }

  /**
   * ??? redis ????????? worker ??????
   * @returns
   */
  async getWorkerRecords(): Promise<WorkerPressure[]> {
    try {
      const workers = await this.redis.hvals(this.WORKERS_REDIS_KEY);

      const result = [];

      workers.forEach((item) => {
        const worker = JSON.parse(item);

        // ????????????????????????????????? redis ?????????????????????????????? pod???????????????
        if (worker?.namespace === this.configService.get('KUBE_NAMESPACE')) {
          result.push(omit(worker, 'namespace'));
        }
      });

      return result;
    } catch (err) {
      this.logger.error('??? redis ?????? worker ????????????');

      throw err;
    }
  }

  /**
   * ??? redis ??????????????? worker ??????
   * @param workerPressure
   */
  async addWorkerRecord(workerPressure: WorkerPressure): Promise<void> {
    try {
      // ????????? hset ??????????????????????????????
      await Promise.all([
        this.redis.hmset(this.WORKERS_REDIS_KEY, {
          [`${workerPressure.ip}`]: JSON.stringify({
            ...workerPressure,
            namespace: this.configService.get('KUBE_NAMESPACE'),
          }),
        }),

        // ?????? 6 ?????????
        this.redis.expire(this.WORKERS_REDIS_KEY, 6),
      ]);
    } catch (err) {
      this.logger.error('?????? worker ????????????', { ip: workerPressure.ip, err });
      throw err;
    }
  }

  /**
   * ??? redis ???????????? worker ??????
   * @param workerIp
   */
  async removeWorkerRecord(workerIp: string): Promise<void> {
    try {
      await this.redis.hdel(this.WORKERS_REDIS_KEY, workerIp);

      this.logger.log('?????? worker ????????????', { ip: workerIp });
    } catch (err) {
      this.logger.error('?????? worker ????????????', { ip: workerIp });
    }
  }

  /**
   * ?????????????????? worker
   * @returns
   */
  async dispatchWorker(): Promise<WorkerPressure> {
    const workers = await this.getWorkerRecords();

    if (workers.length === 0) {
      this.logger.error('empty workers');
      throw new EmptyWorkerError('empty workers');
    }

    // ???????????????????????????????????????????????????
    const target = sortBy(workers, (item) => {
      return (
        (item.running + item.queued) / (item.maxConcurrent + item.maxQueued)
      );
    }).find((item) => item.isAvailable);

    if (target) {
      // ?????? redis ??? worker ??????
      try {
        await (
          this.redis as Redis & {
            addWorkerRunningCount: (workerIp: string) => Promise<string>;
          }
        ).addWorkerRunningCount(target.ip);
      } catch (err) {
        this.logger.error('?????? worker ????????????', err);
      }

      return target;
    }

    this.logger.warn('browser busy');
    throw new GatewayBusyError('browser busy!');
  }

  /**
   * ?????? redis ????????????????????????
   * @param podIps
   */
  async refreshRedisWorkerRecord(podIps: string[]): Promise<void> {
    const workers = await this.getWorkerRecords();

    await Promise.map(
      workers,
      async ({ ip }) => {
        try {
          // ???????????? podIp????????? redis ???????????? podIps ???????????? worker ??????
          if (podIps && !podIps.includes(ip)) {
            await this.removeWorkerRecord(ip);

            return;
          }

          const pressure = await this.getWorkerPressure(ip);

          await this.addWorkerRecord(pressure);
        } catch (err) {
          await this.removeWorkerRecord(ip);
        }
      },
      { concurrency: 10 },
    );
  }

  /**
   * ?????? worker ???????????????????????????
   * @returns
   */
  async getClusterPressure(): Promise<
    Omit<WorkerPressure, 'ip'> & { workerPressures: WorkerPressure[] }
  > {
    const workerPressures = await this.getWorkerRecords();

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

  // ?????????????????????????????????????????????
  @Interval(ms('3s'))
  async createRefreshWorkerListTask() {
    try {
      await this.refreshWorkerRecordsQueue.add(
        REFRESH_WORKER_RECORDS,
        {},
        {
          jobId: REFRESH_WORKER_RECORDS,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (err) {
      this.logger.error('???????????????????????????????????????', { err });
    }
  }

  // ??????????????????
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

    const podIps = await Promise.map(
      pods,
      async (pod) => {
        try {
          // ???????????? pod ????????????
          const pressure = await this.getWorkerPressure(pod.status.podIP);

          await this.addWorkerRecord(pressure);

          return pod.status.podIP;
        } catch (err) {
          //
        }
      },
      {
        concurrency: 5,
      },
    );

    // ????????????????????????
    await this.refreshRedisWorkerRecord(podIps);
  }

  // ????????????????????????
  async getWorkerPressure(ip: string): Promise<WorkerPressure> {
    const url = new URL(
      `http://${ip}:${this.configService.get(
        'WORKER_ENDPOINT_PORT',
        3000,
      )}/pressure`,
    );

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
      this.logger.error('?????? pod ????????????', { podIp: ip, err });
      throw err;
    }
  }

  /**
   * ??????????????????????????? url ?????????????????????????????? token???use-data-dir ???
   * @param querystring
   * @returns ?????????????????? url
   */
  verifyWsEndpointParams(querystring: string): string {
    const newUrl = new URL(`https://localhost${querystring}`);

    const presetToken = this.configService.get('TOKEN');

    const inputToken = newUrl.searchParams.get('token');

    if (presetToken) {
      // ????????????????????? token ??????????????????????????? token
      if (inputToken !== String(presetToken)) {
        console.log(inputToken, presetToken);
        throw new AuthorizedError('?????? apiToken');
      }
    }

    // ????????????????????? --user-data-dir??????????????????????????? --user-data-id
    newUrl.searchParams.delete('--user-data-dir');

    const userDataId = newUrl.searchParams.get('--user-data-id');

    if (userDataId) {
      if (!new RegExp(/^[a-z0-9-]+$/).test(userDataId)) {
        throw new Error('???????????? id ???????????? 0~9???a~z??????????????????????????????');
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
