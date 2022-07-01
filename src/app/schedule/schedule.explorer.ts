import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper';
import { Queue } from 'bullmq';

import { ScheduleOptions } from './interfaces/schedule-options.interface';
import { SCHEDULE_OPTIONS } from './schedule.constants';
import { ScheduleType } from './schedule-type.enum';

@Injectable()
export class ScheduleExplorer implements OnModuleInit {
  // eslint-disable-next-line @typescript-eslint/ban-types
  readonly schedulerMap = new Map<
    string,
    // eslint-disable-next-line @typescript-eslint/ban-types
    { name: string; cron: string; timezone: string; handler: Function }
  >();

  private readonly logger = new Logger(ScheduleExplorer.name);

  constructor(
    @InjectQueue('schedule')
    private queue: Queue,
    private readonly discoveryService: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly reflector: Reflector,
  ) {}

  async onModuleInit() {
    await this.explore();
  }

  async explore() {
    const instanceWrappers: InstanceWrapper[] = [
      ...this.discoveryService.getControllers(),
      ...this.discoveryService.getProviders(),
    ];

    await Promise.all(
      instanceWrappers.map((wrapper: InstanceWrapper) =>
        (async () => {
          const { instance } = wrapper;
          if (!instance || !Object.getPrototypeOf(instance)) {
            return;
          }

          this.metadataScanner.scanFromPrototype(
            instance,
            Object.getPrototypeOf(instance),
            async (key: string) =>
              wrapper.isDependencyTreeStatic()
                ? await this.lookupSchedulers(wrapper, key)
                : this.warnForNonStaticProviders(wrapper, key),
          );
        })(),
      ),
    );

    const schedulers = [...this.schedulerMap.values()];

    await Promise.all(
      (await this.queue.getRepeatableJobs())
        .filter(
          (job) =>
            !schedulers.find(
              ({ name, cron, timezone }) =>
                job.name === name &&
                job.cron === cron &&
                job.tz === (timezone || null),
            ),
        )
        .map((job) =>
          this.queue.removeRepeatable(
            job.name,
            { cron: job.cron, tz: job.tz },
            job.id,
          ),
        ),
    );
  }

  // eslint-disable-next-line @typescript-eslint/ban-types
  async lookupSchedulers(wrapper: InstanceWrapper, key: string) {
    const methodRef = wrapper.instance[key];

    const scheduleOptions: ScheduleOptions = this.reflector.get(
      SCHEDULE_OPTIONS,
      methodRef,
    );

    if (scheduleOptions?.type) {
      const name = `${wrapper.name}@${methodRef.name}`;

      switch (scheduleOptions?.type) {
        case ScheduleType.CRON: {
          this.schedulerMap.set(name, {
            name,
            cron: scheduleOptions.cron,
            timezone: scheduleOptions.timezone,
            handler: this.wrapFunctionInTryCatchBlocks(
              methodRef,
              wrapper.instance,
            ),
          });

          await this.queue.add(
            name,
            {},
            {
              repeat: {
                cron: scheduleOptions.cron,
                tz: scheduleOptions.timezone,
              },
            },
          );
          break;
        }
        case ScheduleType.INTERVAL: {
          this.schedulerMap.set(name, {
            name,
            cron: `${scheduleOptions.interval}`,
            timezone: scheduleOptions.timezone,
            handler: this.wrapFunctionInTryCatchBlocks(
              methodRef,
              wrapper.instance,
            ),
          });

          await this.queue.add(
            name,
            {},
            {
              repeat: {
                every: scheduleOptions.interval,
                tz: scheduleOptions.timezone,
              },
            },
          );
          break;
        }
        default:
      }
    }
  }

  warnForNonStaticProviders(wrapper: InstanceWrapper<unknown>, key: string) {
    const methodRef = wrapper.instance[key];

    const scheduleOptions: ScheduleOptions = this.reflector.get(
      SCHEDULE_OPTIONS,
      methodRef,
    );

    switch (scheduleOptions?.type) {
      case ScheduleType.CRON: {
        this.logger.warn(
          `Cannot register cron job "${wrapper.name}@${key}" because it is defined in a non static provider.`,
        );
        break;
      }
      case ScheduleType.INTERVAL: {
        this.logger.warn(
          `Cannot register interval "${wrapper.name}@${key}" because it is defined in a non static provider.`,
        );

        break;
      }
      default:
    }
  }

  // eslint-disable-next-line @typescript-eslint/ban-types
  private wrapFunctionInTryCatchBlocks(methodRef: Function, instance: object) {
    return async (...args: unknown[]) => {
      try {
        await methodRef.call(instance, ...args);
      } catch (error) {
        this.logger.error(error);
      }
    };
  }
}
