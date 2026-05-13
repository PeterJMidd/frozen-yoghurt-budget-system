const App = {
    budgetReady: false,

    init() {
        this.setupTabs();
        this.setupFileUploads();
        this.setupButtons();
        this.loadSavedConfig();
    },

    setupTabs() {
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');

                if (tab.dataset.tab === 'sales-forecast' && this.budgetReady) {
                    const venueKey = document.getElementById('forecast-venue-filter').value;
                    Charts.renderAllSalesCharts(venueKey);
                    this.renderForecastDiagnostics();
                }
                if (tab.dataset.tab === 'sales-detail' && this.budgetReady) {
                    this.renderSalesDetail();
                }
                if (tab.dataset.tab === 'dashboard' && this.budgetReady) {
                    this.renderDashboard();
                }
                if (tab.dataset.tab === 'pnl' && this.budgetReady) {
                    this.renderPnlTable();
                }
            });
        });
    },

    setupFileUploads() {
        const templates = {
            sales_history: ExcelParser.parseSalesHistory.bind(ExcelParser),
            prior_pnl: ExcelParser.parsePriorPnl.bind(ExcelParser),
            venue_details: ExcelParser.parseVenueDetails.bind(ExcelParser),
            avg_ticket: ExcelParser.parseAvgTicket.bind(ExcelParser),
            labour: ExcelParser.parseLabour.bind(ExcelParser),
            cogs: ExcelParser.parseCogs.bind(ExcelParser),
            rent: ExcelParser.parseRent.bind(ExcelParser),
            other_pnl: ExcelParser.parseOtherPnl.bind(ExcelParser)
        };

        for (const [key, parser] of Object.entries(templates)) {
            const dropZone = document.getElementById(`drop-${key}`);
            const input = dropZone.querySelector('input[type="file"]');
            const status = document.getElementById(`status-${key}`);

            const handleFile = async (file) => {
                status.textContent = 'Parsing...';
                status.className = 'upload-status loading';
                try {
                    const wb = await ExcelParser.readFile(file);
                    const result = parser(wb);
                    ExcelParser.uploads[key] = result;

                    const count = result.records?.length || result.venues?.length || 0;
                    const sanity = ExcelParser.sanityWarnings(key, result) || [];
                    const errorCount = result.errors?.length || 0;
                    const warnCount = errorCount + sanity.length;

                    status.textContent = `Loaded: ${count} records` + (warnCount ? ` (${warnCount} warning(s))` : '');
                    status.className = warnCount ? 'upload-status warning' : 'upload-status success';
                    status.title = [...(result.errors || []), ...sanity].slice(0, 30).join('\n');
                    if (sanity.length) console.warn(`[${key}] sanity warnings:`, sanity);
                    result.sanityWarnings = sanity;

                    this.updateRunButton();
                    this.showPreview(key, result);

                    if (key === 'venue_details') {
                        this.populateVenueFilters(result.venues);
                        this.renderVenueTable(result.venues);
                    }
                    if ((key === 'venue_details' || key === 'sales_history') && ExcelParser.uploads.venue_details) {
                        this.populateSalesDetailFilters();
                    }
                } catch (err) {
                    status.textContent = `Error: ${err.message}`;
                    status.className = 'upload-status error';
                }
            };

            input.addEventListener('change', (e) => {
                if (e.target.files[0]) handleFile(e.target.files[0]);
            });

            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.classList.add('dragover');
            });
            dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('dragover');
                if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
            });
        }
    },

    setupButtons() {
        document.getElementById('btn-run-budget').addEventListener('click', () => this.runBudget());

        document.getElementById('btn-test-connection').addEventListener('click', async () => {
            const status = document.getElementById('connection-status');
            const url = document.getElementById('supabase-url').value.trim();
            const key = document.getElementById('supabase-key').value.trim();
            try {
                SupabaseClient.init(url, key);
                await SupabaseClient.testConnection();
                status.textContent = 'Connected successfully';
                status.style.color = 'var(--success)';
                document.getElementById('btn-push-supabase').disabled = false;
                document.getElementById('btn-run-schema').disabled = false;
                localStorage.setItem('sb_url', url);
                localStorage.setItem('sb_key', key);
            } catch (err) {
                status.textContent = `Failed: ${err.message}`;
                status.style.color = 'var(--danger)';
            }
        });

        document.getElementById('btn-push-supabase').addEventListener('click', async () => {
            const progress = document.getElementById('push-progress');
            const fill = progress.querySelector('.progress-fill');
            const text = progress.querySelector('.progress-text');
            progress.style.display = 'block';
            try {
                const result = await ExportEngine.pushToSupabase((pct, msg) => {
                    fill.style.width = `${pct}%`;
                    text.textContent = msg;
                });
                const a = result.assumptions || {};
                const assumptionParts = [
                    `${result.dailyAccountRows.toLocaleString()} daily account lines`,
                    `${result.monthlyAccountRows.toLocaleString()} monthly`,
                    `${(a.sales_history || 0).toLocaleString()} sales-history`,
                    `${(a.prior_pnl || 0).toLocaleString()} prior-PNL`,
                    `${(a.weather_data || 0).toLocaleString()} weather`,
                    `${(a.avg_ticket || 0).toLocaleString()} avg-ticket`,
                    `${(a.labour || 0).toLocaleString()} labour`,
                    `${(a.cogs || 0).toLocaleString()} COGS`,
                    `${(a.rent || 0).toLocaleString()} rent`,
                    `${(a.venue_ramp_up || 0).toLocaleString()} ramp-up`
                ].join(' | ');
                text.textContent = `Done! Run ${result.runId} | ${assumptionParts}` +
                    (result.warnings?.length ? ` | ${result.warnings.length} warning(s) — see console` : '');
            } catch (err) {
                text.textContent = `Error: ${err.message}`;
                fill.style.width = '0%';
            }
        });

        document.getElementById('btn-export-daily').addEventListener('click', () => ExportEngine.exportDailyForecast());
        document.getElementById('btn-export-monthly').addEventListener('click', () => ExportEngine.exportMonthlySummary());
        document.getElementById('btn-export-pnl').addEventListener('click', () => ExportEngine.exportPnl());
        document.getElementById('btn-export-variance').addEventListener('click', () => ExportEngine.exportVariance());
        document.getElementById('btn-dl-templates').addEventListener('click', () => ExportEngine.generateTemplates());

        document.getElementById('btn-copy-schema').addEventListener('click', () => {
            navigator.clipboard.writeText(SupabaseClient.getSchemaSQL());
            document.getElementById('btn-copy-schema').textContent = 'Copied!';
            setTimeout(() => document.getElementById('btn-copy-schema').textContent = 'Copy Schema SQL', 2000);
        });

        document.getElementById('btn-run-schema').addEventListener('click', async () => {
            try {
                const { error } = await SupabaseClient.client.rpc('exec_sql', { sql: SupabaseClient.getSchemaSQL() });
                if (error) throw error;
                alert('Schema created successfully');
            } catch (err) {
                alert(`Schema error: ${err.message}\n\nPlease run the SQL manually in the Supabase SQL editor.`);
            }
        });

        document.getElementById('forecast-venue-filter').addEventListener('change', (e) => {
            if (this.budgetReady) Charts.renderAllSalesCharts(e.target.value);
        });

        for (const id of ['detail-state-filter', 'detail-cluster-filter', 'detail-cohort-filter', 'detail-venue-filter', 'detail-group-by', 'detail-growth-input']) {
            document.getElementById(id).addEventListener('change', () => {
                if (this.budgetReady) this.renderSalesDetail();
            });
        }
        document.getElementById('btn-detail-refresh').addEventListener('click', () => {
            if (this.budgetReady) this.renderSalesDetail();
        });
        document.getElementById('btn-detail-apply-growth').addEventListener('click', () => this.applyDetailGrowthAssumption());

        document.getElementById('pnl-venue-filter').addEventListener('change', () => {
            if (this.budgetReady) this.renderPnlTable();
        });

        document.getElementById('pnl-view').addEventListener('change', () => {
            if (this.budgetReady) this.renderPnlTable();
        });

        document.getElementById('filter-state').addEventListener('change', () => this.filterVenueTable());
        document.getElementById('filter-maturity').addEventListener('change', () => this.filterVenueTable());

        const streamFilter = document.getElementById('stream-filter');
        if (streamFilter) {
            streamFilter.addEventListener('change', () => {
                PnlBuilder.streamFilter = streamFilter.value;
                if (!this.budgetReady) return;
                // Re-render whichever tab is active so the change is visible immediately
                const active = document.querySelector('.tab.active')?.dataset?.tab;
                if (active === 'dashboard') this.renderDashboard();
                else if (active === 'pnl') this.renderPnlTable();
                else if (active === 'sales-forecast') {
                    const v = document.getElementById('forecast-venue-filter').value;
                    Charts.renderAllSalesCharts(v);
                    this.renderForecastDiagnostics();
                }
                else if (active === 'sales-detail') this.renderSalesDetail();
                this.updateKPIs();
            });
        }
    },

    loadSavedConfig() {
        const url = localStorage.getItem('sb_url');
        const key = localStorage.getItem('sb_key');
        const apiUrl = localStorage.getItem('api_url');
        if (url) document.getElementById('supabase-url').value = url;
        if (key) document.getElementById('supabase-key').value = key;
        document.getElementById('api-url').value = apiUrl || CONFIG.FORECAST_API_URL || '';
    },

    updateRunButton() {
        const required = ['venue_details', 'avg_ticket', 'labour', 'cogs', 'rent'];
        const hasAll = required.every(k => ExcelParser.uploads[k]);
        const hasSalesOrHistory = ExcelParser.uploads.sales_history;
        document.getElementById('btn-run-budget').disabled = !(hasAll && hasSalesOrHistory);

        const uploaded = Object.keys(ExcelParser.uploads).length;
        document.getElementById('venue-count-display').textContent =
            ExcelParser.uploads.venue_details
                ? `${ExcelParser.uploads.venue_details.venues.length} venues`
                : '';
    },

    async runBudget() {
        const btn = document.getElementById('btn-run-budget');
        const progress = document.getElementById('run-progress');
        const fill = progress.querySelector('.progress-fill');
        const text = progress.querySelector('.progress-text');

        btn.disabled = true;
        progress.style.display = 'block';
        fill.style.width = '0%';
        text.textContent = 'Starting...';

        try {
            const forecastStart = document.getElementById('forecast-start').value || CONFIG.BUDGET_YEAR_START;
            const forecastEnd = document.getElementById('forecast-end').value || CONFIG.BUDGET_YEAR_END;
            CONFIG.BUDGET_YEAR_START = forecastStart;
            CONFIG.BUDGET_YEAR_END = forecastEnd;

            const venueData = ExcelParser.uploads.venue_details;
            const salesData = ExcelParser.uploads.sales_history;
            const avgTicketData = ExcelParser.uploads.avg_ticket;
            const labourData = ExcelParser.uploads.labour;
            const cogsData = ExcelParser.uploads.cogs;
            const rentData = ExcelParser.uploads.rent;
            const otherPnlData = ExcelParser.uploads.other_pnl;
            const priorPnl = ExcelParser.uploads.prior_pnl;

            const validationErrors = ExcelParser.validateCrossTemplate();
            if (validationErrors.length) {
                throw new Error(`Template validation failed:\n${validationErrors.slice(0, 20).join('\n')}`);
            }

            fill.style.width = '10%';
            text.textContent = 'Fetching weather data...';

            if (document.getElementById('fetch-weather').checked && salesData?.dateRange) {
                const states = [...new Set(venueData.venues.map(v => v.state))];
                await WeatherEngine.fetchHistoricalWeather(
                    states, salesData.dateRange.start, salesData.dateRange.end,
                    (done, total) => {
                        fill.style.width = `${10 + (done / total) * 20}%`;
                        text.textContent = `Weather: ${done}/${total} states...`;
                    }
                );
                WeatherEngine.buildTempBandIndices(salesData.records, venueData.venues);
            }

            // Call your existing Render API for Prophet/SARIMA forecasts
            const apiUrl = document.getElementById('api-url').value.trim();
            const useApi = document.getElementById('use-api-forecast').checked && apiUrl;
            if (useApi) {
                CONFIG.FORECAST_API_URL = apiUrl;
                localStorage.setItem('api_url', apiUrl);
                fill.style.width = '35%';
                text.textContent = 'Calling forecast API (Prophet/SARIMA)...';

                const lastHistoryDate = salesData.dateRange?.end || forecastStart;
                const forecastDayCount = Math.max(
                    1,
                    Math.floor((new Date(forecastEnd) - new Date(lastHistoryDate)) / (1000 * 60 * 60 * 24))
                );
                await SalesForecastEngine.fetchApiForecasts(
                    salesData.records, venueData.venues, forecastDayCount,
                    (done, total) => {
                        fill.style.width = `${35 + (done / total) * 25}%`;
                        text.textContent = `API forecast: ${done}/${total} venues...`;
                    }
                );
            }

            fill.style.width = '65%';
            text.textContent = 'Building P&L forecast...';

            if (priorPnl) PnlBuilder.setPriorPnl(priorPnl.records);

            await new Promise(resolve => setTimeout(resolve, 10));

            PnlBuilder.run({
                venueDetails: venueData.venues,
                salesHistory: salesData.records,
                avgTicketData: avgTicketData.records,
                rampUpData: venueData.rampUp || {},
                monthlyGrowthData: venueData.monthlyGrowth || {},
                newVenueAssumptions: venueData.newVenueAssumptions || {},
                labourAssumptions: labourData.records,
                cogsAssumptions: cogsData.records,
                rentAssumptions: rentData.records,
                otherPnlAssumptions: otherPnlData?.records || [],
                forecastStart,
                forecastEnd
            });

            fill.style.width = '85%';
            text.textContent = 'Rendering...';

            await new Promise(resolve => setTimeout(resolve, 10));

            this.budgetReady = true;
            this.enableExports();
            this.updateKPIs();
            this.populateSalesDetailFilters();

            const runName = document.getElementById('run-name').value || 'Budget';
            document.getElementById('run-name-display').textContent = runName;
            const pnlLineCount = PnlBuilder.getPnlLineItems().length;
            const dailyAccountLines = PnlBuilder.dailyResults.length * pnlLineCount;
            const monthlyAccountLines = PnlBuilder.monthlySummary.length * pnlLineCount;
            document.getElementById('calc-status').textContent =
                `${PnlBuilder.dailyResults.length.toLocaleString()} venue-day rows | ${dailyAccountLines.toLocaleString()} daily account lines | ${monthlyAccountLines.toLocaleString()} monthly account lines`;

            fill.style.width = '100%';
            text.textContent = `Done! ${dailyAccountLines.toLocaleString()} daily account-line rows ready for export/push`;

        } catch (err) {
            text.textContent = `Error: ${err.message}`;
            console.error(err);
        }

        btn.disabled = false;
    },

    enableExports() {
        document.getElementById('btn-export-daily').disabled = false;
        document.getElementById('btn-export-monthly').disabled = false;
        document.getElementById('btn-export-pnl').disabled = false;
        document.getElementById('btn-export-variance').disabled = false;
    },

    updateKPIs() {
        const kpis = PnlBuilder.getNetworkKPIs();
        document.getElementById('kpi-sales').textContent =
            new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(kpis.sales);
        document.getElementById('kpi-gp').textContent = kpis.gpPct.toFixed(1) + '%';
        document.getElementById('kpi-labour').textContent = kpis.labourPct.toFixed(1) + '%';
        document.getElementById('kpi-occupancy').textContent = kpis.occupancyPct.toFixed(1) + '%';
        document.getElementById('kpi-contribution').textContent = kpis.contributionPct.toFixed(1) + '%';
    },

    populateVenueFilters(venues) {
        const selects = [
            document.getElementById('forecast-venue-filter'),
            document.getElementById('pnl-venue-filter')
        ];

        for (const select of selects) {
            const current = select.value;
            select.innerHTML = '<option value="__all__">All Venues (Network)</option>';
            for (const v of venues.sort((a, b) => a.venue_name.localeCompare(b.venue_name))) {
                const opt = document.createElement('option');
                opt.value = v.venue_key;
                opt.textContent = `${v.venue_name} (${v.state})`;
                select.appendChild(opt);
            }
            if (current) select.value = current;
        }
        this.populateSalesDetailFilters();
    },

    populateSalesDetailFilters() {
        if (!window.SalesAnalysisEngine) return;
        const options = SalesAnalysisEngine.getFilterOptions();
        const stateSelect = document.getElementById('detail-state-filter');
        const clusterSelect = document.getElementById('detail-cluster-filter');
        const venueSelect = document.getElementById('detail-venue-filter');
        if (!stateSelect || !clusterSelect || !venueSelect) return;

        const setOptions = (select, placeholder, values, labelFn = v => v, valueFn = v => v) => {
            const current = select.value;
            select.innerHTML = `<option value="__all__">${placeholder}</option>`;
            for (const value of values) {
                const opt = document.createElement('option');
                opt.value = valueFn(value);
                opt.textContent = labelFn(value);
                select.appendChild(opt);
            }
            if ([...select.options].some(o => o.value === current)) select.value = current;
        };

        setOptions(stateSelect, 'All States', options.states);
        setOptions(clusterSelect, 'All Clusters', options.clusters);
        setOptions(
            venueSelect,
            'All Venues',
            options.venues,
            v => `${v.venue_name} (${v.state})`,
            v => v.venue_key
        );
    },

    getSalesDetailFilters() {
        return {
            state: document.getElementById('detail-state-filter').value,
            cluster: document.getElementById('detail-cluster-filter').value,
            cohort: document.getElementById('detail-cohort-filter').value,
            venue: document.getElementById('detail-venue-filter').value
        };
    },

    renderSalesDetail() {
        const filters = this.getSalesDetailFilters();
        const groupBy = document.getElementById('detail-group-by').value;
        const growthPct = Number(document.getElementById('detail-growth-input').value || 0);
        const rows = SalesAnalysisEngine.buildMonthlyRows(filters, groupBy, growthPct);
        const completionRows = SalesAnalysisEngine.buildCompletionRows(filters, groupBy);
        const summary = SalesAnalysisEngine.summarise(rows);

        const fmt = (v) => new Intl.NumberFormat('en-AU', {
            style: 'currency',
            currency: 'AUD',
            maximumFractionDigits: 0
        }).format(v || 0);
        const pct = (v) => v == null || !Number.isFinite(v) ? '-' : `${v.toFixed(1)}%`;

        document.getElementById('detail-kpi-fy27').textContent = fmt(summary.fy27);
        document.getElementById('detail-kpi-fy26').textContent = fmt(summary.fy26);
        document.getElementById('detail-kpi-growth').textContent = pct(summary.fy26 ? ((summary.fy27 - summary.fy26) / summary.fy26) * 100 : null);
        document.getElementById('detail-kpi-lfl').textContent = pct(summary.lflFy26 ? ((summary.lflFy27 - summary.lflFy26) / summary.lflFy26) * 100 : null);
        document.getElementById('detail-kpi-completion').textContent = fmt(summary.fy26Completion);

        document.getElementById('detail-status').textContent =
            `${rows.length.toLocaleString()} monthly comparison rows | ${completionRows.length.toLocaleString()} FY26 completion forecast rows | Scenario growth ${growthPct.toFixed(1)}%`;

        Charts.renderSalesDetailMonthly(rows);
        this.renderSalesDetailTable(rows);
        this.renderCompletionTable(completionRows);
    },

    renderSalesDetailTable(rows) {
        const thead = document.querySelector('#detail-sales-table thead');
        const tbody = document.querySelector('#detail-sales-table tbody');
        thead.innerHTML = `
            <tr>
                <th>Month</th>
                <th>Group</th>
                <th class="number">Venues</th>
                <th class="number">LFL Venues</th>
                <th class="number">FY26 Actual</th>
                <th class="number">FY26 Forecast Fill</th>
                <th class="number">FY26 Comparator</th>
                <th class="number">FY27 Forecast</th>
                <th class="number">FY27 Scenario</th>
                <th class="number">Total Growth</th>
                <th class="number">Scenario Growth</th>
                <th class="number">LFL Growth</th>
            </tr>
        `;
        tbody.innerHTML = '';

        const fmt = (v) => '$' + Math.round(v || 0).toLocaleString();
        const pct = (v) => v == null || !Number.isFinite(v) ? '-' : `${v.toFixed(1)}%`;
        for (const row of rows) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${row.month}</td>
                <td>${row.group}</td>
                <td class="number">${row.venue_count}</td>
                <td class="number">${row.lfl_venue_count}</td>
                <td class="number">${fmt(row.fy26_actual_sales)}</td>
                <td class="number">${fmt(row.fy26_completion_forecast)}</td>
                <td class="number">${fmt(row.fy26_total_sales)}</td>
                <td class="number">${fmt(row.fy27_forecast_sales)}</td>
                <td class="number">${fmt(row.fy27_scenario_sales)}</td>
                <td class="number ${row.total_growth_pct >= 0 ? 'positive' : 'negative'}">${pct(row.total_growth_pct)}</td>
                <td class="number ${row.scenario_growth_pct >= 0 ? 'positive' : 'negative'}">${pct(row.scenario_growth_pct)}</td>
                <td class="number ${row.lfl_growth_pct >= 0 ? 'positive' : 'negative'}">${pct(row.lfl_growth_pct)}</td>
            `;
            tbody.appendChild(tr);
        }
    },

    renderCompletionTable(rows) {
        const thead = document.querySelector('#detail-completion-table thead');
        const tbody = document.querySelector('#detail-completion-table tbody');
        thead.innerHTML = `
            <tr>
                <th>Date</th>
                <th>Group</th>
                <th class="number">Forecast Sales</th>
                <th class="number">API Model Sales</th>
                <th class="number">Local Fallback Sales</th>
            </tr>
        `;
        tbody.innerHTML = '';

        const fmt = (v) => '$' + Math.round(v || 0).toLocaleString();
        for (const row of rows.slice(0, 500)) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${row.date}</td>
                <td>${row.group}</td>
                <td class="number">${fmt(row.forecast_sales)}</td>
                <td class="number">${fmt(row.source_api_sales)}</td>
                <td class="number">${fmt(row.source_local_sales)}</td>
            `;
            tbody.appendChild(tr);
        }
        if (rows.length > 500) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td colspan="5">Showing first 500 of ${rows.length.toLocaleString()} completion rows. Use filters or group by month/state/cluster to narrow.</td>`;
            tbody.appendChild(tr);
        }
    },

    applyDetailGrowthAssumption() {
        if (!ExcelParser.uploads.venue_details) return;
        const filters = this.getSalesDetailFilters();
        const venues = SalesAnalysisEngine.selectedVenues(filters);
        const growthPct = Number(document.getElementById('detail-growth-input').value || 0);
        const growthValue = growthPct / 100;
        const monthlyGrowth = ExcelParser.uploads.venue_details.monthlyGrowth || {};

        for (const venue of venues) {
            monthlyGrowth[venue.venue_key] = Array(CONFIG.RAMP_UP_MONTHS).fill(growthValue);
        }
        ExcelParser.uploads.venue_details.monthlyGrowth = monthlyGrowth;
        document.getElementById('detail-status').textContent =
            `Updated loaded monthly growth assumptions for ${venues.length.toLocaleString()} venues to ${growthPct.toFixed(1)}%. Regenerate the budget to flow this through P&L.`;
        if (this.budgetReady) this.renderSalesDetail();
    },

    renderVenueTable(venues) {
        const tbody = document.querySelector('#venue-table tbody');
        tbody.innerHTML = '';

        const now = new Date();
        for (const v of venues) {
            const openDate = new Date(v.opening_date);
            const monthsOpen = Math.max(0,
                (now.getFullYear() - openDate.getFullYear()) * 12 + (now.getMonth() - openDate.getMonth())
            );
            const isMature = monthsOpen >= CONFIG.RAMP_UP_MONTHS;

            const rampUp = ExcelParser.uploads.venue_details?.rampUp?.[v.venue_key];
            let currentRamp = isMature ? 1.0 : (rampUp && monthsOpen < rampUp.length ? rampUp[monthsOpen] : null);

            const salesData = ExcelParser.uploads.sales_history?.records?.filter(s => s.venue_key === v.venue_key) || [];
            const last90 = salesData.filter(s => {
                const d = new Date(s.sale_date);
                const diff = (now - d) / (1000 * 60 * 60 * 24);
                return diff <= 90;
            });
            const avgDaily = last90.length > 0
                ? last90.reduce((sum, s) => sum + s.gross_sales, 0) / last90.length
                : null;

            const tr = document.createElement('tr');
            tr.dataset.state = v.state;
            tr.dataset.maturity = isMature ? 'mature' : 'ramping';
            tr.innerHTML = `
                <td>${v.venue_name}</td>
                <td>${v.state}</td>
                <td>${v.opening_date}</td>
                <td class="number">${monthsOpen}</td>
                <td>${isMature ? '<span style="color:var(--success)">Mature</span>' : '<span style="color:var(--warning)">Ramping</span>'}</td>
                <td class="number">${currentRamp != null ? (currentRamp * 100).toFixed(0) + '%' : '—'}</td>
                <td class="number">${avgDaily != null ? '$' + Math.round(avgDaily).toLocaleString() : '—'}</td>
            `;
            tbody.appendChild(tr);
        }
    },

    filterVenueTable() {
        const state = document.getElementById('filter-state').value;
        const maturity = document.getElementById('filter-maturity').value;
        document.querySelectorAll('#venue-table tbody tr').forEach(tr => {
            const matchState = !state || tr.dataset.state === state;
            const matchMat = !maturity || tr.dataset.maturity === maturity;
            tr.style.display = matchState && matchMat ? '' : 'none';
        });
    },

    renderPnlTable() {
        const venueKey = document.getElementById('pnl-venue-filter').value;
        const view = document.getElementById('pnl-view').value;
        const pnl = PnlBuilder.getPnlTable(venueKey, view);

        const thead = document.querySelector('#pnl-table thead');
        const tbody = document.querySelector('#pnl-table tbody');

        let headerHtml = '<tr><th>Category</th><th>Line Item</th>';
        for (const m of pnl.months) headerHtml += `<th class="number">${m.label}</th>`;
        headerHtml += '<th class="number">Total</th></tr>';
        thead.innerHTML = headerHtml;

        tbody.innerHTML = '';
        // Accounting format: positive normal, negative wrapped in parens. Big numbers in K/M.
        const fmt = (v) => {
            const av = Math.abs(v);
            let s;
            if (av >= 1000000) s = '$' + (av / 1000000).toFixed(1) + 'M';
            else if (av >= 1000) s = '$' + (av / 1000).toFixed(0) + 'K';
            else s = '$' + Math.round(av).toLocaleString();
            return v < 0 ? `(${s})` : s;
        };

        for (const row of pnl.rows) {
            const tr = document.createElement('tr');
            if (row.type === 'subtotal' || row.type === 'total') tr.className = 'line-item-subtotal';
            if (row.type === 'revenue') tr.className = 'line-item-header';

            let html = `<td>${row.account_category || 'Uncategorised'}</td><td>${row.label}</td>`;
            for (const m of pnl.months) {
                const val = row.values[m.key] || 0;
                html += `<td class="number">${fmt(ExportEngine.signedAmount(row, val))}</td>`;
            }
            html += `<td class="number" style="font-weight:600">${fmt(ExportEngine.signedAmount(row, row.total))}</td>`;
            tr.innerHTML = html;
            tbody.appendChild(tr);
        }

        if (ExcelParser.uploads.prior_pnl) {
            document.querySelector('.pnl-comparison').style.display = 'block';
            this.renderVarianceTable(venueKey);
        }
    },

    renderVarianceTable(venueKey) {
        const variance = PnlBuilder.getVarianceTable(venueKey);
        const thead = document.querySelector('#variance-table thead');
        const tbody = document.querySelector('#variance-table tbody');

        thead.innerHTML = '<tr><th>Line Item</th><th class="number">Budget</th><th class="number">Prior Year Annualised</th><th class="number">Variance $</th><th class="number">Variance %</th></tr>';
        tbody.innerHTML = '';

        // Accounting-style format: positive as "$1,234", negative as "($1,234)".
        const fmt = (v) => {
            const n = Math.round(v || 0);
            if (n < 0) return `($${Math.abs(n).toLocaleString()})`;
            return `$${n.toLocaleString()}`;
        };
        const fmtPct = (v) => {
            if (v == null || !Number.isFinite(v)) return '-';
            const n = v.toFixed(1);
            return v < 0 ? `(${Math.abs(v).toFixed(1)}%)` : `${n}%`;
        };

        for (const row of variance) {
            const tr = document.createElement('tr');
            if (row.type === 'subtotal' || row.type === 'total') tr.className = 'line-item-subtotal';

            // Variance sign: positive = favourable (green), negative = unfavourable (red)
            const varClass = row.variance >= 0 ? 'positive' : 'negative';
            tr.innerHTML = `
                <td>${row.label}</td>
                <td class="number">${fmt(row.budget)}</td>
                <td class="number">${fmt(row.prior)}</td>
                <td class="number ${varClass}">${fmt(row.variance)}</td>
                <td class="number ${varClass}">${fmtPct(row.variancePct)}</td>
            `;
            tbody.appendChild(tr);
        }
    },

    renderDashboard() {
        this.updateKPIs();
        Charts.renderAllDashboardCharts();
    },

    renderForecastDiagnostics() {
        const table = document.getElementById('forecast-diagnostics-table');
        if (!table) return;
        const thead = table.querySelector('thead');
        const tbody = table.querySelector('tbody');
        const status = document.getElementById('forecast-api-status');

        const stats = SalesForecastEngine.apiCallStats || {};
        const rows = SalesForecastEngine.getDiagnosticsTable();
        const usingApi = SalesForecastEngine.useApi;

        if (status) {
            const venuesViaApi = Object.keys(SalesForecastEngine.apiForecasts || {}).length;
            const totalVenues = Object.keys(SalesForecastEngine.baseDailySales || {}).length || venuesViaApi;
            const localFallback = Math.max(0, totalVenues - venuesViaApi);
            status.textContent = usingApi
                ? `API: ${venuesViaApi}/${totalVenues} venues | ${stats.batches || 0} batches | ${stats.retries || 0} retries | ${stats.failures || 0} failures | ${(stats.totalMs / 1000).toFixed(1)}s | local fallback: ${localFallback}`
                : 'Local seasonality model only (no API forecast).';
            status.className = 'forecast-api-status ' + (stats.failures > 0 ? 'warning' : 'ok');
        }

        thead.innerHTML = `
            <tr>
                <th>Venue</th>
                <th>Model</th>
                <th class="number">History days</th>
                <th class="number">Avg daily ($)</th>
                <th class="number">RMSE ($)</th>
                <th class="number">RMSE / avg</th>
                <th class="number">CV</th>
                <th>Warnings</th>
            </tr>`;
        tbody.innerHTML = '';
        if (!rows.length) {
            const tr = document.createElement('tr');
            tr.innerHTML = '<td colspan="8">No API diagnostics — re-run the budget with the forecast API enabled.</td>';
            tbody.appendChild(tr);
            return;
        }
        const fmt = (v) => v == null ? '—' : '$' + Math.round(v).toLocaleString();
        const pct = (v) => v == null ? '—' : `${(v * 100).toFixed(1)}%`;
        const num = (v) => v == null ? '—' : Number(v).toFixed(3);

        for (const r of rows) {
            const tr = document.createElement('tr');
            if (r.low_confidence) tr.style.background = 'rgba(239,68,68,0.10)';
            tr.innerHTML = `
                <td>${r.venue_key}</td>
                <td>${r.model || '—'}</td>
                <td class="number">${r.history_days}</td>
                <td class="number">${fmt(r.base_daily_sales)}</td>
                <td class="number">${fmt(r.rmse)}</td>
                <td class="number">${pct(r.rmse_pct_of_avg)}</td>
                <td class="number">${num(r.cv)}</td>
                <td>${(r.warnings || []).join('; ')}</td>`;
            tbody.appendChild(tr);
        }
    },

    showPreview(key, result) {
        const container = document.getElementById('upload-preview');
        const content = document.getElementById('preview-content');
        container.style.display = 'block';

        const records = result.records || result.venues || [];
        const sample = records.slice(0, 10);

        if (sample.length === 0) {
            content.innerHTML = '<p>No records parsed</p>';
            return;
        }

        const keys = Object.keys(sample[0]).filter(k => k !== 'venue_key');
        let html = `<p><strong>${key}</strong>: ${records.length} records (showing first 10)</p>`;
        html += '<table><thead><tr>';
        for (const k of keys) html += `<th>${k}</th>`;
        html += '</tr></thead><tbody>';

        for (const row of sample) {
            html += '<tr>';
            for (const k of keys) {
                const v = row[k];
                html += `<td>${v != null ? v : ''}</td>`;
            }
            html += '</tr>';
        }
        html += '</tbody></table>';
        content.innerHTML = html;
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
