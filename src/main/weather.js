// Weather from Open-Meteo (no key). Location: city from settings or IP lookup.
const UA = { 'User-Agent': 'Island-Desktop/0.1' };

async function getJSON(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

module.exports = function createWeather({ settings, emit, notify }) {
  let data = null;
  let timer = null;
  let rainWarnedFor = 0;

  async function locate() {
    const w = settings.data.weather;
    if (w.city) {
      const g = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=ru&name=${encodeURIComponent(w.city)}`);
      const p = g.results?.[0];
      if (p) return { lat: p.latitude, lon: p.longitude, name: p.name };
    }
    if (w.lat != null && w.lon != null) return { lat: w.lat, lon: w.lon, name: w.name || '' };
    const ip = await getJSON('https://ipwho.is/?lang=ru');
    return { lat: ip.latitude, lon: ip.longitude, name: ip.city || '' };
  }

  async function refresh() {
    try {
      const loc = await locate();
      const q = new URLSearchParams({
        latitude: loc.lat, longitude: loc.lon, timezone: 'auto', forecast_days: '7', wind_speed_unit: 'ms',
        current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,uv_index,cloud_cover,visibility',
        hourly: 'temperature_2m,precipitation_probability,precipitation,weather_code,is_day',
        minutely_15: 'precipitation',
        daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max,precipitation_sum',
      });
      const f = await getJSON(`https://api.open-meteo.com/v1/forecast?${q}`);
      data = { place: loc.name, fetched: Date.now(), ...f };
      emit('weather', data);
      checkRain();
    } catch (e) {
      emit('weather-error', e.message);
    }
  }

  // Warn ~before rain starts, using the 15-minute precipitation nowcast.
  function checkRain() {
    if (!settings.data.weather.rainAlerts || !data?.minutely_15) return;
    const { time, precipitation } = data.minutely_15;
    const now = Date.now();
    const nowWet = (data.current?.precipitation || 0) > 0.05;
    if (nowWet) return;
    for (let i = 0; i < time.length; i++) {
      const t = new Date(time[i]).getTime();
      if (t < now) continue;
      if (t - now > 2 * 3600e3) break;
      if (precipitation[i] >= 0.1) {
        if (Math.abs(rainWarnedFor - t) < 3600e3) return;
        rainWarnedFor = t;
        const mins = Math.max(5, Math.round((t - now) / 60000 / 5) * 5);
        notify({ kind: 'rain', title: 'Скоро дождь', body: `Примерно через ${mins} мин — возьми зонт`, icon: '🌧' });
        return;
      }
    }
  }

  return {
    start() { refresh(); clearInterval(timer); timer = setInterval(refresh, 15 * 60e3); },
    refresh,
    get: () => data,
  };
};
