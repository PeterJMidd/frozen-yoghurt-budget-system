const LabourCalcEngine = {
    calculate(dailyForecasts, labourAssumptions) {
        const labourMap = {};
        for (const l of labourAssumptions) {
            labourMap[l.venue_key] = l;
        }

        for (const forecast of dailyForecasts) {
            const labour = labourMap[forecast.venue_key] ||
                (forecast.similar_venue_key ? labourMap[forecast.similar_venue_key] : null);
            if (!labour) {
                forecast.crew_labour_hours = 0;
                forecast.crew_labour_cost = 0;
                forecast.crew_oncosts = 0;
                forecast.mgmt_labour_cost = 0;
                forecast.mgmt_oncosts = 0;
                forecast.labour_total = 0;
                continue;
            }

            const daysInMonth = new Date(
                parseInt(forecast.forecast_date.substring(0, 4)),
                parseInt(forecast.forecast_date.substring(5, 7)),
                0
            ).getDate();

            const crewHours = labour.sales_per_labour_hr > 0
                ? forecast.net_sales / labour.sales_per_labour_hr
                : 0;

            const awardRate = this.getCrewHourlyRate(forecast, labour);
            const labourDayType = this.getLabourDayType(forecast);
            const crewHourlyRate = awardRate || labour.avg_hourly_rate;
            const crewCost = crewHours * crewHourlyRate;
            const crewOncosts = crewCost * labour.oncosts_pct;
            const mgmtDaily = labour.mgmt_salary_monthly / daysInMonth;
            const mgmtOncosts = mgmtDaily * labour.mgmt_oncosts_pct;

            forecast.crew_labour_hours = Math.round(crewHours * 100) / 100;
            forecast.crew_hourly_rate = Math.round(crewHourlyRate * 100) / 100;
            forecast.labour_day_type = labourDayType;
            forecast.labour_award_enabled = Boolean(awardRate);
            forecast.crew_labour_cost = Math.round(crewCost * 100) / 100;
            forecast.crew_oncosts = Math.round(crewOncosts * 100) / 100;
            forecast.mgmt_labour_cost = Math.round(mgmtDaily * 100) / 100;
            forecast.mgmt_oncosts = Math.round(mgmtOncosts * 100) / 100;
            forecast.labour_total = Math.round((crewCost + crewOncosts + mgmtDaily + mgmtOncosts) * 100) / 100;
        }

        return dailyForecasts;
    },

    getCrewHourlyRate(forecast, labour) {
        if (labour.award_enabled === false) return null;

        const levelKey = `level_${labour.award_level || CONFIG.FAST_FOOD_AWARD.default_level}`;
        const awardLevel = CONFIG.FAST_FOOD_AWARD.rates[levelKey] || CONFIG.FAST_FOOD_AWARD.rates.level_1;
        const employmentType = labour.award_employment_type || CONFIG.FAST_FOOD_AWARD.default_employment_type;
        const rates = awardLevel[employmentType] || awardLevel.casual;
        const dayType = this.getLabourDayType(forecast);
        const overrideRate = labour[`award_${dayType}_rate`];
        const rate = overrideRate > 0 ? overrideRate : (rates[dayType] || rates.weekday);
        return this.applyAwardIncrease(rate, forecast, labour);
    },

    applyAwardIncrease(rate, forecast, labour) {
        const increaseDate = labour.award_increase_date || CONFIG.FAST_FOOD_AWARD.scheduled_increase_date;
        let increasePct = labour.award_increase_pct;
        if (increasePct == null || isNaN(increasePct)) {
            increasePct = CONFIG.FAST_FOOD_AWARD.scheduled_increase_pct || 0;
        }
        if (!increaseDate || String(forecast.forecast_date) < String(increaseDate)) {
            return rate;
        }
        return Math.round(rate * (1 + increasePct) * 100) / 100;
    },

    getLabourDayType(forecast) {
        if (forecast.public_holiday_name || CALENDARS.isPublicHoliday(forecast.forecast_date, forecast.state)) {
            return 'public_holiday';
        }

        const day = new Date(forecast.forecast_date).getDay();
        if (day === 6) return 'saturday';
        if (day === 0) return 'sunday';
        return 'weekday';
    }
};
