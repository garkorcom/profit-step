/**
 * WeatherForecastPort — NOAA-backed weather forecast lookup.
 *
 * Used by daily cron to flag outdoor tasks at risk of weather delays.
 */

export interface WeatherDay {
  /** YYYY-MM-DD */
  date: string;
  precipitationMm: number;
  /** 0..1 probability. */
  precipitationProbability: number;
  windKmh: number;
  tempMinC: number;
  tempMaxC: number;
  conditions:
    | 'clear'
    | 'rain'
    | 'storm'
    | 'snow'
    | 'extreme_heat'
    | 'unknown';
}

export interface WeatherForecastInput {
  lat: number;
  lng: number;
  fromDate: string;
  toDate: string;
}

export interface WeatherForecastPort {
  forecast(input: WeatherForecastInput): Promise<WeatherDay[]>;
}
