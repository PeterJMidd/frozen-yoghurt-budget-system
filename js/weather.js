const WeatherEngine = {
    weatherData: {},
    tempBandIndices: {},

    async fetchHistoricalWeather(states, startDate, endDate, onProgress) {
        const results = {};
        let done = 0;

        for (const state of states) {
            const coords = CONFIG.STATE_COORDS[state];
            if (!coords) continue;

            const url = `${CONFIG.OPEN_METEO_ARCHIVE_URL}?latitude=${coords.lat}&longitude=${coords.lon}` +
                `&start_date=${startDate}&end_date=${endDate}` +
                `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,sunshine_duration` +
                `&timezone=Australia%2FSydney`;

            try {
                const resp = await fetch(url);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                const json = await resp.json();

                const daily = json.daily;
                results[state] = [];
                for (let i = 0; i < daily.time.length; i++) {
                    results[state].push({
                        state,
                        observation_date: daily.time[i],
                        max_temp_c: daily.temperature_2m_max[i],
                        min_temp_c: daily.temperature_2m_min[i],
                        rainfall_mm: daily.precipitation_sum[i],
                        sunshine_hours: daily.sunshine_duration ? daily.sunshine_duration[i] / 3600 : null
                    });
                }
            } catch (err) {
                console.warn(`Weather fetch failed for ${state}:`, err);
                results[state] = [];
            }

            done++;
            if (onProgress) onProgress(done, states.length);
        }

        this.weatherData = results;
        return results;
    },

    getWeatherForDate(state, dateStr) {
        const stateData = this.weatherData[state];
        if (!stateData) return null;
        return stateData.find(w => w.observation_date === dateStr) || null;
    },

    buildTempBandIndices(salesHistory, venueDetails) {
        const venueStateMap = {};
        for (const v of venueDetails) {
            venueStateMap[v.venue_key] = v.state;
        }

        const bandSales = {};
        for (const state of CONFIG.STATES) {
            bandSales[state] = {};
            for (const band of CONFIG.TEMP_BANDS) {
                bandSales[state][band.label] = { totalSales: 0, count: 0 };
            }
        }

        for (const sale of salesHistory) {
            const state = venueStateMap[sale.venue_key];
            if (!state) continue;
            const weather = this.getWeatherForDate(state, sale.sale_date);
            if (!weather || weather.max_temp_c == null) continue;

            const band = this.getTempBand(weather.max_temp_c);
            if (band && bandSales[state][band]) {
                bandSales[state][band].totalSales += sale.gross_sales;
                bandSales[state][band].count++;
            }
        }

        this.tempBandIndices = {};
        for (const state of CONFIG.STATES) {
            let totalSales = 0;
            let totalCount = 0;
            for (const band of CONFIG.TEMP_BANDS) {
                totalSales += bandSales[state][band.label].totalSales;
                totalCount += bandSales[state][band.label].count;
            }
            const avgSales = totalCount > 0 ? totalSales / totalCount : 1;

            this.tempBandIndices[state] = {};
            for (const band of CONFIG.TEMP_BANDS) {
                const bs = bandSales[state][band.label];
                if (bs.count > 0) {
                    this.tempBandIndices[state][band.label] = (bs.totalSales / bs.count) / avgSales;
                } else {
                    this.tempBandIndices[state][band.label] = 1.0;
                }
            }
        }

        return this.tempBandIndices;
    },

    getTempBand(temp) {
        for (const band of CONFIG.TEMP_BANDS) {
            if (temp >= band.min && temp < band.max) return band.label;
        }
        return null;
    },

    getExpectedTempForMonth(state, month) {
        const stateData = this.weatherData[state];
        if (!stateData || stateData.length === 0) return 25;

        const monthTemps = stateData
            .filter(w => {
                const m = parseInt(w.observation_date.substring(5, 7));
                return m === month && w.max_temp_c != null;
            })
            .map(w => w.max_temp_c);

        if (monthTemps.length === 0) return 25;
        return monthTemps.reduce((a, b) => a + b, 0) / monthTemps.length;
    },

    getExpectedWeatherForDate(state, dateStr) {
        const month = parseInt(dateStr.substring(5, 7));
        const stateData = this.weatherData[state] || [];
        const monthRows = stateData.filter(w => parseInt(w.observation_date.substring(5, 7)) === month);
        const avg = (field, fallback = null) => {
            const values = monthRows
                .map(w => w[field])
                .filter(v => v != null && !Number.isNaN(Number(v)))
                .map(Number);
            if (!values.length) return fallback;
            return values.reduce((a, b) => a + b, 0) / values.length;
        };

        return {
            state,
            observation_date: dateStr,
            max_temp_c: avg('max_temp_c', this.getExpectedTempForMonth(state, month)),
            min_temp_c: avg('min_temp_c', null),
            rainfall_mm: avg('rainfall_mm', 0),
            sunshine_hours: avg('sunshine_hours', null),
            projected: true
        };
    },

    getWeatherForForecastDate(state, dateStr) {
        return this.getWeatherForDate(state, dateStr) || this.getExpectedWeatherForDate(state, dateStr);
    },

    buildWeatherMapForState(state, startDate, endDate) {
        const map = {};
        const start = new Date(startDate);
        const end = new Date(endDate);
        const current = new Date(start);

        while (current <= end) {
            const dateStr = current.toISOString().substring(0, 10);
            const weather = this.getWeatherForForecastDate(state, dateStr);
            if (weather) {
                map[dateStr] = {
                    tMax: weather.max_temp_c,
                    tMin: weather.min_temp_c,
                    rain: weather.rainfall_mm,
                    sunshine: weather.sunshine_hours,
                    projected: Boolean(weather.projected)
                };
            }
            current.setDate(current.getDate() + 1);
        }
        return map;
    },

    getWeatherIndex(state, month) {
        const expectedTemp = this.getExpectedTempForMonth(state, month);
        const band = this.getTempBand(expectedTemp);
        if (!band || !this.tempBandIndices[state]) return 1.0;
        return this.tempBandIndices[state][band] || 1.0;
    },

    getWeatherIndexForDate(state, dateStr) {
        const weather = this.getWeatherForForecastDate(state, dateStr);
        const temp = weather?.max_temp_c;
        const band = temp != null ? this.getTempBand(temp) : null;
        if (!band || !this.tempBandIndices[state]) return 1.0;
        return this.tempBandIndices[state][band] || 1.0;
    }
};
