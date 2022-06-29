import { ScheduleType } from '../schedule-type.enum';

export type ScheduleOptions = CronScheduleOptions | IntervalScheduleOptions;

export interface CronScheduleOptions {
  type: ScheduleType.CRON;
  cron: string;
  timezone?: string;
}

export interface IntervalScheduleOptions {
  type: ScheduleType.INTERVAL;
  interval: number;
  timezone?: string;
}
