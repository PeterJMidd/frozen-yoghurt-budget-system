const SalesForecastEngine = {
    seasonalityIndices: {},
    baseDailySales: {},
    dailyForecasts: [],
    apiForecasts: {},
    apiBands: {},        // { venueKey: { date: { lower, upper } } }
    apiDiagnostics: {},  // { venueKey: { model, rmse, cv, warnings, historyDays } }
    salesHistoryLookup: {},
    useApi: false,
    apiCallStats: { batches: 0, retries: 0, failures: 0, lastError: null, totalMs: 0 },

    buildSeasonality(salesHistory, venueDetails) {
        const venueMap = {};
        for (const v of venueDetails) venueMap[v.venue_key] = v;

        const grouped = {};
        for (const s of salesHistory) {
            if (!grouped[s.venue_key]) grouped[s.venue_key] = [];
            grouped[s.venue_key].push(s);
        }

        this.seasonalityIndices = {};
        this.baseDailySales = {};
        this.salesHistoryLookup = {};

        for (const [venueKey, sales] of Object.entries(grouped)) {
            const venue = venueMap[venueKey];
            if (!venue) continue;

            const matureSales = this.getLikeForLikeSales(sales, venue);
            const modellingSales = matureSales.length >= 90
                ? matureSales
                : sales.filter(s => Number(s.gross_sales || 0) > 0);
            if (!modellingSales.length) continue;

            const avgDaily = modellingSales.reduce((sum, s) => sum + s.gross_sales, 0) / modellingSales.length;
            this.baseDailySales[venueKey] = avgDaily;

            const dowBuckets = Array.from({ length: 7 }, () => ({ total: 0, count: 0 }));
            const monthBuckets = Array.from({ length: 12 }, () => ({ total: 0, count: 0 }));
            const holidayBucket = { total: 0, count: 0 };
            const schoolBucket = { total: 0, count: 0 };
            const normalBucket = { total: 0, count: 0 };

            if (!this.salesHistoryLookup[venueKey]) this.salesHistoryLookup[venueKey] = {};
            for (const s of sales) {
                this.salesHistoryLookup[venueKey][s.sale_date] = s.gross_sales;
            }

            for (const s of modellingSales) {
                const amount = Number(s.gross_sales || 0);
                if (amount <= 0) continue;

                const d = new Date(s.sale_date);
                const dow = (d.getDay() + 6) % 7;

                dowBuckets[dow].total += amount;
                dowBuckets[dow].count++;
            }

            const dowIndices = dowBuckets.map(b =>
                b.count > 0 ? (b.total / b.count) / avgDaily : 1.0
            );

            for (const s of modellingSales) {
                const amount = Number(s.gross_sales || 0);
                if (amount <= 0) continue;

                const d = new Date(s.sale_date);
                const dow = (d.getDay() + 6) % 7;
                const month = d.getMonth();
                const dowAdjustedSales = amount / (dowIndices[dow] || 1.0);
                const weatherIndex = WeatherEngine.getWeatherIndexForDate(venue.state, s.sale_date) || 1.0;
                const adjustedSales = dowAdjustedSales / weatherIndex;

                if (CALENDARS.isPublicHoliday(s.sale_date, venue.state)) {
                    holidayBucket.total += adjustedSales;
                    holidayBucket.count++;
                } else if (CALENDARS.isSchoolHoliday(s.sale_date, venue.state)) {
                    schoolBucket.total += adjustedSales;
                    schoolBucket.count++;
                } else {
                    normalBucket.total += adjustedSales;
                    normalBucket.count++;
                    monthBuckets[month].total += adjustedSales;
                    monthBuckets[month].count++;
                }
            }

            const normalAvg = normalBucket.count > 0 ? normalBucket.total / normalBucket.count : avgDaily;

            const monthIndices = monthBuckets.map(b =>
                b.count >= 7 ? (b.total / b.count) / normalAvg : 1.0
            );
            this.normaliseIndices(monthIndices);

            const holidayIndex = holidayBucket.count > 0 ? (holidayBucket.total / holidayBucket.count) / normalAvg : 1.15;
            const schoolIndex = schoolBucket.count > 0 ? (schoolBucket.total / schoolBucket.count) / normalAvg : 1.10;

            this.seasonalityIndices[venueKey] = {
                dow: dowIndices,
                month: monthIndices,
                publicHoliday: Math.max(0.5, Math.min(1.8, holidayIndex)),
                schoolHoliday: Math.max(0.5, Math.min(1.8, schoolIndex)),
                historyDays: modellingSales.length,
                likeForLikeDays: matureSales.length
            };
        }
    },

    getLikeForLikeSales(sales, venue) {
        const sorted = (sales || [])
            .filter(s => Number(s.gross_sales || 0) > 0)
            .sort((a, b) => a.sale_date.localeCompare(b.sale_date));
        if (!sorted.length) return [];

        const historyEnd = new Date(sorted[sorted.length - 1].sale_date);
        const historyStart = new Date(historyEnd);
        historyStart.setMonth(historyStart.getMonth() - 24);

        const openingDate = new Date(venue.opening_date || '1900-01-01');
        const matureDate = new Date(openingDate);
        matureDate.setDate(matureDate.getDate() + 365);

        return sorted.filter(s => {
            const d = new Date(s.sale_date);
            return d >= historyStart && d >= matureDate;
        });
    },

    normaliseIndices(indices) {
        const valid = indices.filter(v => Number.isFinite(v) && v > 0);
        const avg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 1;
        for (let i = 0; i < indices.length; i++) {
            const value = Number.isFinite(indices[i]) && indices[i] > 0 ? indices[i] : avg;
            indices[i] = Math.round((value / avg) * 10000) / 10000;
        }
        return indices;
    },

    // Call your existing venu-cast-api /forecast-multi endpoint
    async fetchApiForecasts(salesHistory, venueDetails, forecastDays, onProgress) {
        const apiUrl = CONFIG.FORECAST_API_URL;
        if (!apiUrl) {
            console.warn('No forecast API URL configured — using local seasonality model');
            this.useApi = false;
            return;
        }

        const grouped = {};
        for (const s of salesHistory) {
            if (!grouped[s.venue_key]) grouped[s.venue_key] = [];
            grouped[s.venue_key].push(s);
        }

        const venueNames = Object.keys(grouped);
        const batches = [];
        for (let i = 0; i < venueNames.length; i += CONFIG.FORECAST_BATCH_SIZE) {
            batches.push(venueNames.slice(i, i + CONFIG.FORECAST_BATCH_SIZE));
        }

        this.apiForecasts = {};
        this.apiBands = {};
        this.apiDiagnostics = {};
        this.apiCallStats = { batches: 0, retries: 0, failures: 0, lastError: null, totalMs: 0 };
        let done = 0;

        for (const batch of batches) {
            const venues = [];
            for (const venueKey of batch) {
                const sales = grouped[venueKey]
                    .filter(s => Number(s.gross_sales || 0) > 0)
                    .sort((a, b) => a.sale_date.localeCompare(b.sale_date));
                if (!sales.length) continue;
                const venue = venueDetails.find(v => v.venue_key === venueKey);
                const historyStart = sales[0]?.sale_date;
                const historyEnd = sales[sales.length - 1]?.sale_date;
                const daysToBudgetEnd = historyEnd
                    ? this.daysBetween(historyEnd, CONFIG.BUDGET_YEAR_END)
                    : forecastDays;
                const venueForecastDays = Math.max(forecastDays, daysToBudgetEnd);
                const apiForecastEnd = this.addDays(historyEnd, venueForecastDays);
                const holidayDates = venue
                    ? CALENDARS.getHolidayDatesForState(venue.state, historyStart, apiForecastEnd)
                    : [];
                const hasWeather = venue && (WeatherEngine.weatherData[venue.state] || []).length > 0;
                const weatherMap = hasWeather && historyStart
                    ? WeatherEngine.buildWeatherMapForState(venue.state, historyStart, apiForecastEnd)
                    : {};
                venues.push({
                    name: venueKey,
                    state: venue?.state || null,
                    dates: sales.map(s => s.sale_date),
                    values: sales.map(s => s.gross_sales),
                    forecast_days: venueForecastDays,
                    holiday_dates: holidayDates,
                    weather_map: weatherMap
                });
            }
            if (!venues.length) continue;

            const result = await this.callForecastApiWithRetry(apiUrl, venues);
            if (result) {
                const forecastsByVenue = result.venues || result;
                for (const [venueKey, forecast] of Object.entries(forecastsByVenue)) {
                    const forecastValues = forecast.forecast_values || forecast.forecast;
                    if (forecast.forecast_dates && forecastValues) {
                        this.apiForecasts[venueKey] = {};
                        this.apiBands[venueKey] = {};
                        for (let i = 0; i < forecast.forecast_dates.length; i++) {
                            const date = forecast.forecast_dates[i];
                            this.apiForecasts[venueKey][date] = forecastValues[i];
                            const lo = forecast.lower_90?.[i];
                            const hi = forecast.upper_90?.[i];
                            if (lo != null && hi != null) {
                                this.apiBands[venueKey][date] = { lower: lo, upper: hi };
                            }
                        }
                        this.apiDiagnostics[venueKey] = {
                            model: forecast.model || null,
                            rmse: forecast.rmse != null ? Number(forecast.rmse) : null,
                            cv: forecast.cv != null ? Number(forecast.cv) : null,
                            warnings: Array.isArray(forecast.warnings) ? forecast.warnings : [],
                            historyDays: (grouped[venueKey] || []).filter(s => Number(s.gross_sales || 0) > 0).length
                        };
                    }
                }
            }

            done += batch.length;
            if (onProgress) onProgress(done, venueNames.length);
        }

        this.useApi = Object.keys(this.apiForecasts).length > 0;
    },

    async callForecastApiWithRetry(apiUrl, venues) {
        const maxRetries = Number(CONFIG.FORECAST_API_RETRIES ?? 1);
        const timeoutMs = Number(CONFIG.FORECAST_API_TIMEOUT_MS ?? 90000);
        let attempt = 0;
        let lastErr = null;

        while (attempt <= maxRetries) {
            const start = Date.now();
            this.apiCallStats.batches++;
            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeoutMs);
                const resp = await fetch(`${apiUrl}/forecast-multi`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ venues }),
                    signal: controller.signal
                });
                clearTimeout(timer);
                if (!resp.ok) throw new Error(`API returned ${resp.status}`);
                const json = await resp.json();
                this.apiCallStats.totalMs += Date.now() - start;
                return json;
            } catch (err) {
                this.apiCallStats.totalMs += Date.now() - start;
                lastErr = err;
                if (attempt < maxRetries) {
                    this.apiCallStats.retries++;
                    console.warn(`API batch failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying:`, err);
                } else {
                    this.apiCallStats.failures++;
                    this.apiCallStats.lastError = err?.message || String(err);
                    console.warn('API batch forecast failed (giving up after retries):', err);
                }
                attempt++;
            }
        }
        return null;
    },

    addDays(dateStr, days) {
        const date = new Date(dateStr);
        date.setDate(date.getDate() + days);
        return date.toISOString().substring(0, 10);
    },

    daysBetween(startDate, endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        return Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
    },

    getRampUpMultiplier(venue, dateStr, rampUpData) {
        const openDate = new Date(venue.opening_date);
        const forecastDate = new Date(dateStr);

        if (forecastDate < openDate) return 0;

        const monthsOpen = (forecastDate.getFullYear() - openDate.getFullYear()) * 12 +
            (forecastDate.getMonth() - openDate.getMonth());

        if (monthsOpen >= CONFIG.RAMP_UP_MONTHS) return 1.0;

        const venueRamp = rampUpData[venue.venue_key];
        if (venueRamp && monthsOpen < venueRamp.length) {
            return venueRamp[monthsOpen];
        }

        return Math.min(1.0, 0.4 + (monthsOpen * 0.6 / CONFIG.RAMP_UP_MONTHS));
    },

    generateForecasts(venueDetails, avgTicketData, rampUpData, forecastStart, forecastEnd, monthlyGrowthData = {}, newVenueAssumptions = {}, cogsDiscountByVenue = {}) {
        this.dailyForecasts = [];

        const venueMap = {};
        for (const v of venueDetails) venueMap[v.venue_key] = v;

        const ticketMap = {};
        for (const t of avgTicketData) {
            const key = `${t.venue_key}_${t.budget_month}`;
            ticketMap[key] = t.avg_ticket;
        }

        const start = new Date(forecastStart);
        const end = new Date(forecastEnd);

        for (const venue of venueDetails) {
            if (!venue.is_active) continue;
            const openingDate = new Date(venue.opening_date);

            const newVenue = newVenueAssumptions[venue.venue_key];
            const similarVenueKey = venue.similar_venue_key || newVenue?.similar_venue_key;
            const seasonality = this.seasonalityIndices[venue.venue_key] ||
                (similarVenueKey ? this.seasonalityIndices[similarVenueKey] : null);
            const baseDaily = this.baseDailySales[venue.venue_key] || 0;
            const apiData = this.apiForecasts[venue.venue_key];

            if (baseDaily === 0 && new Date(venue.opening_date) > end) continue;

            const current = new Date(start);
            while (current <= end) {
                const dateStr = current.toISOString().substring(0, 10);
                const dow = (current.getDay() + 6) % 7;
                const month = current.getMonth();
                const monthNum = current.getMonth() + 1;
                const monthKey = `${current.getFullYear()}-${String(monthNum).padStart(2, '0')}-01`;
                const publicHolidayName = CALENDARS.getPublicHolidayName(dateStr, venue.state);
                const priorComparableDate = CALENDARS.getPriorYearComparableDate(dateStr, venue.state);

                if (current < openingDate) {
                    current.setDate(current.getDate() + 1);
                    continue;
                }

                const rampUp = this.getRampUpMultiplier(venue, dateStr, rampUpData);
                const growthMultiplier = this.getGrowthMultiplier(
                    venue, dateStr, forecastStart, monthlyGrowthData, newVenueAssumptions
                );

                let forecastSales;

                if (rampUp === 0) {
                    forecastSales = 0;
                } else if (this.useApi && apiData && apiData[dateStr] != null) {
                    forecastSales = apiData[dateStr] * rampUp;
                } else {
                    // Fallback: local seasonality model
                    let dowIndex = 1.0;
                    let monthIndex = 1.0;
                    let holidayAdj = 1.0;

                    if (seasonality) {
                        dowIndex = seasonality.dow[dow] || 1.0;
                        monthIndex = seasonality.month[month] || 1.0;

                        if (CALENDARS.isPublicHoliday(dateStr, venue.state)) {
                            holidayAdj = seasonality.publicHoliday;
                        } else if (CALENDARS.isSchoolHoliday(dateStr, venue.state)) {
                            holidayAdj = seasonality.schoolHoliday;
                        }
                    }

                    const weatherIndex = WeatherEngine.getWeatherIndexForDate(venue.state, dateStr);

                    if (baseDaily > 0) {
                        forecastSales = baseDaily * dowIndex * monthIndex * holidayAdj * weatherIndex * rampUp;
                    } else if (newVenue?.avg_monthly_sales > 0 || venue.avg_monthly_sales > 0) {
                        const monthlyBase = newVenue?.avg_monthly_sales || venue.avg_monthly_sales;
                        const daysInMonth = new Date(current.getFullYear(), current.getMonth() + 1, 0).getDate();
                        forecastSales = (monthlyBase / daysInMonth) * dowIndex * monthIndex * holidayAdj * weatherIndex * rampUp;
                    } else {
                        const networkAvg = this.getNetworkAvgDaily();
                        forecastSales = networkAvg * dowIndex * monthIndex * holidayAdj * weatherIndex * rampUp;
                    }
                }

                forecastSales *= growthMultiplier;
                forecastSales = Math.max(0, Math.round(forecastSales * 100) / 100);

                // Treat the API/local forecast value as NET sales (POS revenue, post-discount).
                // Gross-up to compute gross_sales when a discount % is configured for the venue.
                const discountPct = Number(cogsDiscountByVenue[venue.venue_key]
                    ?? (similarVenueKey ? cogsDiscountByVenue[similarVenueKey] : 0)
                    ?? 0);
                const netSales = forecastSales;
                const grossSales = discountPct > 0 && discountPct < 1
                    ? Math.round((netSales / (1 - discountPct)) * 100) / 100
                    : netSales;

                const ticketKey = `${venue.venue_key}_${monthKey}`;
                const avgTicket = ticketMap[ticketKey] || this.getDefaultTicket(venue.venue_key, avgTicketData);
                const transactions = avgTicket > 0 ? Math.round(netSales / avgTicket) : 0;

                const apiBand = this.apiBands[venue.venue_key]?.[dateStr] || null;

                this.dailyForecasts.push({
                    venue_key: venue.venue_key,
                    venue_name: venue.venue_name,
                    state: venue.state,
                    forecast_date: dateStr,
                    public_holiday_name: publicHolidayName,
                    prior_year_comparable_date: priorComparableDate,
                    prior_comparable_sales: this.getPriorComparableSales(venue, priorComparableDate, similarVenueKey),
                    gross_sales: grossSales,
                    net_sales: netSales,
                    forecast_lower_90: apiBand ? Math.max(0, Math.round(apiBand.lower * 100) / 100) : null,
                    forecast_upper_90: apiBand ? Math.max(0, Math.round(apiBand.upper * 100) / 100) : null,
                    forecast_transactions: transactions,
                    avg_ticket: avgTicket,
                    ramp_up_multiplier: rampUp,
                    growth_multiplier: growthMultiplier,
                    similar_venue_key: similarVenueKey || null,
                    source: (this.useApi && apiData && apiData[dateStr] != null) ? 'api' : 'local'
                });

                current.setDate(current.getDate() + 1);
            }
        }

        return this.dailyForecasts;
    },

    getPriorComparableSales(venue, comparableDate, similarVenueKey) {
        const direct = this.salesHistoryLookup[venue.venue_key]?.[comparableDate];
        if (direct != null) return direct;

        if (similarVenueKey) {
            const similar = this.salesHistoryLookup[similarVenueKey]?.[comparableDate];
            if (similar != null) return similar;
        }

        return null;
    },

    getGrowthMultiplier(venue, dateStr, forecastStart, monthlyGrowthData, newVenueAssumptions) {
        const growth = monthlyGrowthData[venue.venue_key];
        if (!growth || growth.length === 0) return 1.0;

        const forecastDate = new Date(dateStr);
        const startDate = (newVenueAssumptions[venue.venue_key] || venue.is_new_venue)
            ? new Date(venue.opening_date)
            : new Date(forecastStart);

        if (forecastDate < startDate) return 1.0;

        const monthsElapsed = (forecastDate.getFullYear() - startDate.getFullYear()) * 12 +
            (forecastDate.getMonth() - startDate.getMonth());
        const cappedMonth = Math.min(monthsElapsed, growth.length - 1);
        const multiplier = 1 + (growth[cappedMonth] || 0);
        return Math.round(multiplier * 10000) / 10000;
    },

    getNetworkAvgDaily() {
        const values = Object.values(this.baseDailySales).filter(v => v > 0);
        if (values.length === 0) return 2000;
        return values.reduce((a, b) => a + b, 0) / values.length;
    },

    getDefaultTicket(venueKey, avgTicketData) {
        const venueTickets = avgTicketData.filter(t => t.venue_key === venueKey);
        if (venueTickets.length > 0) {
            return venueTickets.reduce((sum, t) => sum + t.avg_ticket, 0) / venueTickets.length;
        }
        return 12.50;
    },

    getSeasonalityData(venueKey) {
        if (venueKey === '__all__') {
            const allDow = Array(7).fill(0);
            const allMonth = Array(12).fill(0);
            let count = 0;
            for (const s of Object.values(this.seasonalityIndices)) {
                if ((s.likeForLikeDays || 0) < 90) continue;
                for (let i = 0; i < 7; i++) allDow[i] += s.dow[i];
                for (let i = 0; i < 12; i++) allMonth[i] += s.month[i];
                count++;
            }
            if (count > 0) {
                return {
                    dow: allDow.map(v => v / count),
                    month: allMonth.map(v => v / count)
                };
            }
        }
        return this.seasonalityIndices[venueKey] || { dow: Array(7).fill(1), month: Array(12).fill(1) };
    },

    getDiagnosticsTable() {
        return Object.entries(this.apiDiagnostics || {}).map(([venueKey, d]) => {
            const baseDaily = this.baseDailySales[venueKey] || 0;
            const rmsePct = d.rmse != null && baseDaily > 0 ? d.rmse / baseDaily : null;
            return {
                venue_key: venueKey,
                model: d.model,
                history_days: d.historyDays || 0,
                rmse: d.rmse,
                cv: d.cv,
                rmse_pct_of_avg: rmsePct,
                warnings: d.warnings || [],
                base_daily_sales: baseDaily,
                low_confidence: (rmsePct != null && rmsePct > 0.25)
                    || (d.cv != null && d.cv > 0.30)
                    || (d.warnings || []).length > 0
            };
        }).sort((a, b) => a.venue_key.localeCompare(b.venue_key));
    },

    getMonthlySalesForecasts(venueKey) {
        const forecasts = venueKey === '__all__'
            ? this.dailyForecasts
            : this.dailyForecasts.filter(f => f.venue_key === venueKey);

        const monthly = {};
        for (const f of forecasts) {
            const monthKey = f.forecast_date.substring(0, 7);
            if (!monthly[monthKey]) {
                monthly[monthKey] = {
                    sales: 0,
                    transactions: 0,
                    days: 0,
                    prior_comparable_sales: 0,
                    public_holidays: 0
                };
            }
            monthly[monthKey].sales += f.net_sales;
            monthly[monthKey].transactions += f.forecast_transactions;
            monthly[monthKey].days++;
            monthly[monthKey].prior_comparable_sales += f.prior_comparable_sales || 0;
            if (f.public_holiday_name) monthly[monthKey].public_holidays++;
        }

        return Object.entries(monthly)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, data]) => ({ month, ...data }));
    }
};
