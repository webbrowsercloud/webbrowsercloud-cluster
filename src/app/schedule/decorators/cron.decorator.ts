import { applyDecorators, SetMetadata } from '@nestjs/common';

import { SCHEDULE_OPTIONS } from '../schedule.constants';
import { ScheduleType } from '../schedule-type.enum';

export function Cron(cron: string, timezone?: string): MethodDecorator {
  return applyDecorators(
    SetMetadata(SCHEDULE_OPTIONS, {
      type: ScheduleType.CRON,
      cron,
      timezone,
    }),
  );
}
