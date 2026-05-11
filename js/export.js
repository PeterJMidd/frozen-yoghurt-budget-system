const ExportEngine = {
    signedAmount(item, value) {
        const amount = Math.round((Number(value || 0)) * 100) / 100;
        const key = String(item.key || '').toLowerCase();
        const type = String(item.type || '').toLowerCase();

        // Revenue and revenue-side subtotals: positive
        if (
            key === 'gross_sales' || key === 'net_sales' ||
            key === 'gross_profit' || key === 'venue_contribution'
        ) return amount;

        // Discount: contra-revenue (shown negative on the P&L between gross and net)
        if (key === 'cogs_discounts' || type === 'discount') return -Math.abs(amount);

        // Other P&L total is now stored as a SIGNED contribution (income +ve, expense -ve).
        // Display: just return as-is rather than always negating (the previous bug).
        if (key === 'other_pnl_total') return amount;

        // Revenue / income types
        if (type === 'other_income' || type.includes('revenue') || type.includes('income')) {
            return Math.abs(amount);
        }
        // Cost types: render negative
        if (
            type.includes('cogs') ||
            type.includes('labour') ||
            type.includes('occupancy') ||
            type.includes('expense') ||
            type === 'other_pnl' ||
            type === 'subtotal'
        ) {
            return -Math.abs(amount);
        }
        return amount;
    },

    downloadXlsx(data, headers, filename) {
        const ws = XLSX.utils.json_to_sheet(data, { header: headers });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Data');
        XLSX.writeFile(wb, filename);
    },

    exportDailyForecast() {
        this.downloadXlsx(
            this.getDailyAccountLines(),
            [
                'venue', 'state', 'date', 'account_code', 'account_name', 'account_type', 'account_category',
                'amount', 'transactions', 'avg_ticket', 'ramp_up_multiplier',
                'growth_multiplier', 'public_holiday_name', 'prior_year_comparable_date',
                'prior_comparable_sales', 'labour_day_type', 'crew_hourly_rate',
                'source', 'similar_venue_key'
            ],
            'daily_forecast_account_lines.xlsx'
        );
    },

    exportMonthlySummary() {
        this.downloadXlsx(
            this.getMonthlyAccountLines(),
            [
                'venue', 'state', 'budget_month', 'account_code', 'account_name',
                'account_type', 'account_category', 'amount', 'transactions', 'trading_days'
            ],
            'monthly_summary_account_lines.xlsx'
        );
    },

    exportPnl() {
        this.downloadXlsx(
            this.getMonthlyAccountLines(),
            [
                'venue', 'state', 'budget_month', 'account_code', 'account_name',
                'account_type', 'account_category', 'amount', 'transactions', 'trading_days'
            ],
            'budget_pnl_account_lines.xlsx'
        );
    },

    buildPnlSheet(venueKey) {
        const pnl = PnlBuilder.getPnlTable(venueKey, 'monthly');
        const rows = [];
        const headers = ['Line Item', ...pnl.months.map(m => m.label), 'Total'];
        rows.push(headers);

        for (const row of pnl.rows) {
            const r = [row.label];
            for (const month of pnl.months) {
                r.push(Math.round(row.values[month.key] || 0));
            }
            r.push(Math.round(row.total));
            rows.push(r);
        }
        return rows;
    },

    exportVariance() {
        const variance = PnlBuilder.getVarianceTable('__all__');
        const data = variance.map(v => {
            const budget = this.signedAmount(v, v.budget);
            const prior = this.signedAmount(v, v.prior);
            return {
                account_category: v.account_category || 'Uncategorised',
                account_name: v.label,
                budget: Math.round(budget),
                prior_year_annualised: Math.round(prior),
                variance: Math.round(budget - prior),
                variance_pct: prior ? Math.round(((budget - prior) / Math.abs(prior)) * 1000) / 10 : 0
            };
        });
        this.downloadXlsx(data, null, 'variance_account_lines.xlsx');
    },

    getDailyAccountLines() {
        const rows = [];
        const lineItems = PnlBuilder.getPnlLineItems();
        for (const f of PnlBuilder.dailyResults) {
            for (const item of lineItems) {
                rows.push({
                    venue: f.venue_name,
                    state: f.state,
                    date: f.forecast_date,
                    account_code: item.account_code || item.key,
                    account_name: item.label,
                    account_type: item.type,
                    account_category: item.account_category || 'Uncategorised',
                    amount: this.signedAmount(item, f[item.key]),
                    transactions: item.key === 'net_sales' ? f.forecast_transactions : null,
                    avg_ticket: item.key === 'net_sales' ? f.avg_ticket : null,
                    ramp_up_multiplier: f.ramp_up_multiplier,
                    growth_multiplier: f.growth_multiplier || 1,
                    public_holiday_name: f.public_holiday_name || null,
                    prior_year_comparable_date: f.prior_year_comparable_date || null,
                    prior_comparable_sales: item.key === 'net_sales' ? (f.prior_comparable_sales || null) : null,
                    labour_day_type: item.type === 'labour' || item.key === 'labour_total' ? f.labour_day_type : null,
                    crew_hourly_rate: item.key === 'crew_labour_cost' ? f.crew_hourly_rate : null,
                    source: f.source,
                    similar_venue_key: f.similar_venue_key || null
                });
            }
        }
        return rows;
    },

    getMonthlyAccountLines() {
        const rows = [];
        const lineItems = PnlBuilder.getPnlLineItems();
        for (const m of PnlBuilder.monthlySummary) {
            for (const item of lineItems) {
                rows.push({
                    venue: m.venue_name,
                    state: m.state,
                    budget_month: m.budget_month,
                    account_code: item.account_code || item.key,
                    account_name: item.label,
                    account_type: item.type,
                    account_category: item.account_category || 'Uncategorised',
                    amount: this.signedAmount(item, m[item.key]),
                    transactions: item.key === 'net_sales' ? m.transaction_count : null,
                    trading_days: item.key === 'net_sales' ? m.trading_days : null
                });
            }
        }
        return rows;
    },

    getDailyAccountDbRows(venueIdMap) {
        const rows = [];
        const lineItems = PnlBuilder.getPnlLineItems();
        for (const f of PnlBuilder.dailyResults) {
            const venueId = venueIdMap[f.venue_key];
            if (!venueId) continue;
            for (const item of lineItems) {
                rows.push({
                    venue_id: venueId,
                    forecast_date: f.forecast_date,
                    account_code: item.account_code || item.key,
                    account_name: item.label,
                    account_type: item.type,
                    account_category: item.account_category || 'Uncategorised',
                    amount: this.signedAmount(item, f[item.key]),
                    forecast_transactions: item.key === 'net_sales' ? f.forecast_transactions : null,
                    avg_ticket: item.key === 'net_sales' ? f.avg_ticket : null,
                    ramp_up_multiplier: f.ramp_up_multiplier,
                    growth_multiplier: f.growth_multiplier || 1,
                    public_holiday_name: f.public_holiday_name || null,
                    prior_year_comparable_date: f.prior_year_comparable_date || null,
                    prior_comparable_sales: item.key === 'net_sales' ? (f.prior_comparable_sales || null) : null,
                    labour_day_type: item.type === 'labour' || item.key === 'labour_total' ? f.labour_day_type : null,
                    crew_hourly_rate: item.key === 'crew_labour_cost' ? f.crew_hourly_rate : null,
                    source: f.source,
                    similar_venue_key: f.similar_venue_key || null
                });
            }
        }
        return rows;
    },

    getMonthlyAccountDbRows(venueIdMap) {
        const rows = [];
        const lineItems = PnlBuilder.getPnlLineItems();
        for (const m of PnlBuilder.monthlySummary) {
            const venueId = venueIdMap[m.venue_key];
            if (!venueId) continue;
            for (const item of lineItems) {
                rows.push({
                    venue_id: venueId,
                    budget_month: m.budget_month,
                    account_code: item.account_code || item.key,
                    account_name: item.label,
                    account_type: item.type,
                    account_category: item.account_category || 'Uncategorised',
                    amount: this.signedAmount(item, m[item.key]),
                    transaction_count: item.key === 'net_sales' ? m.transaction_count : null,
                    trading_days: item.key === 'net_sales' ? m.trading_days : null
                });
            }
        }
        return rows;
    },

    dedupeBy(rows, keyFn) {
        const map = new Map();
        for (const row of rows) {
            const key = keyFn(row);
            if (!key.includes('undefined') && !key.includes('null')) {
                map.set(key, row);
            }
        }
        return [...map.values()];
    },

    generateTemplates() {
        const wb = XLSX.utils.book_new();

        const salesHeaders = [['venue_name']];
        const start = new Date(CONFIG.BUDGET_YEAR_START);
        start.setFullYear(start.getFullYear() - 2);
        const end = new Date(CONFIG.BUDGET_YEAR_START);
        end.setDate(end.getDate() - 1);
        const current = new Date(start);
        while (current <= end) {
            salesHeaders[0].push(current.toISOString().substring(0, 10));
            current.setDate(current.getDate() + 1);
        }
        salesHeaders.push(['Venue 1']);
        const wsSales = XLSX.utils.aoa_to_sheet(salesHeaders);
        XLSX.utils.book_append_sheet(wb, wsSales, 'Daily Sales');

        const wsPnl = XLSX.utils.aoa_to_sheet([
            ['Line Item', 'Jul-25', 'Aug-25', 'Sep-25', 'Oct-25', 'Nov-25', 'Dec-25', 'Jan-26', 'Feb-26', 'Mar-26', 'Apr-26', 'May-26', 'Jun-26', 'Total'],
            ['Net Sales'], ['COGS - Food'], ['COGS - Packaging'], ['COGS - Retail'], ['COGS - Discounts'],
            ['Total COGS'], ['Gross Profit'], ['Labour - Crew'], ['Labour - Crew Oncosts'],
            ['Labour - Management'], ['Labour - Mgmt Oncosts'], ['Total Labour'],
            ['Occupancy - Base Rent'], ['Occupancy - Outgoings'], ['Occupancy - % Rent'],
            ['Occupancy - Marketing Levy'], ['Total Occupancy'], ['Venue Contribution']
        ]);
        XLSX.utils.book_append_sheet(wb, wsPnl, 'Venue 1');

        const wsVenues = XLSX.utils.aoa_to_sheet([
            ['venue_name', 'state', 'opening_date', 'is_active'],
            ['Venue 1', 'NSW', '2020-01-15', 'Y']
        ]);
        XLSX.utils.book_append_sheet(wb, wsVenues, 'Venues');

        const rampHeaders = ['venue_name'];
        for (let i = 1; i <= 18; i++) rampHeaders.push(`month_${i}`);
        const wsRamp = XLSX.utils.aoa_to_sheet([
            rampHeaders,
            ['Venue 1', 0.40, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.78, 0.82, 0.85, 0.88, 0.90, 0.92, 0.94, 0.96, 0.97, 0.98, 1.00]
        ]);
        XLSX.utils.book_append_sheet(wb, wsRamp, 'Ramp Up');

        const budgetStart = new Date(CONFIG.BUDGET_YEAR_START);
        const ticketHeaders = ['venue_name'];
        for (let i = 0; i < 12; i++) {
            const d = new Date(budgetStart);
            d.setMonth(d.getMonth() + i);
            ticketHeaders.push(d.toISOString().substring(0, 10));
        }
        const wsTicket = XLSX.utils.aoa_to_sheet([ticketHeaders, ['Venue 1']]);
        XLSX.utils.book_append_sheet(wb, wsTicket, 'Avg Ticket');

        const wsLabour = XLSX.utils.aoa_to_sheet([
            [
                'venue_name', 'Sales Per Labour Hour', 'Avg Hourly Rate', 'Oncosts %',
                'Mgmt Salary Monthly', 'Mgmt Oncosts %', 'Award Enabled',
                'Award Employment Type', 'Award Level', 'Average Age',
                'Award Weekday Rate', 'Award Saturday Rate', 'Award Sunday Rate',
                'Award Public Holiday Rate'
            ],
            ['Venue 1', 120, 33.19, 12, 6500, 12, 'Y', 'casual', 1, 21, 33.19, 39.83, 39.83, 66.38]
        ]);
        XLSX.utils.book_append_sheet(wb, wsLabour, 'Labour');

        const wsCogs = XLSX.utils.aoa_to_sheet([
            ['venue_name', 'Food %', 'Packaging %', 'Retail %', 'Discount %'],
            ['Venue 1', 25, 3, 2, 5]
        ]);
        XLSX.utils.book_append_sheet(wb, wsCogs, 'COGS');

        const wsRent = XLSX.utils.aoa_to_sheet([
            ['venue_name', 'Base Rent Monthly', 'Outgoings Monthly', '% Rent Threshold', '% Rent Rate', 'Marketing Levy %', 'Marketing Levy Monthly'],
            ['Venue 1', 8000, 2500, 50000, 8, 0, 400]
        ]);
        XLSX.utils.book_append_sheet(wb, wsRent, 'Rent');

        const wsOtherPnl = XLSX.utils.aoa_to_sheet([
            [
                'active', 'allocation_scope', 'tracking_category_option1', 'venue_name',
                'account_code', 'account_name', 'account_key', 'account_type', 'account_category',
                'budget_method', 'base_monthly_amount', 'base_daily_amount', 'pct_of_sales',
                'effective_date', 'adjustment_type', 'adjustment_value', 'recommendation', 'notes'
            ],
            [
                'Y', 'venue', '01. EXAMPLE.VIC', 'Venue 1',
                '63001', 'Cleaning & disposables', 'other_63001_cleaning_disposables', 'Expense', '3.3 Other Operating Expenses',
                'daily_amount', 0, 25, 0,
                '', '', '', 'Use recent actual daily run-rate and adjust for known contract changes.', ''
            ]
        ]);
        XLSX.utils.book_append_sheet(wb, wsOtherPnl, 'Other P&L');

        XLSX.writeFile(wb, 'budget_templates.xlsx');
    },

    async pushToSupabase(onProgress) {
        const url = document.getElementById('supabase-url').value.trim();
        const key = document.getElementById('supabase-key').value.trim();

        if (!SupabaseClient.init(url, key)) throw new Error('Invalid Supabase credentials');

        const runName = document.getElementById('run-name').value || 'Budget Run';
        const runId = await SupabaseClient.createBudgetRun(runName, {
            forecast_start: CONFIG.BUDGET_YEAR_START,
            forecast_end: CONFIG.BUDGET_YEAR_END,
            created: new Date().toISOString()
        });

        onProgress(3, 'Created budget run...');

        const venues = ExcelParser.uploads.venue_details?.venues || [];
        if (venues.length) {
            await SupabaseClient.upsertVenues(venues.map(v => ({
                venue_name: v.venue_name,
                state: v.state,
                opening_date: v.opening_date,
                is_active: v.is_active
            })));
        }
        const venueIdMap = await SupabaseClient.getVenueIdMap();
        const missingVenueIds = venues
            .filter(v => !venueIdMap[v.venue_key])
            .map(v => v.venue_name);
        if (missingVenueIds.length) {
            throw new Error(`Could not resolve Supabase venue IDs for: ${missingVenueIds.slice(0, 10).join(', ')}`);
        }
        onProgress(8, 'Uploaded venues. Writing assumptions...');

        const result = {
            runId,
            assumptions: {},
            dailyAccountRows: 0,
            monthlyAccountRows: 0,
            warnings: []
        };

        // Write underlying assumption tables (best-effort: log a warning if a table is missing rather than abort).
        const safeWrite = async (label, fn) => {
            try { await fn(); }
            catch (err) {
                console.warn(`[push] ${label} skipped:`, err);
                result.warnings.push(`${label}: ${err?.message || err}`);
            }
        };

        // Ramp-up curves
        const rampUp = ExcelParser.uploads.venue_details?.rampUp || {};
        const rampRows = [];
        for (const [venueKey, months] of Object.entries(rampUp)) {
            const venueId = venueIdMap[venueKey];
            if (!venueId) continue;
            months.forEach((multiplier, i) => rampRows.push({
                venue_id: venueId, month_number: i + 1, multiplier
            }));
        }
        if (rampRows.length) await safeWrite('venue_ramp_up', () => SupabaseClient.upsertVenueRampUp(rampRows));
        result.assumptions.venue_ramp_up = rampRows.length;

        // Sales history
        const salesRows = (ExcelParser.uploads.sales_history?.records || [])
            .map(r => ({ venue_id: venueIdMap[r.venue_key], sale_date: r.sale_date, gross_sales: r.gross_sales }))
            .filter(r => r.venue_id);
        if (salesRows.length) {
            await safeWrite('sales_history', () => SupabaseClient.writeSalesHistory(salesRows));
        }
        result.assumptions.sales_history = salesRows.length;

        // Weather
        const weatherRows = [];
        for (const arr of Object.values(WeatherEngine.weatherData || {})) {
            for (const w of arr) weatherRows.push({
                state: w.state, observation_date: w.observation_date,
                max_temp_c: w.max_temp_c, min_temp_c: w.min_temp_c,
                rainfall_mm: w.rainfall_mm, sunshine_hours: w.sunshine_hours
            });
        }
        if (weatherRows.length) await safeWrite('weather_data', () => SupabaseClient.writeWeatherData(weatherRows));
        result.assumptions.weather_data = weatherRows.length;

        // Prior P&L
        const priorRows = (ExcelParser.uploads.prior_pnl?.records || [])
            .map(r => ({
                venue_id: venueIdMap[r.venue_key], period_month: r.period_month,
                line_item: r.line_item, amount: r.amount
            }))
            .filter(r => r.venue_id);
        if (priorRows.length) await safeWrite('prior_pnl', () => SupabaseClient.writePriorPnl(priorRows));
        result.assumptions.prior_pnl = priorRows.length;

        // Per-run assumptions
        const tagWithVenue = (records) => (records || [])
            .map(r => ({ ...r, venue_id: venueIdMap[r.venue_key] }))
            .filter(r => r.venue_id)
            .map(r => { const out = { ...r }; delete out.venue_key; delete out.venue_name; return out; });

        const ticketRows = tagWithVenue(ExcelParser.uploads.avg_ticket?.records);
        if (ticketRows.length) await safeWrite('avg_ticket_assumptions', () => SupabaseClient.writeAvgTicket(runId, ticketRows));
        result.assumptions.avg_ticket = ticketRows.length;

        const labourRows = tagWithVenue(ExcelParser.uploads.labour?.records).map(r => ({
            venue_id: r.venue_id,
            sales_per_labour_hr: r.sales_per_labour_hr,
            avg_hourly_rate: r.avg_hourly_rate,
            oncosts_pct: r.oncosts_pct,
            mgmt_salary_monthly: r.mgmt_salary_monthly,
            mgmt_oncosts_pct: r.mgmt_oncosts_pct
        }));
        if (labourRows.length) await safeWrite('labour_assumptions', () => SupabaseClient.writeLabour(runId, labourRows));
        result.assumptions.labour = labourRows.length;

        const cogsRows = tagWithVenue(ExcelParser.uploads.cogs?.records);
        if (cogsRows.length) await safeWrite('cogs_assumptions', () => SupabaseClient.writeCogs(runId, cogsRows));
        result.assumptions.cogs = cogsRows.length;

        const rentRows = tagWithVenue(ExcelParser.uploads.rent?.records);
        if (rentRows.length) await safeWrite('rent_assumptions', () => SupabaseClient.writeRent(runId, rentRows));
        result.assumptions.rent = rentRows.length;

        onProgress(20, 'Uploading daily account lines...');

        const dailyAccountRows = this.getDailyAccountDbRows(venueIdMap);
        if (dailyAccountRows.length) {
            await SupabaseClient.writeDailyAccountLines(runId, dailyAccountRows, (done, total) => {
                const pct = 20 + (done / total) * 65;
                onProgress(pct, `Uploading daily account lines... ${done}/${total}`);
            });
        }
        result.dailyAccountRows = dailyAccountRows.length;
        onProgress(90, 'Uploading monthly account lines...');

        const monthlyAccountRows = this.getMonthlyAccountDbRows(venueIdMap);
        if (monthlyAccountRows.length) {
            await SupabaseClient.writeMonthlyAccountLines(runId, monthlyAccountRows);
        }
        result.monthlyAccountRows = monthlyAccountRows.length;
        onProgress(100, result.warnings.length
            ? `Complete with ${result.warnings.length} warning(s) — see console.`
            : 'Complete!');
        return result;
    }
};
