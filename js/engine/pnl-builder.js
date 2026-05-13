const PnlBuilder = {
    dailyResults: [],
    monthlySummary: [],
    priorPnlByVenue: {},
    otherPnlLineItems: [],

    run(data) {
        const {
            venueDetails, salesHistory, avgTicketData, rampUpData,
            labourAssumptions, cogsAssumptions, rentAssumptions,
            monthlyGrowthData, newVenueAssumptions, otherPnlAssumptions,
            forecastStart, forecastEnd
        } = data;

        SalesForecastEngine.buildSeasonality(salesHistory, venueDetails);
        const discountByVenue = CogsCalcEngine.buildVenueDiscountMap(cogsAssumptions);
        const forecasts = SalesForecastEngine.generateForecasts(
            venueDetails, avgTicketData, rampUpData, forecastStart, forecastEnd,
            monthlyGrowthData || {}, newVenueAssumptions || {}, discountByVenue
        );

        CogsCalcEngine.calculate(forecasts, cogsAssumptions);
        LabourCalcEngine.calculate(forecasts, labourAssumptions);
        RentCalcEngine.calculate(forecasts, rentAssumptions);
        OtherPnlCalcEngine.calculate(
            forecasts,
            otherPnlAssumptions || [],
            venueDetails,
            forecastStart,
            forecastEnd
        );
        this.otherPnlLineItems = OtherPnlCalcEngine.lineItems || [];

        // other_pnl_total is now a SIGNED contribution (income +ve, expense -ve), so add it.
        for (const f of forecasts) {
            f.venue_contribution = Math.round(
                (f.gross_profit - f.labour_total - f.occupancy_total + (f.other_pnl_total || 0)) * 100
            ) / 100;
        }

        this.dailyResults = forecasts;
        this.monthlySummary = this.aggregateMonthly(forecasts);

        return { daily: this.dailyResults, monthly: this.monthlySummary };
    },

    aggregateMonthly(dailyForecasts) {
        const grouped = {};

        for (const f of dailyForecasts) {
            const monthKey = f.forecast_date.substring(0, 7) + '-01';
            const key = `${f.venue_key}_${monthKey}`;

            if (!grouped[key]) {
                grouped[key] = {
                    venue_key: f.venue_key,
                    venue_name: f.venue_name,
                    state: f.state,
                    budget_month: monthKey,
                    gross_sales: 0,
                    net_sales: 0,
                    net_sales_servings: 0,
                    net_sales_retail: 0,
                    gross_sales_servings: 0,
                    gross_sales_retail: 0,
                    cogs_food: 0,
                    cogs_packaging: 0,
                    cogs_retail: 0,
                    cogs_discounts: 0,
                    cogs_total: 0,
                    gross_profit: 0,
                    crew_labour_cost: 0,
                    crew_oncosts: 0,
                    mgmt_labour_cost: 0,
                    mgmt_oncosts: 0,
                    labour_total: 0,
                    rent_base: 0,
                    rent_outgoings: 0,
                    rent_percentage: 0,
                    rent_marketing_levy: 0,
                    occupancy_total: 0,
                    other_pnl_total: 0,
                    venue_contribution: 0,
                    transaction_count: 0,
                    trading_days: 0
                };
            }

            const m = grouped[key];
            m.gross_sales += Number(f.gross_sales || 0);
            m.net_sales += f.net_sales;
            m.net_sales_servings += Number(f.net_sales_servings || 0);
            m.net_sales_retail   += Number(f.net_sales_retail || 0);
            m.gross_sales_servings += Number(f.gross_sales_servings || 0);
            m.gross_sales_retail   += Number(f.gross_sales_retail || 0);
            m.cogs_food += f.cogs_food;
            m.cogs_packaging += f.cogs_packaging;
            m.cogs_retail += f.cogs_retail;
            m.cogs_discounts += f.cogs_discounts;
            m.cogs_total += f.cogs_total;
            m.gross_profit += f.gross_profit;
            m.crew_labour_cost += f.crew_labour_cost;
            m.crew_oncosts += f.crew_oncosts;
            m.mgmt_labour_cost += f.mgmt_labour_cost;
            m.mgmt_oncosts += f.mgmt_oncosts;
            m.labour_total += f.labour_total;
            m.rent_base += f.rent_base;
            m.rent_outgoings += f.rent_outgoings;
            m.rent_percentage += f.rent_percentage;
            m.rent_marketing_levy += f.rent_marketing_levy;
            m.occupancy_total += f.occupancy_total;
            m.other_pnl_total += f.other_pnl_total || 0;
            for (const item of this.otherPnlLineItems) {
                if (m[item.key] == null) m[item.key] = 0;
                m[item.key] += f[item.key] || 0;
            }
            m.venue_contribution += f.venue_contribution;
            m.transaction_count += f.forecast_transactions;
            m.trading_days++;
        }

        const result = Object.values(grouped).map(m => {
            const rounded = {};
            for (const [k, v] of Object.entries(m)) {
                rounded[k] = typeof v === 'number' ? Math.round(v * 100) / 100 : v;
            }
            return rounded;
        });

        return result.sort((a, b) =>
            a.venue_key.localeCompare(b.venue_key) || a.budget_month.localeCompare(b.budget_month)
        );
    },

    getPnlTable(venueKey, view) {
        const months = this.getMonthsForView(venueKey, view);
        const lineItems = this.getPnlLineItems();

        const rows = lineItems.map(item => {
            const row = {
                key: item.key,
                label: item.label,
                type: item.type,
                account_category: item.account_category,
                values: {}
            };
            for (const period of months) {
                const data = this.getPeriodData(venueKey, period);
                row.values[period.key] = data ? (data[item.key] || 0) : 0;
            }
            row.total = Object.values(row.values).reduce((s, v) => s + v, 0);
            return row;
        });

        return { months, rows };
    },

    // Active revenue stream filter: 'all' (default) | 'servings' | 'retail'
    // Line items tagged with a `stream` are filtered out when the user has selected
    // the other stream. Items without a stream tag stay visible in all modes.
    streamFilter: 'all',

    matchesStream(item) {
        const filter = this.streamFilter || 'all';
        if (filter === 'all') return true;
        if (!item.stream) return true;        // stream-agnostic items (subtotals, occupancy, etc.)
        return item.stream === filter;
    },

    getPnlLineItems() {
        const all = (!this.otherPnlLineItems.length)
            ? CONFIG.PNL_LINE_ITEMS.slice()
            : (() => {
                const contribution = CONFIG.PNL_LINE_ITEMS.find(item => item.key === 'venue_contribution');
                const base = CONFIG.PNL_LINE_ITEMS.filter(item => item.key !== 'venue_contribution');
                return [
                    ...base,
                    ...this.otherPnlLineItems,
                    { key: 'other_pnl_total', label: 'Total Other P&L', type: 'subtotal', account_category: 'Other P&L' },
                    contribution
                ].filter(Boolean);
            })();
        return all.filter(item => this.matchesStream(item));
    },

    getMonthsForView(venueKey, view) {
        const summaries = venueKey === '__all__'
            ? this.monthlySummary
            : this.monthlySummary.filter(m => m.venue_key === venueKey);

        const monthSet = new Set(summaries.map(m => m.budget_month));
        const sorted = [...monthSet].sort();

        if (view === 'quarterly') {
            const quarters = {};
            for (const m of sorted) {
                const month = parseInt(m.substring(5, 7));
                const year = parseInt(m.substring(0, 4));
                const q = Math.ceil(month / 3);
                const qKey = `${year}-Q${q}`;
                if (!quarters[qKey]) quarters[qKey] = { key: qKey, label: `Q${q} ${year}`, months: [] };
                quarters[qKey].months.push(m);
            }
            return Object.values(quarters);
        }

        if (view === 'annual') {
            return [{ key: 'annual', label: 'Full Year', months: sorted }];
        }

        return sorted.map(m => {
            const d = new Date(m);
            const label = d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' });
            return { key: m, label };
        });
    },

    getPeriodData(venueKey, period) {
        if (period.months) {
            const totals = {};
            for (const monthKey of period.months) {
                const monthData = this.getMonthlyData(venueKey, monthKey);
                if (!monthData) continue;
                for (const [k, v] of Object.entries(monthData)) {
                    if (typeof v === 'number') totals[k] = (totals[k] || 0) + v;
                }
            }
            return totals;
        }
        return this.getMonthlyData(venueKey, period.key);
    },

    getMonthlyData(venueKey, monthKey) {
        const summaries = venueKey === '__all__'
            ? this.monthlySummary.filter(m => m.budget_month === monthKey)
            : this.monthlySummary.filter(m => m.venue_key === venueKey && m.budget_month === monthKey);

        if (summaries.length === 0) return null;

        const agg = {};
        for (const s of summaries) {
            for (const [k, v] of Object.entries(s)) {
                if (typeof v === 'number') {
                    agg[k] = (agg[k] || 0) + v;
                }
            }
        }
        return agg;
    },

    getVarianceTable(venueKey) {
        const budget = this.getPnlTable(venueKey, 'annual');
        const priorData = this.getPriorAnnualTotals(venueKey);

        return budget.rows.map(row => ({
            label: row.label,
            key: row.key,
            type: row.type,
            account_category: row.account_category,
            budget: row.total,
            prior: priorData[row.key] || 0,
            variance: row.total - (priorData[row.key] || 0),
            variancePct: priorData[row.key] ? ((row.total - priorData[row.key]) / Math.abs(priorData[row.key])) * 100 : 0
        }));
    },

    getPriorAnnualTotals(venueKey) {
        const totals = {};
        const venues = venueKey === '__all__'
            ? Object.keys(this.priorPnlByVenue)
            : [venueKey];

        this.lastPriorMappingMisses = new Set(this.lastPriorMappingMisses || []);

        for (const vk of venues) {
            const venueData = this.priorPnlByVenue[vk];
            if (!venueData) continue;
            const factor = this.getPriorAnnualisationFactor(vk, Object.keys(venueData));
            for (const monthData of Object.values(venueData)) {
                for (const [item, amount] of Object.entries(monthData)) {
                    const mappedKey = this.mapPriorLineItem(item);
                    if (mappedKey) {
                        totals[mappedKey] = (totals[mappedKey] || 0) + (amount * factor);
                    } else {
                        this.lastPriorMappingMisses.add(item);
                    }
                }
            }
        }

        // Synthesize prior gross_sales if not present but net_sales + discounts are.
        if (!totals.gross_sales && (totals.net_sales || totals.cogs_discounts)) {
            totals.gross_sales = (totals.net_sales || 0) + Math.abs(totals.cogs_discounts || 0);
        }
        // If prior has a single 'labour_total' but no crew/mgmt split, leave the split lines at 0
        // (so they show as variance) but use the total for comparison at subtotal level.

        return totals;
    },

    getPriorCoverageReport() {
        const out = [];
        for (const [venueKey, months] of Object.entries(this.priorPnlByVenue || {})) {
            const monthCount = new Set(Object.keys(months || {})).size;
            out.push({
                venue_key: venueKey,
                months_covered: monthCount,
                annualisation_factor: 12 / Math.max(1, monthCount),
                low_coverage: monthCount < 12
            });
        }
        return out.sort((a, b) => a.months_covered - b.months_covered);
    },

    getPriorMappingMisses() {
        return [...(this.lastPriorMappingMisses || new Set())];
    },

    getPriorAnnualisationFactor(venueKey, monthKeys) {
        const months = [...new Set((monthKeys || [])
            .map(m => this.parseMonthKey(m))
            .filter(Boolean)
            .map(m => `${m.year}-${String(m.month).padStart(2, '0')}`))];

        if (months.length === 0 || months.length >= 12) return 1;

        const parsedMonths = months.map(m => this.parseMonthKey(`${m}-01`)).filter(Boolean);
        if (!parsedMonths.length) return 1;

        const first = parsedMonths
            .slice()
            .sort((a, b) => (a.year - b.year) || (a.month - b.month))[0];
        const fyStartYear = first.month >= 7 ? first.year : first.year - 1;
        const seasonality = SalesForecastEngine.getSeasonalityData(venueKey);
        const monthIndices = seasonality?.month?.length === 12
            ? seasonality.month
            : Array(12).fill(1);

        const monthWeight = (year, month) =>
            this.daysInMonth(year, month) * (monthIndices[month - 1] || 1);

        let fullYearWeight = 0;
        for (let i = 0; i < 12; i++) {
            const month = ((6 + i) % 12) + 1;
            const year = month >= 7 ? fyStartYear : fyStartYear + 1;
            fullYearWeight += monthWeight(year, month);
        }

        const coveredWeight = parsedMonths.reduce((sum, m) =>
            sum + monthWeight(m.year, m.month), 0);

        if (coveredWeight <= 0 || fullYearWeight <= 0) {
            return 12 / Math.max(1, months.length);
        }
        return fullYearWeight / coveredWeight;
    },

    parseMonthKey(value) {
        const match = String(value || '').match(/^(\d{4})-(\d{2})/);
        if (!match) return null;
        return {
            year: Number(match[1]),
            month: Number(match[2])
        };
    },

    daysInMonth(year, month) {
        return new Date(year, month, 0).getDate();
    },

    _normaliseLineItemKey(s) {
        // Fuzzy matcher: lowercase, strip punctuation, collapse whitespace.
        // Handles "COGS - Food" vs "COGS Food" vs "Cost of Sales – Food".
        return String(s || '')
            .toLowerCase()
            .replace(/&/g, ' and ')
            .replace(/[–—]/g, '-')   // en/em dash
            .replace(/[^a-z0-9%]+/g, ' ')      // keep % so "% rent" still matches
            .replace(/\s+/g, ' ')
            .replace(/\bcost of sales?\b/g, 'cogs')
            .replace(/\bmanagement\b/g, 'mgmt')
            .trim();
    },

    mapPriorLineItem(lineItem) {
        const norm = this._normaliseLineItemKey(lineItem);
        if (!norm) return null;

        if (!this._priorLineItemIndex) this._buildPriorLineItemIndex();
        if (this._priorLineItemIndex.exact.has(norm)) {
            return this._priorLineItemIndex.exact.get(norm);
        }
        // contains-match (e.g. prior "labour crew wages" matches budget "labour crew")
        for (const [key, target] of this._priorLineItemIndex.contains) {
            if (norm.includes(key) || key.includes(norm)) return target;
        }
        // Numeric account-code match: extract first 4-6 digit run and look it up.
        // Handles labels like "Bank Fees (62001)" vs budget label "62001 - Bank Fees".
        const codeMatch = String(lineItem).match(/(\d{3,6})/);
        if (codeMatch && this._priorLineItemIndex.byCode.has(codeMatch[1])) {
            return this._priorLineItemIndex.byCode.get(codeMatch[1]);
        }
        return null;
    },

    _buildPriorLineItemIndex() {
        const exact = new Map();
        const contains = [];
        const byCode = new Map();   // numeric Xero account code -> target budget key
        const addPair = (alias, target) => {
            const n = this._normaliseLineItemKey(alias);
            if (n && !exact.has(n)) exact.set(n, target);
        };

        const aliases = {
            net_sales: ['Net Sales', 'Total Revenue', 'Sales', 'Trade Revenue', 'Revenue'],
            net_sales_servings: ['Net Sales - Servings', 'Servings Sales', 'Yogurt Sales', 'Net Sales Servings'],
            net_sales_retail: ['Net Sales - Retail', 'Retail Sales', 'Net Sales Retail', 'Net Retail Sales'],
            gross_sales: ['Gross Sales', 'Gross Revenue'],
            cogs_food: ['COGS - Food', 'COGS Food', 'Food COGS', 'Cost of Sales - Food', 'Servings Cost', 'Food Cost'],
            cogs_packaging: ['COGS - Packaging', 'Packaging COGS', 'Packaging Cost', 'Packaging'],
            cogs_retail: ['COGS - Retail', 'Retail COGS', 'Retail Cost', 'Retail Costs'],
            cogs_discounts: ['Discounts', 'COGS - Discounts', 'Sale Discounts', 'Sales Discounts', 'Promotional Discounts'],
            cogs_total: ['Total COGS', 'Total Cost of Sales', 'COGS', 'Cost of Sales'],
            gross_profit: ['Gross Profit', 'GP'],
            crew_labour_cost: ['Labour - Crew', 'Crew Labour', 'Crew Wages', 'Wages Crew', 'Wages and Salaries Crew'],
            crew_oncosts: ['Labour - Crew Oncosts', 'Crew Oncosts', 'Crew On Costs'],
            mgmt_labour_cost: ['Labour - Management', 'Management Labour', 'Mgmt Salary', 'Mgmt Wages', 'Manager Salary'],
            mgmt_oncosts: ['Labour - Mgmt Oncosts', 'Mgmt Oncosts', 'Management Oncosts', 'Mgmt On Costs'],
            labour_total: ['Total Labour', 'Total Wages and Salaries', 'Total Wages'],
            rent_base: ['Occupancy - Base Rent', 'Base Rent', 'Rent', 'Rent Base'],
            rent_outgoings: ['Occupancy - Outgoings', 'Outgoings', 'Property Outgoings'],
            rent_percentage: ['Occupancy - % Rent', '% Rent', 'Percentage Rent', 'Pct Rent', 'Turnover Rent'],
            rent_marketing_levy: ['Occupancy - Marketing Levy', 'Marketing Levy', 'Centre Marketing'],
            occupancy_total: ['Total Occupancy', 'Total Property Expenses', 'Property Expenses Total'],
            venue_contribution: ['Venue Contribution', 'Store Contribution', 'Four Wall Contribution', 'Contribution']
        };
        for (const [key, list] of Object.entries(aliases)) {
            for (const alias of list) addPair(alias, key);
            contains.push([key.replace(/_/g, ' '), key]);
        }

        // Add dynamic Other P&L items as exact matches by their label / key,
        // PLUS index the bare numeric account code (e.g. "62001") so we can match
        // prior-PNL labels written as "Bank Fees (62001)" by extracting the code.
        for (const item of this.otherPnlLineItems || []) {
            addPair(item.label, item.key);
            addPair(item.key, item.key);
            if (item.account_code) addPair(item.account_code, item.key);
            const codeMatch = String(item.account_code || item.key || item.label || '').match(/(\d{3,6})/);
            if (codeMatch && !byCode.has(codeMatch[1])) byCode.set(codeMatch[1], item.key);
        }
        this._priorLineItemIndex = { exact, contains, byCode };
    },

    setPriorPnl(priorPnlRecords) {
        this.priorPnlByVenue = {};
        this._priorLineItemIndex = null; // rebuild on next variance calc
        for (const r of priorPnlRecords) {
            if (!this.priorPnlByVenue[r.venue_key]) this.priorPnlByVenue[r.venue_key] = {};
            const monthKey = r.period_month;
            if (!this.priorPnlByVenue[r.venue_key][monthKey]) this.priorPnlByVenue[r.venue_key][monthKey] = {};
            this.priorPnlByVenue[r.venue_key][monthKey][r.line_item] = r.amount;
        }
    },

    getNetworkKPIs() {
        const filter = this.streamFilter || 'all';
        const totals = {
            net_sales: 0,
            cogs_total: 0,
            gross_profit: 0,
            labour_total: 0,
            occupancy_total: 0,
            other_pnl_total: 0,
            venue_contribution: 0
        };
        for (const m of this.monthlySummary) {
            // Pick the sales base by stream
            const sales = filter === 'servings' ? (m.net_sales_servings || 0)
                        : filter === 'retail' ? (m.net_sales_retail || 0)
                        : m.net_sales;
            totals.net_sales += sales;
            // Pick stream-relevant COGS portions
            if (filter === 'retail') {
                totals.cogs_total += (m.cogs_retail || 0);
                totals.gross_profit += (m.net_sales_retail || 0) - (m.cogs_retail || 0);
            } else if (filter === 'servings') {
                const cogs_serv = (m.cogs_food || 0) + (m.cogs_packaging || 0);
                totals.cogs_total += cogs_serv;
                const disc_giveback = (m.cogs_discounts || 0);
                totals.gross_profit += (m.net_sales_servings || 0) - cogs_serv - disc_giveback;
            } else {
                totals.cogs_total += m.cogs_total;
                totals.gross_profit += m.gross_profit;
            }
            // Labour / Occupancy / Other / Contribution are stream-agnostic
            totals.labour_total += m.labour_total;
            totals.occupancy_total += m.occupancy_total;
            totals.other_pnl_total += m.other_pnl_total || 0;
            totals.venue_contribution += m.venue_contribution;
        }

        return {
            sales: totals.net_sales,
            gpPct: totals.net_sales ? (totals.gross_profit / totals.net_sales) * 100 : 0,
            labourPct: totals.net_sales ? (totals.labour_total / totals.net_sales) * 100 : 0,
            occupancyPct: totals.net_sales ? (totals.occupancy_total / totals.net_sales) * 100 : 0,
            contributionPct: totals.net_sales ? (totals.venue_contribution / totals.net_sales) * 100 : 0,
            stream: filter
        };
    },

    getContributionByState() {
        const byState = {};
        for (const m of this.monthlySummary) {
            if (!byState[m.state]) byState[m.state] = { sales: 0, contribution: 0, venues: new Set() };
            byState[m.state].sales += m.net_sales;
            byState[m.state].contribution += m.venue_contribution;
            byState[m.state].venues.add(m.venue_key);
        }
        return Object.entries(byState).map(([state, data]) => ({
            state,
            sales: data.sales,
            contribution: data.contribution,
            venueCount: data.venues.size,
            contributionPct: data.sales ? (data.contribution / data.sales) * 100 : 0
        })).sort((a, b) => b.contribution - a.contribution);
    }
};
