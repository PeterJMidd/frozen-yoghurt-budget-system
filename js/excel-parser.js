const ExcelParser = {
    uploads: {},

    readFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
                    resolve(wb);
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = () => reject(new Error('File read failed'));
            reader.readAsArrayBuffer(file);
        });
    },

    normaliseVenueName(name) {
        if (!name) return '';
        return String(name).trim().toLowerCase().replace(/\s+/g, ' ');
    },

    // Parse a percent input that may arrive as a fraction (0.05) or whole-number percent (5).
    // Heuristic: if abs(value) > 1, treat as percent and divide by 100. Otherwise treat as fraction.
    // Pass `treatAs='percent'` to force divide-by-100, or `'fraction'` to leave as-is.
    parsePct(value, treatAs) {
        const n = Number(value);
        if (!Number.isFinite(n)) return 0;
        if (treatAs === 'fraction') return n;
        if (treatAs === 'percent') return n / 100;
        return Math.abs(n) > 1 ? n / 100 : n;
    },

    // Clamp a value to the band [min, max]. Returns { value, original, clamped, reason }.
    // If the value is outside the band, snaps to nearest edge and flags clamped=true.
    clampToBand(value, band) {
        if (!band || value == null || !Number.isFinite(value)) return { value, clamped: false };
        if (value < band.min) return { value: band.min, original: value, clamped: true, reason: 'below band' };
        if (value > band.max) return { value: band.max, original: value, clamped: true, reason: 'above band' };
        return { value, clamped: false };
    },

    // Apply clamping in place over a list of records. mapper(r) -> { field, band }.
    // Mutates record[field] and returns a list of clamp logs.
    applyClampsInPlace(records, mapper) {
        const clamps = [];
        for (const r of records) {
            const spec = mapper(r);
            if (!spec || !spec.band) continue;
            const result = this.clampToBand(r[spec.field], spec.band);
            if (result.clamped) {
                clamps.push({
                    venue: r.venue_name || r.venue_key,
                    field: spec.label || spec.field,
                    original: result.original,
                    corrected: result.value,
                    reason: result.reason,
                    band: spec.band
                });
                r[spec.field] = result.value;
            }
        }
        return clamps;
    },

    // Skip rows whose first cell is a totals/summary marker.
    isTotalsRow(label) {
        const s = String(label || '').trim().toLowerCase();
        if (!s) return true;
        return [
            'total', 'totals', 'sum', 'subtotal', 'sub-total', 'sub total',
            'grand total', 'period total', 'ytd', 'year to date'
        ].includes(s);
    },

    isExcludedVenueName(name) {
        const key = this.normaliseVenueName(name);
        if (!key) return false;
        return (CONFIG.EXCLUDED_VENUE_KEYS || []).some(excluded =>
            key === excluded || key.includes(excluded)
        );
    },

    formatDate(d) {
        if (!d) return null;
        if (d instanceof Date) {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        }
        if (typeof d === 'number') {
            const date = XLSX.SSF.parse_date_code(d);
            return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
        }
        return String(d);
    },

    firstOfMonth(d) {
        if (d instanceof Date) {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            return `${y}-${m}-01`;
        }
        const str = this.formatDate(d);
        if (str && str.length >= 7) return str.substring(0, 7) + '-01';
        return str;
    },

    sheetToRows(wb, sheetName) {
        const ws = wb.Sheets[sheetName || wb.SheetNames[0]];
        if (!ws) return [];
        return XLSX.utils.sheet_to_json(ws, { defval: null });
    },

    // 1. Sales History: rows=venues, columns=dates.
    //
    // Supports sheet layouts:
    //   (a) Single-sheet legacy: combined revenue per date (treated as servings)
    //   (b) Two-sheet: 'Servings' + 'Retail'
    //   (c) Three-sheet: 'Servings' + 'Retail' + 'POS Discounts' (preferred — enables
    //       the Net Servings stream filter = Servings − POS Discounts).
    //
    // Output: ONE record per (venue, date) with four amount fields:
    //   gross_sales          = servings + retail (back-compat — what consumers see by default)
    //   gross_sales_servings = servings stream alone (Y1YS)
    //   gross_sales_retail   = retail stream alone (Y1RS)
    //   pos_discounts        = POS discount giveback (Y1POSD; positive number)
    parseSalesHistory(wb) {
        const errors = [];
        let firstDate = null;
        let lastDate = null;

        const findSheet = (name) => wb.SheetNames.find(s => s.trim().toLowerCase() === name);
        const servSheet = findSheet('servings') || findSheet('yogurt') || findSheet('yogurt sales');
        const retailSheet = findSheet('retail') || findSheet('retail sales');
        const discSheet = findSheet('pos discounts') || findSheet('discounts');

        const sheetMap = [];
        if (servSheet) sheetMap.push({ name: servSheet, kind: 'servings' });
        if (retailSheet) sheetMap.push({ name: retailSheet, kind: 'retail' });
        if (discSheet) sheetMap.push({ name: discSheet, kind: 'discount' });
        if (!sheetMap.length) sheetMap.push({ name: wb.SheetNames[0], kind: 'servings' });

        // Accumulate per (venue, date) into a map keyed by `venueKey|date`.
        const byKey = new Map();
        const ensure = (venueName, venueKey, dateStr) => {
            const k = `${venueKey}|${dateStr}`;
            let cur = byKey.get(k);
            if (!cur) {
                cur = {
                    venue_name: venueName, venue_key: venueKey, sale_date: dateStr,
                    gross_sales: 0, gross_sales_servings: 0, gross_sales_retail: 0,
                    pos_discounts: 0
                };
                byKey.set(k, cur);
            }
            return cur;
        };

        const FIELD_BY_KIND = {
            servings: 'gross_sales_servings',
            retail:   'gross_sales_retail',
            discount: 'pos_discounts'
        };

        for (const { name, kind } of sheetMap) {
            const ws = wb.Sheets[name];
            if (!ws) continue;
            const data = XLSX.utils.sheet_to_json(ws, { header: 1, cellDates: true });
            if (data.length < 2) {
                errors.push(`Sheet "${name}": needs a header row and at least one venue row`);
                continue;
            }
            const headers = data[0];
            const dateColumns = [];
            for (let c = 1; c < headers.length; c++) {
                const dateStr = this.formatDate(headers[c]);
                if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                    dateColumns.push({ col: c, date: dateStr });
                }
            }
            if (!dateColumns.length) {
                errors.push(`Sheet "${name}": no valid date columns found`);
                continue;
            }
            if (!firstDate || dateColumns[0].date < firstDate) firstDate = dateColumns[0].date;
            const last = dateColumns[dateColumns.length - 1].date;
            if (!lastDate || last > lastDate) lastDate = last;

            const field = FIELD_BY_KIND[kind];
            for (let r = 1; r < data.length; r++) {
                const row = data[r];
                const venueName = String(row[0] || '').trim();
                if (!venueName) continue;
                if (this.isExcludedVenueName(venueName)) continue;
                const venueKey = this.normaliseVenueName(venueName);
                for (const dc of dateColumns) {
                    const val = row[dc.col];
                    if (val == null || val === '') continue;
                    const v = Number(val);
                    if (isNaN(v)) continue;
                    const rec = ensure(venueName, venueKey, dc.date);
                    rec[field] += v;
                    // gross_sales only counts revenue streams (servings + retail), NOT the
                    // discount giveback (that's a cost line, separately tracked).
                    if (kind !== 'discount') rec.gross_sales += v;
                }
            }
        }

        const records = [...byKey.values()].map(r => ({
            ...r,
            gross_sales:           Math.round(r.gross_sales * 100) / 100,
            gross_sales_servings:  Math.round(r.gross_sales_servings * 100) / 100,
            gross_sales_retail:    Math.round(r.gross_sales_retail * 100) / 100,
            pos_discounts:         Math.round(r.pos_discounts * 100) / 100,
            // Convenience: Net Servings = Servings − POS Discounts.
            net_servings:          Math.round((r.gross_sales_servings - r.pos_discounts) * 100) / 100
        }));

        return {
            records,
            errors,
            dateRange: { start: firstDate, end: lastDate },
            streams: [...new Set(sheetMap.map(s => s.kind))]
        };
    },

    // 2. Prior P&L: one sheet per venue, rows=line items, columns=months
    parsePriorPnl(wb) {
        const records = [];
        const errors = [];

        for (const sheetName of wb.SheetNames) {
            if (sheetName.toLowerCase() === 'instructions') continue;
            const ws = wb.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(ws, { header: 1, cellDates: true });

            if (data.length < 2) continue;

            let venueName = sheetName.trim();
            let headerRowIndex = 0;
            if (String(data[0]?.[0] || '').trim().toLowerCase() === 'venue name' && data[0]?.[1]) {
                venueName = String(data[0][1]).trim();
                headerRowIndex = 1;
            }
            if (this.isExcludedVenueName(venueName)) continue;

            const headers = data[headerRowIndex];
            const monthColumns = [];
            for (let c = 1; c < headers.length; c++) {
                const h = headers[c];
                if (!h) continue;
                if (String(h).toLowerCase() === 'total') continue;
                const monthStr = this.firstOfMonth(h);
                if (monthStr) monthColumns.push({ col: c, month: monthStr });
            }

            for (let r = headerRowIndex + 1; r < data.length; r++) {
                const row = data[r];
                const lineItem = String(row[0] || '').trim();
                if (!lineItem) continue;
                if (this.isTotalsRow(lineItem)) continue;

                for (const mc of monthColumns) {
                    const val = row[mc.col];
                    if (val == null || val === '') continue;
                    const amount = Number(val);
                    if (isNaN(amount)) continue;
                    records.push({
                        venue_name: venueName,
                        venue_key: this.normaliseVenueName(venueName),
                        period_month: mc.month,
                        line_item: lineItem,
                        amount: Math.round(amount * 100) / 100
                    });
                }
            }
        }

        return { records, errors };
    },

    // 3. Venue Details: "Venues" sheet + "Ramp Up" sheet
    parseVenueDetails(wb) {
        const errors = [];
        const venues = [];
        const rampUp = {};
        const monthlyGrowth = {};
        const newVenueAssumptions = {};
        const venueByKey = {};

        const venueRows = this.sheetToRows(wb, 'Venues') || this.sheetToRows(wb);
        for (const row of venueRows) {
            const name = String(row.venue_name || row['Venue Name'] || row['Venue'] || '').trim();
            const state = String(row.state || row['State'] || '').trim().toUpperCase();
            const openingRaw = row.opening_date || row['Opening Date'] || row['opening date'];
            const openingDate = this.formatDate(openingRaw);
            const isActive = row.is_active !== false && row.is_active !== 'N' && row.is_active !== 0;

            if (!name) continue;
            if (this.isExcludedVenueName(name)) continue;
            if (!CONFIG.STATES.includes(state)) {
                errors.push(`Venue "${name}": invalid state "${state}"`);
                continue;
            }

            const venue = {
                venue_name: name,
                venue_key: this.normaliseVenueName(name),
                state,
                opening_date: openingDate,
                is_active: isActive
            };
            venues.push(venue);
            venueByKey[venue.venue_key] = venue;
        }

        const rampSheet = wb.Sheets['Ramp Up'] || wb.Sheets['RampUp'] || wb.Sheets['Ramp_Up'];
        if (rampSheet) {
            const rampData = XLSX.utils.sheet_to_json(rampSheet, { header: 1 });
            if (rampData.length >= 2) {
                for (let r = 1; r < rampData.length; r++) {
                    const row = rampData[r];
                    const name = String(row[0] || '').trim();
                    if (!name) continue;
                    if (this.isExcludedVenueName(name)) continue;
                    const key = this.normaliseVenueName(name);
                    rampUp[key] = [];
                    for (let m = 1; m <= 18; m++) {
                        const val = Number(row[m]);
                        rampUp[key].push(isNaN(val) ? 1.0 : val);
                    }
                }
            }
        }

        const growthSheet = wb.Sheets['Monthly Growth'] || wb.Sheets['Growth'] || wb.Sheets['Sales Growth'];
        if (growthSheet) {
            const growthData = XLSX.utils.sheet_to_json(growthSheet, { header: 1 });
            if (growthData.length >= 2) {
                for (let r = 1; r < growthData.length; r++) {
                    const row = growthData[r];
                    const name = String(row[0] || '').trim();
                    if (!name) continue;
                    if (this.isExcludedVenueName(name)) continue;
                    const key = this.normaliseVenueName(name);
                    monthlyGrowth[key] = [];
                    for (let m = 1; m <= 18; m++) {
                        const val = Number(row[m]);
                        monthlyGrowth[key].push(isNaN(val) ? 0 : val / 100);
                    }
                }
            }
        }

        const newVenueSheet = wb.Sheets['New Venues'] || wb.Sheets['New Stores'];
        if (newVenueSheet) {
            const rows = XLSX.utils.sheet_to_json(newVenueSheet, { defval: null, cellDates: true });
            for (const row of rows) {
                const name = String(row.venue_name || row['Venue Name'] || row['Venue'] || '').trim();
                if (!name) continue;
                if (this.isExcludedVenueName(name)) continue;

                const state = String(row.state || row['State'] || '').trim().toUpperCase();
                const openingDate = this.formatDate(row.opening_date || row['Opening Date'] || row['opening date']);
                const avgMonthlySales = Number(row.avg_monthly_sales || row['Average Monthly Sales'] || row['Avg Monthly Sales'] || 0);
                const similarVenue = String(row.similar_venue || row['Similar Venue'] || row['Similar Site'] || '').trim();
                const key = this.normaliseVenueName(name);
                const similarKey = this.normaliseVenueName(similarVenue);

                if (!CONFIG.STATES.includes(state)) {
                    errors.push(`New venue "${name}": invalid state "${state}"`);
                    continue;
                }
                if (!openingDate) {
                    errors.push(`New venue "${name}": missing opening date`);
                    continue;
                }

                if (!venueByKey[key]) {
                    const venue = {
                        venue_name: name,
                        venue_key: key,
                        state,
                        opening_date: openingDate,
                        is_active: true,
                        is_new_venue: true,
                        similar_venue_key: similarKey,
                        avg_monthly_sales: avgMonthlySales
                    };
                    venues.push(venue);
                    venueByKey[key] = venue;
                }

                newVenueAssumptions[key] = {
                    venue_key: key,
                    similar_venue_key: similarKey,
                    avg_monthly_sales: avgMonthlySales
                };

                if (!monthlyGrowth[key]) {
                    monthlyGrowth[key] = Array(CONFIG.RAMP_UP_MONTHS).fill(0.03);
                }
            }
        }

        return { venues, rampUp, monthlyGrowth, newVenueAssumptions, errors };
    },

    // 4. Average Ticket: rows=venues, columns=months
    parseAvgTicket(wb) {
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1, cellDates: true });
        const errors = [];
        const records = [];

        if (data.length < 2) return { records, errors };

        const headers = data[0];
        const monthColumns = [];
        for (let c = 1; c < headers.length; c++) {
            const monthStr = this.firstOfMonth(headers[c]);
            if (monthStr) monthColumns.push({ col: c, month: monthStr });
        }

        for (let r = 1; r < data.length; r++) {
            const row = data[r];
            const name = String(row[0] || '').trim();
            if (!name) continue;
            if (this.isExcludedVenueName(name)) continue;
            const key = this.normaliseVenueName(name);

            for (const mc of monthColumns) {
                const val = Number(row[mc.col]);
                if (isNaN(val) || val <= 0) continue;
                records.push({
                    venue_name: name,
                    venue_key: key,
                    budget_month: mc.month,
                    avg_ticket: Math.round(val * 100) / 100
                });
            }
        }

        return { records, errors };
    },

    // 5. Labour assumptions
    parseLabour(wb) {
        const rows = this.sheetToRows(wb);
        const errors = [];
        const records = [];

        for (const row of rows) {
            const name = String(row.venue_name || row['Venue Name'] || row['Venue'] || '').trim();
            if (!name) continue;
            if (this.isExcludedVenueName(name)) continue;

            records.push({
                venue_name: name,
                venue_key: this.normaliseVenueName(name),
                sales_per_labour_hr: Number(row.sales_per_labour_hr || row['Sales Per Labour Hour'] || row['SPLH'] || 0),
                avg_hourly_rate: Number(row.avg_hourly_rate || row['Avg Hourly Rate'] || row['Hourly Rate'] || 0),
                oncosts_pct: this.parsePct(row.oncosts_pct ?? row['Oncosts %'] ?? row['On Costs %'] ?? 0),
                mgmt_salary_monthly: Number(row.mgmt_salary_monthly || row['Mgmt Salary Monthly'] || row['Management Salary'] || 0),
                mgmt_oncosts_pct: this.parsePct(row.mgmt_oncosts_pct ?? row['Mgmt Oncosts %'] ?? row['Mgmt On Costs %'] ?? 0),
                award_enabled: String(row.award_enabled || row['Award Enabled'] || 'Y').trim().toUpperCase() !== 'N',
                award_employment_type: String(row.award_employment_type || row['Award Employment Type'] || CONFIG.FAST_FOOD_AWARD.default_employment_type).trim().toLowerCase(),
                award_level: Number(row.award_level || row['Award Level'] || CONFIG.FAST_FOOD_AWARD.default_level),
                average_age: Number(row.average_age || row['Average Age'] || CONFIG.FAST_FOOD_AWARD.default_average_age),
                award_weekday_rate: Number(row.award_weekday_rate || row['Award Weekday Rate'] || 0),
                award_saturday_rate: Number(row.award_saturday_rate || row['Award Saturday Rate'] || 0),
                award_sunday_rate: Number(row.award_sunday_rate || row['Award Sunday Rate'] || 0),
                award_public_holiday_rate: Number(row.award_public_holiday_rate || row['Award Public Holiday Rate'] || 0),
                award_increase_date: this.formatDate(row.award_increase_date || row['Award Increase Date'] || CONFIG.FAST_FOOD_AWARD.scheduled_increase_date),
                award_increase_pct: this.parsePct(
                    row.award_increase_pct ?? row['Award Increase %'] ?? CONFIG.FAST_FOOD_AWARD.scheduled_increase_pct
                )
            });
        }

        const bands = CONFIG.SANITY_BANDS || {};
        const clamps = [
            ...this.applyClampsInPlace(records, () => ({ field: 'oncosts_pct', label: 'oncosts_pct', band: bands.labour_oncosts })),
            ...this.applyClampsInPlace(records, () => ({ field: 'mgmt_oncosts_pct', label: 'mgmt_oncosts_pct', band: bands.mgmt_oncosts })),
            ...this.applyClampsInPlace(records, () => ({ field: 'award_increase_pct', label: 'award_increase_pct', band: bands.award_increase }))
        ];

        return { records, errors, clamps };
    },

    // 6. COGS assumptions
    parseCogs(wb) {
        const rows = this.sheetToRows(wb);
        const errors = [];
        const records = [];

        for (const row of rows) {
            const name = String(row.venue_name || row['Venue Name'] || row['Venue'] || '').trim();
            if (!name) continue;
            if (this.isExcludedVenueName(name)) continue;
            const key = this.normaliseVenueName(name);

            const categories = [
                { field: 'food_pct', alt: ['Food %', 'Food'], category: 'food' },
                { field: 'packaging_pct', alt: ['Packaging %', 'Packaging'], category: 'packaging' },
                { field: 'retail_pct', alt: ['Retail %', 'Retail'], category: 'retail' },
                { field: 'discount_pct', alt: ['Discount %', 'Discounts %', 'Sale Discounts %'], category: 'sale_discounts' }
            ];

            for (const cat of categories) {
                let val = row[cat.field];
                if (val == null) {
                    for (const alt of cat.alt) {
                        if (row[alt] != null) { val = row[alt]; break; }
                    }
                }
                records.push({
                    venue_name: name,
                    venue_key: key,
                    category: cat.category,
                    cogs_pct: this.parsePct(val)
                });
            }
        }

        const bands = CONFIG.SANITY_BANDS || {};
        const bandByCat = {
            food: bands.cogs_food, packaging: bands.cogs_packaging,
            retail: bands.cogs_retail, sale_discounts: bands.cogs_discounts
        };
        const clamps = this.applyClampsInPlace(records, r => ({
            field: 'cogs_pct',
            label: `cogs_${r.category}`,
            band: bandByCat[r.category]
        }));

        return { records, errors, clamps };
    },

    // 7. Rent assumptions
    parseRent(wb) {
        const rows = this.sheetToRows(wb);
        const errors = [];
        const records = [];

        for (const row of rows) {
            const name = String(row.venue_name || row['Venue Name'] || row['Venue'] || '').trim();
            if (!name) continue;
            if (this.isExcludedVenueName(name)) continue;

            records.push({
                venue_name: name,
                venue_key: this.normaliseVenueName(name),
                base_rent_monthly: Number(row.base_rent_monthly || row['Base Rent Monthly'] || row['Base Rent'] || 0),
                outgoings_monthly: Number(row.outgoings_monthly || row['Outgoings Monthly'] || row['Outgoings'] || 0),
                pct_rent_threshold: Number(row.pct_rent_threshold || row['% Rent Threshold'] || row['Pct Rent Threshold'] || 0),
                pct_rent_rate: this.parsePct(row.pct_rent_rate ?? row['% Rent Rate'] ?? row['Pct Rent Rate'] ?? 0),
                marketing_levy_pct: this.parsePct(row.marketing_levy_pct ?? row['Marketing Levy %'] ?? 0),
                // NEW: $ monthly marketing levy (preferred when non-zero — used for lease-fixed
                // centre marketing contributions which are $ amounts, not % of sales).
                marketing_levy_monthly: Number(row.marketing_levy_monthly ?? row['Marketing Levy Monthly'] ?? row['Marketing Levy'] ?? 0)
            });
        }

        const bands = CONFIG.SANITY_BANDS || {};
        const clamps = [
            // Only clamp the %-of-sales levy field. The $ monthly field is a dollar amount
            // and shouldn't be clamped on the same band.
            ...this.applyClampsInPlace(records, () => ({ field: 'marketing_levy_pct', label: 'marketing_levy_pct', band: bands.marketing_levy })),
            ...this.applyClampsInPlace(records, () => ({ field: 'pct_rent_rate', label: 'pct_rent_rate', band: bands.pct_rent_rate }))
        ];

        return { records, errors, clamps };
    },

    // 9. Optional: Pre-computed Prophet forecast (overrides API call).
    // Same shape as Sales History: 'Servings', 'Retail', 'POS Discounts' sheets,
    // rows=venues, columns=dates (forecast period — typically May 2026 → Jun 2027).
    // Output records per (venue, date): one with combined gross_sales for engine
    // injection plus per-stream amounts.
    parseProphetForecast(wb) {
        const errors = [];
        const records = [];
        const findSheet = (name) => wb.SheetNames.find(s => s.trim().toLowerCase() === name);
        const servSheet = findSheet('servings');
        const retailSheet = findSheet('retail');
        const discSheet = findSheet('pos discounts') || findSheet('discounts');

        const byKey = new Map();
        const ensure = (venueName, venueKey, dateStr) => {
            const k = `${venueKey}|${dateStr}`;
            let cur = byKey.get(k);
            if (!cur) {
                cur = {
                    venue_name: venueName, venue_key: venueKey, forecast_date: dateStr,
                    gross_sales: 0, gross_sales_servings: 0, gross_sales_retail: 0, pos_discounts: 0
                };
                byKey.set(k, cur);
            }
            return cur;
        };

        const FIELD = { servings: 'gross_sales_servings', retail: 'gross_sales_retail', discount: 'pos_discounts' };
        const sheets = [];
        if (servSheet)   sheets.push({ name: servSheet, kind: 'servings' });
        if (retailSheet) sheets.push({ name: retailSheet, kind: 'retail' });
        if (discSheet)   sheets.push({ name: discSheet, kind: 'discount' });
        if (!sheets.length) { errors.push('No Prophet forecast sheets found'); return { records, errors }; }

        for (const { name, kind } of sheets) {
            const ws = wb.Sheets[name];
            const data = XLSX.utils.sheet_to_json(ws, { header: 1, cellDates: true });
            if (data.length < 2) continue;
            const headers = data[0];
            const dateColumns = [];
            for (let c = 1; c < headers.length; c++) {
                const dateStr = this.formatDate(headers[c]);
                if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
                    dateColumns.push({ col: c, date: dateStr });
                }
            }
            const field = FIELD[kind];
            for (let r = 1; r < data.length; r++) {
                const row = data[r];
                const venueName = String(row[0] || '').trim();
                if (!venueName || this.isExcludedVenueName(venueName)) continue;
                const venueKey = this.normaliseVenueName(venueName);
                for (const dc of dateColumns) {
                    const v = Number(row[dc.col]);
                    if (isNaN(v)) continue;
                    const rec = ensure(venueName, venueKey, dc.date);
                    rec[field] += v;
                    if (kind !== 'discount') rec.gross_sales += v;
                }
            }
        }
        const out = [...byKey.values()].map(r => ({
            ...r,
            gross_sales: Math.round(r.gross_sales * 100) / 100,
            gross_sales_servings: Math.round(r.gross_sales_servings * 100) / 100,
            gross_sales_retail: Math.round(r.gross_sales_retail * 100) / 100,
            pos_discounts: Math.round(r.pos_discounts * 100) / 100,
            net_servings: Math.round((r.gross_sales_servings - r.pos_discounts) * 100) / 100
        }));
        return { records: out, errors };
    },

    parseOtherPnl(wb) {
        const rows = this.sheetToRows(wb, 'Assumptions') || this.sheetToRows(wb);
        const errors = [];
        const records = [];

        for (const row of rows) {
            const accountCode = String(row.account_code || row['Account Code'] || '').trim();
            const accountName = String(row.account_name || row['Account Name'] || '').trim();
            if (!accountCode && !accountName) continue;

            const active = String(row.active || row['Active'] || 'Y').trim().toUpperCase() !== 'N';
            const venueName = String(row.venue_name || row['Venue Name'] || row['Venue'] || '').trim();
            if (this.isExcludedVenueName(venueName)) continue;
            const allocationScope = String(row.allocation_scope || row['Allocation Scope'] || (venueName ? 'venue' : 'network_even')).trim().toLowerCase();
            const budgetMethod = String(row.budget_method || row['Budget Method'] || 'monthly_amount').trim().toLowerCase();
            const fallbackKey = `other_${String(`${accountCode}_${accountName}`).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').substring(0, 70)}`;
            const accountKey = String(row.account_key || row['Account Key'] || fallbackKey).trim();

            const record = {
                active,
                allocation_scope: allocationScope,
                tracking_category_option1: String(row.tracking_category_option1 || row['TrackingCategoryOption1'] || '').trim(),
                venue_name: venueName,
                venue_key: this.normaliseVenueName(venueName),
                account_code: accountCode,
                account_name: accountName,
                account_key: accountKey,
                account_type: String(row.account_type || row['Account Type'] || 'Expense').trim(),
                account_category: String(row.account_category || row['Account Category'] || row['Build_NAME_L4'] || 'Uncategorised').trim(),
                budget_method: budgetMethod,
                base_monthly_amount: Number(row.base_monthly_amount || row['Base Monthly Amount'] || 0),
                base_daily_amount: Number(row.base_daily_amount || row['Base Daily Amount'] || 0),
                pct_of_sales: this.parsePct(row.pct_of_sales ?? row['Pct of Sales'] ?? 0),
                effective_date: this.formatDate(row.effective_date || row['Effective Date'] || null),
                adjustment_type: String(row.adjustment_type || row['Adjustment Type'] || '').trim().toLowerCase(),
                adjustment_value: Number(row.adjustment_value || row['Adjustment Value'] || 0),
                recommendation: String(row.recommendation || row['Recommendation'] || '').trim(),
                notes: String(row.notes || row['Notes'] || '').trim()
            };

            // pct_of_sales already normalised by parsePct above
            if (record.allocation_scope === 'venue' && !record.venue_name) {
                errors.push(`${accountCode} ${accountName}: venue scope needs a venue_name`);
                continue;
            }
            records.push(record);
        }

        return { records, errors };
    },

    // Returns reasonableness warnings for a single uploaded template, by inspecting parsed records.
    // Warnings are non-blocking: they surface to the upload status to flag likely unit/data errors.
    // If parser auto-clamped values (parsed.clamps), include those as "AUTO-CORRECTED" lines.
    sanityWarnings(templateKey, parsed) {
        const bands = (CONFIG.SANITY_BANDS || {});
        const warnings = [];
        const venueLabel = (r) => r.venue_name || r.venue_key || '?';
        const fmtPct = (v) => Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : String(v);
        const checkBand = (label, value, band) => {
            if (value == null || !Number.isFinite(value) || !band) return;
            if (value < band.min || value > band.max) {
                warnings.push(`${label}: ${value} outside expected ${band.label} band (${band.min}–${band.max})`);
            }
        };

        // Surface auto-clamps first (more actionable than abstract band check on already-corrected data)
        for (const c of (parsed?.clamps || [])) {
            warnings.push(`AUTO-CORRECTED ${c.venue} ${c.field}: was ${fmtPct(c.original)} → capped to ${fmtPct(c.corrected)} (${c.reason}; band ${c.band.min}–${c.band.max})`);
        }

        const records = parsed?.records || [];
        if (templateKey === 'cogs') {
            for (const r of records) {
                if (r.category === 'food') checkBand(`COGS Food [${venueLabel(r)}]`, r.cogs_pct, bands.cogs_food);
                if (r.category === 'packaging') checkBand(`COGS Packaging [${venueLabel(r)}]`, r.cogs_pct, bands.cogs_packaging);
                if (r.category === 'retail') checkBand(`COGS Retail [${venueLabel(r)}]`, r.cogs_pct, bands.cogs_retail);
                if (r.category === 'sale_discounts') checkBand(`Discount [${venueLabel(r)}]`, r.cogs_pct, bands.cogs_discounts);
            }
        } else if (templateKey === 'labour') {
            for (const r of records) {
                checkBand(`SPLH [${venueLabel(r)}]`, r.sales_per_labour_hr, bands.splh);
                checkBand(`Hourly Rate [${venueLabel(r)}]`, r.avg_hourly_rate, bands.hourly_rate);
                checkBand(`Crew Oncosts [${venueLabel(r)}]`, r.oncosts_pct, bands.labour_oncosts);
                checkBand(`Mgmt Oncosts [${venueLabel(r)}]`, r.mgmt_oncosts_pct, bands.mgmt_oncosts);
                checkBand(`Mgmt Salary [${venueLabel(r)}]`, r.mgmt_salary_monthly, bands.mgmt_salary);
                checkBand(`Award Increase [${venueLabel(r)}]`, r.award_increase_pct, bands.award_increase);
            }
        } else if (templateKey === 'rent') {
            for (const r of records) {
                checkBand(`% Rent Rate [${venueLabel(r)}]`, r.pct_rent_rate, bands.pct_rent_rate);
                checkBand(`Marketing Levy [${venueLabel(r)}]`, r.marketing_levy_pct, bands.marketing_levy);
            }
        } else if (templateKey === 'prior_pnl') {
            const monthsByVenue = {};
            for (const r of records) {
                if (!monthsByVenue[r.venue_key]) monthsByVenue[r.venue_key] = new Set();
                monthsByVenue[r.venue_key].add(r.period_month);
            }
            for (const [venueKey, months] of Object.entries(monthsByVenue)) {
                if (months.size < 12) {
                    warnings.push(`Prior P&L coverage for "${venueKey}": only ${months.size} months — variance will be annualised`);
                }
            }
        } else if (templateKey === 'sales_history') {
            // Flag venues with very thin history (< 30 distinct days)
            const daysByVenue = {};
            for (const r of records) {
                if (!daysByVenue[r.venue_key]) daysByVenue[r.venue_key] = new Set();
                daysByVenue[r.venue_key].add(r.sale_date);
            }
            for (const [vk, days] of Object.entries(daysByVenue)) {
                if (days.size < 30) {
                    warnings.push(`Sales history for "${vk}": only ${days.size} day(s) — forecast will fall back to network average / similar venue`);
                }
            }
        }
        return warnings;
    },

    validateCrossTemplate() {
        const errors = [];
        const venueDetails = this.uploads.venue_details;
        if (!venueDetails) return ['Venue Details template must be uploaded first'];

        const masterKeys = new Set(venueDetails.venues.map(v => v.venue_key));
        const newVenueKeys = new Set(Object.keys(venueDetails.newVenueAssumptions || {}));

        const checkTemplate = (name, data, keyField) => {
            if (!data) return;
            const keys = new Set();
            for (const r of data) keys.add(r[keyField || 'venue_key']);
            for (const k of keys) {
                if (!masterKeys.has(k) && !newVenueKeys.has(k)) {
                    errors.push(`${name}: venue "${k}" not found in Venue Details`);
                }
            }
        };

        if (this.uploads.sales_history) checkTemplate('Sales History', this.uploads.sales_history.records, 'venue_key');
        if (this.uploads.avg_ticket) checkTemplate('Avg Ticket', this.uploads.avg_ticket.records, 'venue_key');
        if (this.uploads.labour) checkTemplate('Labour', this.uploads.labour.records, 'venue_key');
        if (this.uploads.cogs) checkTemplate('COGS', this.uploads.cogs.records, 'venue_key');
        if (this.uploads.rent) checkTemplate('Rent', this.uploads.rent.records, 'venue_key');
        if (this.uploads.other_pnl) {
            const venueRows = this.uploads.other_pnl.records.filter(r =>
                r.allocation_scope === 'venue' && r.active !== false
            );
            checkTemplate('Other P&L', venueRows, 'venue_key');
        }

        return errors;
    },

    getUploadSummary() {
        const summary = {};
        if (this.uploads.sales_history) {
            const s = this.uploads.sales_history;
            summary.sales_history = { records: s.records.length, dateRange: s.dateRange };
        }
        if (this.uploads.prior_pnl) {
            summary.prior_pnl = { records: this.uploads.prior_pnl.records.length };
        }
        if (this.uploads.venue_details) {
            summary.venue_details = { venues: this.uploads.venue_details.venues.length };
        }
        if (this.uploads.avg_ticket) {
            summary.avg_ticket = { records: this.uploads.avg_ticket.records.length };
        }
        if (this.uploads.labour) {
            summary.labour = { records: this.uploads.labour.records.length };
        }
        if (this.uploads.cogs) {
            summary.cogs = { records: this.uploads.cogs.records.length };
        }
        if (this.uploads.rent) {
            summary.rent = { records: this.uploads.rent.records.length };
        }
        if (this.uploads.other_pnl) {
            summary.other_pnl = { records: this.uploads.other_pnl.records.length };
        }
        return summary;
    }
};
