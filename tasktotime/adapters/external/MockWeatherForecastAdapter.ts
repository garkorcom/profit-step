/**
 * MockWeatherForecastAdapter — placeholder `WeatherForecastPort`.
 *
 * **MOCK** for PR-A. Returns deterministic fair-weather data (clear skies, no
 * rain, mild temps) for every day in the requested range. Real NOAA
 * integration + `aiCache/{lat_lng_dateRange}` caching is scheduled for PR-B
 * (see `tasktotime/AGENT_PLAN.md` Phase 4).
 *
 * Adapter mapping: spec/04-storage/adapter-mapping.md §23.
 *
 * Validation:
 *   - `fromDate <= toDate` — else `INVALID_INPUT`.
 *   - Range capped at 14 days — else `INVALID_INPUT` with reason
 *     `range_too_long_max_14_days`. Matches NOAA's typical forecast horizon.
 *
 * TODO(PR-B): replace with NOAA API + Firestore aiCache wrapper.
 */

import type {
  WeatherForecastPort,
  WeatherForecastInput,
  WeatherDay,
} from '../../ports/infra/WeatherForecastPort';
import { AdapterError } from '../errors';
import { type AdapterLogger, noopLogger } from '../firestore/_shared';

const MAX_RANGE_DAYS = 14;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class MockWeatherForecastAdapter implements WeatherForecastPort {
  constructor(private readonly logger: AdapterLogger = noopLogger) {}

  async forecast(input: WeatherForecastInput): Promise<WeatherDay[]> {
    if (!ISO_DATE.test(input.fromDate) || !ISO_DATE.test(input.toDate)) {
      throw new AdapterError(
        'INVALID_INPUT',
        `Dates must be ISO YYYY-MM-DD: from=${input.fromDate}, to=${input.toDate}`,
        { op: 'WeatherForecast.forecast', input },
      );
    }
    const fromMs = parseIsoDateUtc(input.fromDate);
    const toMs = parseIsoDateUtc(input.toDate);
    if (fromMs > toMs) {
      throw new AdapterError(
        'INVALID_INPUT',
        `fromDate (${input.fromDate}) must be <= toDate (${input.toDate})`,
        { op: 'WeatherForecast.forecast', input },
      );
    }
    const dayCount = Math.floor((toMs - fromMs) / 86_400_000) + 1;
    if (dayCount > MAX_RANGE_DAYS) {
      throw new AdapterError(
        'INVALID_INPUT',
        `range_too_long_max_14_days (got ${dayCount})`,
        { op: 'WeatherForecast.forecast', input, dayCount },
      );
    }

    this.logger.debug?.('MockWeatherForecastAdapter.forecast', {
      lat: input.lat,
      lng: input.lng,
      dayCount,
    });

    const out: WeatherDay[] = [];
    for (let i = 0; i < dayCount; i++) {
      out.push(buildClearDay(fromMs + i * 86_400_000));
    }
    return out;
  }
}

function parseIsoDateUtc(iso: string): number {
  return Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  );
}

function buildClearDay(epochMs: number): WeatherDay {
  return {
    date: new Date(epochMs).toISOString().slice(0, 10),
    precipitationMm: 0,
    precipitationProbability: 0,
    windKmh: 5,
    tempMinC: 18,
    tempMaxC: 28,
    conditions: 'clear',
  };
}
