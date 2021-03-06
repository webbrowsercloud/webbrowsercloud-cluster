import { makeGaugeProvider } from '@willsoto/nestjs-prometheus';

// 正在运行浏览器运行个数
export const BROWSER_RUNNING = 'browser_running';

// worker 内存占用平均值
export const AVERAGE_MEMORY = 'average_memory';

// worker cpu 占用平均值
export const AVERAGE_CPU = 'average_cpu';

// worker 排队个数
export const BROWSER_QUEUED = 'browser_queued';

// 浏览器并发最小利用率
export const BROWSER_CONCURRENT_MIN_UTILIZATION =
  'browser_concurrent_min_utilization';

// 浏览器并发最大利用率
export const BROWSER_CONCURRENT_MAX_UTILIZATION =
  'browser_concurrent_max_utilization';

// 浏览器并发平均利用率
export const BROWSER_CONCURRENT_AVG_UTILIZATION =
  'browser_concurrent_avg_utilization';

export const BrowserRunningProvider = makeGaugeProvider({
  name: BROWSER_RUNNING,
  help: '正在运行浏览器的个数',
});

export const AverageMemoryProvider = makeGaugeProvider({
  name: AVERAGE_MEMORY,
  help: 'worker 平均占用内存',
});

export const AverageCpuProvider = makeGaugeProvider({
  name: AVERAGE_CPU,
  help: 'worker 平均占用 cpu',
});

export const BrowserQueuedProvider = makeGaugeProvider({
  name: BROWSER_QUEUED,
  help: '正在排队的个数',
});

export const BrowserConcurrentMinUtilizationProvider = makeGaugeProvider({
  name: BROWSER_CONCURRENT_MIN_UTILIZATION,
  help: '浏览器并发最小利用率',
});

export const BrowserConcurrentMaxUtilizationProvider = makeGaugeProvider({
  name: BROWSER_CONCURRENT_MAX_UTILIZATION,
  help: '浏览器并发最大利用率',
});

export const BrowserConcurrentAvgUtilizationProvider = makeGaugeProvider({
  name: BROWSER_CONCURRENT_AVG_UTILIZATION,
  help: '浏览器并发平均利用率',
});
