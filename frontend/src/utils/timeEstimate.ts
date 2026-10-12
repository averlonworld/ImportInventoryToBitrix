/**
 * Utility to calculate estimated processing times for Excel imports.
 *
 * Bitrix24 REST API throughput in this middleware is typically ~4 to 5 records per second
 * under concurrency: 5 and Bitrix's rate-limiting / throttling restrictions.
 */

export function estimateTotalDuration(totalRows: number): string {
  if (!totalRows || totalRows <= 0) return '< 10 seconds';

  // Approximate throughput: ~4.5 rows per second
  const totalSeconds = Math.ceil(totalRows / 4.5);

  if (totalSeconds < 60) {
    return `~${totalSeconds} seconds`;
  }

  const mins = Math.floor(totalSeconds / 60);
  const remainingSecs = totalSeconds % 60;

  if (mins < 2) {
    return remainingSecs > 15 ? '~1 - 2 minutes' : '~1 minute';
  }

  if (mins < 60) {
    const upperMins = Math.ceil(totalRows / 3.5 / 60);
    if (upperMins > mins) {
      return `~${mins} - ${upperMins} minutes`;
    }
    return `~${mins} minutes`;
  }

  const hours = Math.floor(mins / 60);
  const leftoverMins = mins % 60;
  return `~${hours}h ${leftoverMins > 0 ? `${leftoverMins}m` : ''}`;
}

export function estimateRemainingTime(
  totalRows: number,
  processedRows: number,
  startedAt?: string | Date | null
): {
  text: string;
  speedText?: string;
  secondsRemaining: number;
} {
  const remaining = Math.max(0, totalRows - processedRows);

  if (remaining === 0) {
    return { text: 'Finalizing in Bitrix24...', secondsRemaining: 0 };
  }

  let rate = 4.5; // default fallback rate: 4.5 items/second
  let speedText: string | undefined;

  if (startedAt && processedRows >= 5) {
    const elapsedSeconds = Math.max(1, (Date.now() - new Date(startedAt).getTime()) / 1000);
    const measuredRate = processedRows / elapsedSeconds;
    if (measuredRate >= 0.2 && measuredRate <= 25) {
      rate = measuredRate;
      speedText = `~${rate.toFixed(1)} items/sec`;
    }
  }

  const secondsRemaining = Math.ceil(remaining / rate);

  if (secondsRemaining < 5) {
    return { text: 'Almost done...', speedText, secondsRemaining };
  }

  if (secondsRemaining < 60) {
    return { text: `~${secondsRemaining}s remaining`, speedText, secondsRemaining };
  }

  const mins = Math.floor(secondsRemaining / 60);
  const secs = secondsRemaining % 60;

  return {
    text: `~${mins}m ${secs > 0 ? `${secs}s` : ''} remaining`,
    speedText,
    secondsRemaining,
  };
}

export function formatElapsedDuration(startedAt?: string | Date | null, completedAt?: string | Date | null): string {
  if (!startedAt) return '-';
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const seconds = Math.max(0, Math.round((end - start) / 1000));

  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}
