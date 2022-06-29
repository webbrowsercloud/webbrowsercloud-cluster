import { applyDecorators, SetMetadata } from '@nestjs/common';

import { SCHEDULE_OPTIONS } from '../schedule.constants';
import { ScheduleType } from '../schedule-type.enum';

export function Interval(interval: number, timezone?: string): MethodDecorator {
  return applyDecorators(
    SetMetadata(SCHEDULE_OPTIONS, {
      type: ScheduleType.INTERVAL,
      interval,
      timezone,
    }),
  );
}
