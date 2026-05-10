const CONFIG = {
    SUPABASE_URL: '',
    SUPABASE_ANON_KEY: '',

    // Your existing Render-hosted forecast API
    FORECAST_API_URL: 'https://venu-cast-api.onrender.com',

    BUDGET_YEAR_START: '2026-07-01',
    BUDGET_YEAR_END: '2027-06-30',

    OPEN_METEO_ARCHIVE_URL: 'https://archive-api.open-meteo.com/v1/archive',

    STATES: ['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'],

    FAST_FOOD_AWARD: {
        effective_from: '2025-07-01',
        default_level: 1,
        default_average_age: 21,
        default_employment_type: 'casual',
        rates: {
            level_1: {
                adult_base_rate: 26.55,
                permanent: {
                    weekday: 26.55,
                    saturday: 33.19,
                    sunday: 33.19,
                    public_holiday: 59.74
                },
                casual: {
                    weekday: 33.19,
                    saturday: 39.83,
                    sunday: 39.83,
                    public_holiday: 66.38
                }
            }
        }
    },

    STATE_COORDS: {
        NSW: { lat: -33.87, lon: 151.21 },
        VIC: { lat: -37.81, lon: 144.96 },
        QLD: { lat: -27.47, lon: 153.03 },
        SA:  { lat: -34.93, lon: 138.60 },
        WA:  { lat: -31.95, lon: 115.86 },
        TAS: { lat: -42.88, lon: 147.33 },
        NT:  { lat: -12.46, lon: 130.84 },
        ACT: { lat: -35.28, lon: 149.13 }
    },

    TEMP_BANDS: [
        { min: -Infinity, max: 10, label: '<10C' },
        { min: 10, max: 15, label: '10-15C' },
        { min: 15, max: 20, label: '15-20C' },
        { min: 20, max: 25, label: '20-25C' },
        { min: 25, max: 30, label: '25-30C' },
        { min: 30, max: 35, label: '30-35C' },
        { min: 35, max: Infinity, label: '35C+' }
    ],

    PNL_LINE_ITEMS: [
        { key: 'net_sales', label: 'Net Sales', type: 'revenue', account_category: '1.0 Trade Revenue' },
        { key: 'cogs_food', label: 'COGS - Food', type: 'cogs', account_category: '2.0 Servings Cost' },
        { key: 'cogs_packaging', label: 'COGS - Packaging', type: 'cogs', account_category: '2.1 Packaging Cost' },
        { key: 'cogs_retail', label: 'COGS - Retail', type: 'cogs', account_category: '2.3 Retail Costs' },
        { key: 'cogs_discounts', label: 'COGS - Discounts', type: 'cogs', account_category: '1.0 Trade Revenue' },
        { key: 'cogs_total', label: 'Total COGS', type: 'subtotal', account_category: '2 Cost of Sales' },
        { key: 'gross_profit', label: 'Gross Profit', type: 'subtotal', account_category: 'Gross Profit' },
        { key: 'crew_labour_cost', label: 'Labour - Crew', type: 'labour', account_category: '3.1 Wages & Salaries' },
        { key: 'crew_oncosts', label: 'Labour - Crew Oncosts', type: 'labour', account_category: '3.1 Wages & Salaries' },
        { key: 'mgmt_labour_cost', label: 'Labour - Management', type: 'labour', account_category: '3.1 Wages & Salaries' },
        { key: 'mgmt_oncosts', label: 'Labour - Mgmt Oncosts', type: 'labour', account_category: '3.1 Wages & Salaries' },
        { key: 'labour_total', label: 'Total Labour', type: 'subtotal', account_category: '3.1 Wages & Salaries' },
        { key: 'rent_base', label: 'Occupancy - Base Rent', type: 'occupancy', account_category: '3.2 Property Expenses' },
        { key: 'rent_outgoings', label: 'Occupancy - Outgoings', type: 'occupancy', account_category: '3.2 Property Expenses' },
        { key: 'rent_percentage', label: 'Occupancy - % Rent', type: 'occupancy', account_category: '3.2 Property Expenses' },
        { key: 'rent_marketing_levy', label: 'Occupancy - Marketing Levy', type: 'occupancy', account_category: '3.2 Property Expenses' },
        { key: 'occupancy_total', label: 'Total Occupancy', type: 'subtotal', account_category: '3.2 Property Expenses' },
        { key: 'venue_contribution', label: 'Venue Contribution', type: 'total', account_category: 'Venue Contribution' }
    ],

    SUPABASE_BATCH_SIZE: 500,
    RAMP_UP_MONTHS: 18,
    FORECAST_BATCH_SIZE: 10,  // venues per API call to forecast-multi

    DAYS_OF_WEEK: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    MONTHS: ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
};
