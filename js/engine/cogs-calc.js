const CogsCalcEngine = {
    // Two-stream COGS model:
    //   - Food & Packaging %: applied to NET Servings sales (yogurt revenue)
    //   - Retail COGS %:      applied to NET Retail sales (merchandise revenue)
    //   - Sale_Discounts %:   applied to NET Servings (discounts only on yogurt POS)
    //   - cogs_total = food + packaging + retail (excludes the giveback discount)
    //   - gross_profit = net_sales_total - cogs_total - discount_giveback
    buildVenueDiscountMap(cogsAssumptions) {
        const map = {};
        for (const c of cogsAssumptions || []) {
            if (c.category === 'sale_discounts') map[c.venue_key] = Number(c.cogs_pct || 0);
        }
        return map;
    },

    calculate(dailyForecasts, cogsAssumptions) {
        const cogsMap = {};
        for (const c of cogsAssumptions) {
            if (!cogsMap[c.venue_key]) cogsMap[c.venue_key] = {};
            cogsMap[c.venue_key][c.category] = c.cogs_pct;
        }

        for (const forecast of dailyForecasts) {
            const cogs = cogsMap[forecast.venue_key] ||
                (forecast.similar_venue_key ? cogsMap[forecast.similar_venue_key] : null) ||
                {};

            const netTotal = Number(forecast.net_sales || 0);
            const netServings = Number(forecast.net_sales_servings ?? netTotal);
            const netRetail = Number(forecast.net_sales_retail ?? 0);
            const grossServings = Number(forecast.gross_sales_servings ?? netServings);

            forecast.cogs_food = Math.round(netServings * (cogs.food || 0) * 100) / 100;
            forecast.cogs_packaging = Math.round(netServings * (cogs.packaging || 0) * 100) / 100;
            // Retail COGS applies ONLY to retail sales (e.g. cost of tubs/merch sold)
            forecast.cogs_retail = Math.round(netRetail * (cogs.retail || 0) * 100) / 100;
            // Discount giveback = gross_servings - net_servings (informational; not in cogs_total)
            forecast.cogs_discounts = Math.round((grossServings - netServings) * 100) / 100;
            forecast.cogs_total = Math.round(
                (forecast.cogs_food + forecast.cogs_packaging + forecast.cogs_retail) * 100
            ) / 100;
            forecast.gross_profit = Math.round(
                (netTotal - forecast.cogs_total - forecast.cogs_discounts) * 100
            ) / 100;
        }

        return dailyForecasts;
    }
};
