const CogsCalcEngine = {
    // Discount % is a contra-revenue line:
    //   gross_sales = forecast / (1 - discount_pct)   [done in SalesForecastEngine]
    //   cogs_discounts = gross_sales - net_sales      [the giveback amount, displayed but NOT in cogs_total]
    //   COGS % (food/packaging/retail) apply to NET sales
    //   cogs_total = food + packaging + retail
    //   gross_profit = net_sales - cogs_total
    //
    // This avoids the prior bug where discounts were both netting revenue AND counted as a cost.
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

            const net = Number(forecast.net_sales || 0);
            const gross = Number(forecast.gross_sales || net);

            forecast.cogs_food = Math.round(net * (cogs.food || 0) * 100) / 100;
            forecast.cogs_packaging = Math.round(net * (cogs.packaging || 0) * 100) / 100;
            forecast.cogs_retail = Math.round(net * (cogs.retail || 0) * 100) / 100;
            // Discount is the giveback: gross - net. Shown for transparency. Not added to cogs_total.
            forecast.cogs_discounts = Math.round((gross - net) * 100) / 100;
            forecast.cogs_total = Math.round(
                (forecast.cogs_food + forecast.cogs_packaging + forecast.cogs_retail) * 100
            ) / 100;
            forecast.gross_profit = Math.round((net - forecast.cogs_total) * 100) / 100;
        }

        return dailyForecasts;
    }
};
