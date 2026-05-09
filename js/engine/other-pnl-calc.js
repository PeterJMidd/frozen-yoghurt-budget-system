const OtherPnlCalcEngine = {
    lineItems: [],

    normaliseKey(text) {
        return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
    },

    accountKey(code, name) {
        return `other_${String(`${code}_${name}`).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').substring(0, 70)}`;
    },

    calculate(forecasts, assumptions, venueDetails, forecastStart, forecastEnd) {
        this.lineItems = [];
        if (!forecasts?.length || !assumptions?.length) {
            for (const f of forecasts || []) f.other_pnl_total = 0;
            return;
        }

        const activeAssumptions = assumptions.filter(row =>
            row.active !== false &&
            String(row.active || 'Y').trim().toUpperCase() !== 'N' &&
            String(row.allocation_scope || '').trim().toLowerCase() !== 'ignore'
        );

        const activeVenueKeys = new Set(forecasts.map(f => f.venue_key));
        const activeVenueCount = Math.max(activeVenueKeys.size, 1);
        const byVenue = new Map();
        const networkRows = [];
        const itemMap = new Map();

        for (const row of activeAssumptions) {
            const accountKey = row.account_key || this.accountKey(row.account_code, row.account_name);
            const prepared = { ...row, account_key: accountKey };
            const label = row.account_name || accountKey;
            if (!itemMap.has(accountKey)) {
                const readableCode = row.account_code
                    ? `${row.account_code}_${String(label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').substring(0, 50)}`
                    : accountKey;
                itemMap.set(accountKey, {
                    key: accountKey,
                    account_code: readableCode,
                    label: row.account_code ? `${row.account_code} - ${label}` : label,
                    type: row.account_type || 'other_pnl',
                    account_category: row.account_category || 'Uncategorised'
                });
            }

            const scope = String(row.allocation_scope || 'venue').trim().toLowerCase();
            if (scope === 'network_even' || !row.venue_key) {
                networkRows.push(prepared);
                continue;
            }
            if (!byVenue.has(row.venue_key)) byVenue.set(row.venue_key, []);
            byVenue.get(row.venue_key).push(prepared);
        }

        this.lineItems = [...itemMap.values()].sort((a, b) => a.label.localeCompare(b.label));
        const budgetDays = this.daysBetween(forecastStart, forecastEnd) + 1;

        for (const f of forecasts) {
            f.other_pnl_total = 0;
            for (const item of this.lineItems) f[item.key] = 0;

            const rows = [
                ...(byVenue.get(f.venue_key) || []),
                ...networkRows.map(row => ({ ...row, network_divisor: activeVenueCount }))
            ];

            for (const row of rows) {
                const amount = this.dailyAmount(row, f, budgetDays) / (row.network_divisor || 1);
                f[row.account_key] = Math.round(((f[row.account_key] || 0) + amount) * 100) / 100;
                f.other_pnl_total = Math.round((f.other_pnl_total + amount) * 100) / 100;
            }
        }
    },

    dailyAmount(row, forecast, budgetDays) {
        const method = String(row.budget_method || 'monthly_amount').trim().toLowerCase();
        const date = forecast.forecast_date;
        const daysInMonth = this.daysInMonth(date);
        let base;

        if (method === 'daily_amount') {
            base = this.adjustedBase(Number(row.base_daily_amount || 0), row, date);
            return base;
        }

        if (method === 'pct_of_sales') {
            base = this.adjustedBase(Number(row.pct_of_sales || 0), row, date);
            return Number(forecast.net_sales || 0) * base;
        }

        if (method === 'annual_amount') {
            base = this.adjustedBase(Number(row.base_monthly_amount || 0) * 12, row, date);
            return budgetDays ? base / budgetDays : 0;
        }

        base = this.adjustedBase(Number(row.base_monthly_amount || 0), row, date);
        return daysInMonth ? base / daysInMonth : 0;
    },

    adjustedBase(base, row, forecastDate) {
        const effectiveDate = row.effective_date;
        if (!effectiveDate || String(forecastDate) < String(effectiveDate)) return base;

        const type = String(row.adjustment_type || '').trim().toLowerCase();
        let value = Number(row.adjustment_value || 0);
        if (!type || isNaN(value)) return base;

        if (type === 'percent' || type === '%' || type === 'pct') {
            if (Math.abs(value) > 1) value = value / 100;
            return base * (1 + value);
        }

        if (type === 'amount' || type === '$') {
            return base + value;
        }

        return base;
    },

    daysInMonth(dateStr) {
        const d = new Date(`${dateStr}T00:00:00`);
        return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    },

    daysBetween(start, end) {
        const a = new Date(`${start}T00:00:00`);
        const b = new Date(`${end}T00:00:00`);
        return Math.max(0, Math.floor((b - a) / (1000 * 60 * 60 * 24)));
    }
};
