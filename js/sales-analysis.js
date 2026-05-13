const SalesAnalysisEngine = {
    FY26_START: '2025-07-01',
    FY26_END: '2026-06-30',

    formatMonth(dateStr) {
        return String(dateStr || '').substring(0, 7);
    },

    formatDate(date) {
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0')
        ].join('-');
    },

    addYears(dateStr, years) {
        const d = new Date(`${dateStr}T00:00:00`);
        const targetMonth = d.getMonth();
        d.setFullYear(d.getFullYear() + years);
        // setFullYear rolls Feb 29 -> Mar 1. Detect overflow and clamp back to last day of target month.
        if (d.getMonth() !== targetMonth) {
            d.setDate(0); // last day of previous (== target) month
        }
        return this.formatDate(d);
    },

    addDays(dateStr, days) {
        const d = new Date(`${dateStr}T00:00:00`);
        d.setDate(d.getDate() + days);
        return this.formatDate(d);
    },

    monthStarts(start, end) {
        const months = [];
        const current = new Date(`${start}T00:00:00`);
        current.setDate(1);
        const last = new Date(`${end}T00:00:00`);
        last.setDate(1);
        while (current <= last) {
            months.push(this.formatDate(current));
            current.setMonth(current.getMonth() + 1);
        }
        return months;
    },

    dateRange(start, end) {
        const dates = [];
        const current = new Date(`${start}T00:00:00`);
        const last = new Date(`${end}T00:00:00`);
        while (current <= last) {
            dates.push(this.formatDate(current));
            current.setDate(current.getDate() + 1);
        }
        return dates;
    },

    getContext() {
        const venueDetails = ExcelParser.uploads.venue_details?.venues || [];
        const salesHistory = ExcelParser.uploads.sales_history?.records || [];
        const historyEnd = ExcelParser.uploads.sales_history?.dateRange?.end || this.FY26_END;
        const clusters = this.buildVenueClusters(venueDetails, salesHistory);
        return { venueDetails, salesHistory, historyEnd, clusters };
    },

    storeCohort(venue) {
        const openingDate = String(venue.opening_date || '');
        if (venue.is_new_venue || (openingDate >= '2026-07-01' && openingDate <= '2027-06-30')) {
            return 'new_fy27';
        }
        if (openingDate >= '2025-07-01' && openingDate <= '2026-06-30') {
            return 'new_fy26';
        }
        return 'same_store';
    },

    isVenueOpenOn(venue, dateStr) {
        return !venue.opening_date || String(venue.opening_date) <= String(dateStr);
    },

    buildVenueClusters(venues, salesHistory) {
        const latestDate = salesHistory.reduce((max, row) =>
            !max || row.sale_date > max ? row.sale_date : max, null);
        const latest = latestDate ? new Date(`${latestDate}T00:00:00`) : new Date();
        const byVenue = {};

        for (const row of salesHistory) {
            const d = new Date(`${row.sale_date}T00:00:00`);
            const diff = (latest - d) / (1000 * 60 * 60 * 24);
            if (diff < 0 || diff > 90 || Number(row.gross_sales || 0) <= 0) continue;
            if (!byVenue[row.venue_key]) byVenue[row.venue_key] = { sales: 0, days: 0 };
            byVenue[row.venue_key].sales += Number(row.gross_sales || 0);
            byVenue[row.venue_key].days++;
        }

        const averages = Object.values(byVenue)
            .filter(v => v.days > 0)
            .map(v => v.sales / v.days)
            .sort((a, b) => a - b);
        const q = (pct) => averages.length
            ? averages[Math.min(averages.length - 1, Math.floor((averages.length - 1) * pct))]
            : 0;
        const q25 = q(0.25);
        const q75 = q(0.75);

        const clusters = {};
        const now = new Date();
        for (const venue of venues) {
            const avg = byVenue[venue.venue_key]?.days
                ? byVenue[venue.venue_key].sales / byVenue[venue.venue_key].days
                : 0;
            const openDate = new Date(`${venue.opening_date}T00:00:00`);
            const monthsOpen = Math.max(0,
                (now.getFullYear() - openDate.getFullYear()) * 12 + (now.getMonth() - openDate.getMonth())
            );
            let tier = 'Core Sales';
            if (venue.is_new_venue || monthsOpen < CONFIG.RAMP_UP_MONTHS) tier = 'Ramping/New';
            else if (avg >= q75) tier = 'High Sales';
            else if (avg <= q25) tier = 'Lower Sales';
            clusters[venue.venue_key] = `${venue.state} - ${tier}`;
        }
        return clusters;
    },

    getFilterOptions() {
        const { venueDetails, clusters } = this.getContext();
        return {
            states: [...new Set(venueDetails.map(v => v.state).filter(Boolean))].sort(),
            clusters: [...new Set(Object.values(clusters))].sort(),
            venues: venueDetails.slice().sort((a, b) => a.venue_name.localeCompare(b.venue_name))
        };
    },

    selectedVenues(filters = {}) {
        const { venueDetails, clusters } = this.getContext();
        return venueDetails.filter(v => {
            if (filters.state && filters.state !== '__all__' && v.state !== filters.state) return false;
            if (filters.cluster && filters.cluster !== '__all__' && clusters[v.venue_key] !== filters.cluster) return false;
            if (filters.cohort && filters.cohort !== '__all__' && this.storeCohort(v) !== filters.cohort) return false;
            if (filters.venue && filters.venue !== '__all__' && v.venue_key !== filters.venue) return false;
            return true;
        });
    },

    salesHistoryMap() {
        // Parser now emits one record per (venue, date) with combined gross_sales
        // (servings + retail), so a simple assign works without losing streams.
        const map = {};
        for (const row of ExcelParser.uploads.sales_history?.records || []) {
            if (!map[row.venue_key]) map[row.venue_key] = {};
            map[row.venue_key][row.sale_date] = Number(row.gross_sales || 0);
        }
        return map;
    },

    getComparatorSales(venue, dateStr, salesMap, historyEnd) {
        if (!this.isVenueOpenOn(venue, dateStr)) {
            return { amount: 0, source: 'closed' };
        }

        const actual = salesMap[venue.venue_key]?.[dateStr];
        if (actual != null && dateStr <= historyEnd) {
            return { amount: actual, source: 'actual' };
        }

        if (dateStr <= historyEnd) {
            return { amount: 0, source: 'no_actual' };
        }

        if (dateStr > this.FY26_END) return { amount: 0, source: 'none' };

        const apiValue = SalesForecastEngine.apiForecasts[venue.venue_key]?.[dateStr];
        if (apiValue != null) return { amount: Math.max(0, Number(apiValue || 0)), source: 'api' };

        return { amount: this.estimateLocalSales(venue, dateStr), source: 'local' };
    },

    estimateLocalSales(venue, dateStr) {
        const d = new Date(`${dateStr}T00:00:00`);
        const dow = (d.getDay() + 6) % 7;
        const month = d.getMonth();
        const seasonality = SalesForecastEngine.seasonalityIndices[venue.venue_key];
        const baseDaily = SalesForecastEngine.baseDailySales[venue.venue_key] || SalesForecastEngine.getNetworkAvgDaily();
        let holidayAdj = 1.0;
        if (seasonality) {
            if (CALENDARS.isPublicHoliday(dateStr, venue.state)) holidayAdj = seasonality.publicHoliday || 1.0;
            else if (CALENDARS.isSchoolHoliday(dateStr, venue.state)) holidayAdj = seasonality.schoolHoliday || 1.0;
        }
        const sales = baseDaily *
            (seasonality?.dow?.[dow] || 1.0) *
            (seasonality?.month?.[month] || 1.0) *
            holidayAdj *
            WeatherEngine.getWeatherIndexForDate(venue.state, dateStr);
        return Math.max(0, Math.round(sales * 100) / 100);
    },

    groupLabel(venue, groupBy, monthLabel, clusters) {
        if (groupBy === 'state') return venue.state || 'Unknown State';
        if (groupBy === 'cluster') return clusters[venue.venue_key] || 'Unclustered';
        if (groupBy === 'venue') return venue.venue_name;
        return monthLabel;
    },

    isLflVenueForComparatorMonth(venue, comparatorMonthStart) {
        const openDate = new Date(`${venue.opening_date}T00:00:00`);
        const compMonth = new Date(`${comparatorMonthStart}T00:00:00`);
        return openDate <= compMonth;
    },

    buildMonthlyRows(filters = {}, groupBy = 'month', growthPct = 0) {
        const { historyEnd, clusters } = this.getContext();
        const venues = this.selectedVenues(filters);
        const venueSet = new Set(venues.map(v => v.venue_key));
        const venueMap = Object.fromEntries(venues.map(v => [v.venue_key, v]));
        const salesMap = this.salesHistoryMap();
        const months = this.monthStarts(CONFIG.BUDGET_YEAR_START, CONFIG.BUDGET_YEAR_END);
        const growthMultiplier = 1 + (Number(growthPct || 0) / 100);
        const rowMap = {};

        const ensure = (month, group) => {
            const key = `${month}|${group}`;
            if (!rowMap[key]) {
                rowMap[key] = {
                    month,
                    group,
                    fy26_actual_sales: 0,
                    fy26_completion_forecast: 0,
                    fy26_total_sales: 0,
                    fy27_forecast_sales: 0,
                    fy27_scenario_sales: 0,
                    lfl_fy26_sales: 0,
                    lfl_fy27_sales: 0,
                    lfl_scenario_sales: 0,
                    venue_count: 0,
                    lfl_venue_count: 0
                };
            }
            return rowMap[key];
        };

        for (const budgetMonth of months) {
            const comparatorMonth = this.addYears(budgetMonth, -1);
            // End-of-month for the comparator = (comparatorMonth + 1 month) - 1 day. Use Date math, not string ops.
            const comparatorEndDate = new Date(`${comparatorMonth}T00:00:00`);
            comparatorEndDate.setMonth(comparatorEndDate.getMonth() + 1);
            comparatorEndDate.setDate(0);
            const comparatorEnd = this.formatDate(comparatorEndDate);
            const budgetMonthKey = this.formatMonth(budgetMonth);
            const comparatorMonthKey = this.formatMonth(comparatorMonth);
            const monthLabel = budgetMonthKey;
            const activeGroups = new Set();

            for (const venue of venues) {
                const group = this.groupLabel(venue, groupBy, monthLabel, clusters);
                activeGroups.add(group);
                const row = ensure(budgetMonthKey, group);
                const lflEligible = this.isLflVenueForComparatorMonth(venue, comparatorMonth);

                for (const compDate of this.dateRange(comparatorMonth, comparatorEnd)) {
                    if (this.formatMonth(compDate) !== comparatorMonthKey) continue;
                    const comp = this.getComparatorSales(venue, compDate, salesMap, historyEnd);
                    if (comp.source === 'actual') row.fy26_actual_sales += comp.amount;
                    if (comp.source === 'api' || comp.source === 'local') row.fy26_completion_forecast += comp.amount;
                    row.fy26_total_sales += comp.amount;
                    if (lflEligible) row.lfl_fy26_sales += comp.amount;
                }
            }

            for (const forecast of PnlBuilder.dailyResults) {
                if (!venueSet.has(forecast.venue_key) || this.formatMonth(forecast.forecast_date) !== budgetMonthKey) continue;
                const venue = venueMap[forecast.venue_key];
                const group = this.groupLabel(venue, groupBy, monthLabel, clusters);
                const row = ensure(budgetMonthKey, group);
                const amount = Number(forecast.net_sales || 0);
                row.fy27_forecast_sales += amount;
                row.fy27_scenario_sales += amount * growthMultiplier;
                if (this.isLflVenueForComparatorMonth(venue, this.addYears(budgetMonth, -1))) {
                    row.lfl_fy27_sales += amount;
                    row.lfl_scenario_sales += amount * growthMultiplier;
                }
            }

            for (const group of activeGroups) {
                const row = ensure(budgetMonthKey, group);
                const groupVenues = venues.filter(v => this.groupLabel(v, groupBy, monthLabel, clusters) === group);
                row.venue_count = groupVenues.length;
                row.lfl_venue_count = groupVenues.filter(v => this.isLflVenueForComparatorMonth(v, comparatorMonth)).length;
            }
        }

        return Object.values(rowMap)
            .map(row => ({
                ...row,
                total_growth_pct: row.fy26_total_sales ? ((row.fy27_forecast_sales - row.fy26_total_sales) / row.fy26_total_sales) * 100 : null,
                scenario_growth_pct: row.fy26_total_sales ? ((row.fy27_scenario_sales - row.fy26_total_sales) / row.fy26_total_sales) * 100 : null,
                lfl_growth_pct: row.lfl_fy26_sales ? ((row.lfl_fy27_sales - row.lfl_fy26_sales) / row.lfl_fy26_sales) * 100 : null,
                lfl_scenario_growth_pct: row.lfl_fy26_sales ? ((row.lfl_scenario_sales - row.lfl_fy26_sales) / row.lfl_fy26_sales) * 100 : null
            }))
            .sort((a, b) => a.month.localeCompare(b.month) || a.group.localeCompare(b.group));
    },

    buildCompletionRows(filters = {}, groupBy = 'month') {
        const { historyEnd, clusters } = this.getContext();
        const venues = this.selectedVenues(filters);
        const salesMap = this.salesHistoryMap();
        const start = this.addDays(historyEnd, 1);
        if (start > this.FY26_END) return [];
        const rowMap = {};

        const ensure = (date, group) => {
            const key = `${date}|${group}`;
            if (!rowMap[key]) {
                rowMap[key] = { date, group, forecast_sales: 0, source_api_sales: 0, source_local_sales: 0 };
            }
            return rowMap[key];
        };

        for (const date of this.dateRange(start, this.FY26_END)) {
            const monthLabel = this.formatMonth(date);
            for (const venue of venues) {
                const group = this.groupLabel(venue, groupBy, monthLabel, clusters);
                const comp = this.getComparatorSales(venue, date, salesMap, historyEnd);
                const row = ensure(date, group);
                row.forecast_sales += comp.amount;
                if (comp.source === 'api') row.source_api_sales += comp.amount;
                if (comp.source === 'local') row.source_local_sales += comp.amount;
            }
        }

        return Object.values(rowMap).sort((a, b) => a.date.localeCompare(b.date) || a.group.localeCompare(b.group));
    },

    summarise(rows) {
        return rows.reduce((sum, row) => {
            sum.fy26 += row.fy26_total_sales;
            sum.fy26Completion += row.fy26_completion_forecast;
            sum.fy27 += row.fy27_forecast_sales;
            sum.scenario += row.fy27_scenario_sales;
            sum.lflFy26 += row.lfl_fy26_sales;
            sum.lflFy27 += row.lfl_fy27_sales;
            sum.lflScenario += row.lfl_scenario_sales;
            return sum;
        }, { fy26: 0, fy26Completion: 0, fy27: 0, scenario: 0, lflFy26: 0, lflFy27: 0, lflScenario: 0 });
    }
};

if (typeof window !== 'undefined') {
    window.SalesAnalysisEngine = SalesAnalysisEngine;
}
