import { execFile } from 'node:child_process';
import os from 'node:os';
import { promisify } from 'node:util';

import type { HardwareGpu, HardwareSnapshot } from '../types/index.js';

const execFileAsync = promisify(execFile);

function parseInteger(value: string): number | undefined {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseGpuLine(line: string): HardwareGpu | null {
  const [name, memoryTotal, memoryFree, memoryUsed, driverVersion] = line
    .split(',')
    .map(part => part.trim());

  if (!name) {
    return null;
  }

  return {
    name,
    driverVersion: driverVersion || undefined,
    memoryTotalMiB: memoryTotal ? parseInteger(memoryTotal) : undefined,
    memoryFreeMiB: memoryFree ? parseInteger(memoryFree) : undefined,
    memoryUsedMiB: memoryUsed ? parseInteger(memoryUsed) : undefined,
  };
}

async function readNvidiaGpus(): Promise<HardwareGpu[]> {
  try {
    const { stdout } = await execFileAsync(
      'nvidia-smi',
      [
        '--query-gpu=name,memory.total,memory.free,memory.used,driver_version',
        '--format=csv,noheader,nounits',
      ],
      { timeout: 2000 }
    );

    return stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(parseGpuLine)
      .filter((gpu): gpu is HardwareGpu => gpu !== null);
  } catch {
    return [];
  }
}

export async function readHardwareSnapshot(): Promise<HardwareSnapshot> {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const gpus = await readNvidiaGpus();

  return {
    platform: process.platform,
    arch: process.arch,
    cpuCount: os.cpus().length,
    totalMemory,
    freeMemory,
    availableMemoryRatio: totalMemory > 0 ? freeMemory / totalMemory : 0,
    gpuCount: gpus.length,
    gpus,
  };
}
