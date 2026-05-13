const CogsCalcEngine = {
    // COGS model:
    //   All COGS % values in the 06_COGS_Template are expressed as % of TOTAL net sales
    //   (derived that way from the FY26 GL actuals). Apply each to total net sales.
    //   - cogs_food, cogs_packaging, cogs_retail: % × total net sales
    //   - cogs_discounts: gross_servings − net_servings (the discount giveback)
    //   - cogs_total = food + packaging + retail (excludes the giveback)
    //   - gross_profit = net_sales − cogs_total − cogs_discounts
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
            const grossServings = Number(forecast.gross_sales_servings ?? netServings);

            forecast.cogs_food = Math.round(netTotal * (cogs.food || 0) * 100) / 100;
            forecast.cogs_packaging = Math.round(netTotal * (cogs.packaging || 0) * 100) / 100;
            forecast.cogs_retail = Math.round(netTotal * (cogs.retail || 0) * 100) / 100;
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
