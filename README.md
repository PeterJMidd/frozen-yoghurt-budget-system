# Frozen Yoghurt Budget System

Static browser app for FY27 venue-level sales forecasting and P&L budget modelling.

## Launch

This repo is ready for GitHub Pages, Netlify, Vercel static hosting, or any static file host.

For GitHub Pages:

1. Push this repository to GitHub.
2. Open repository settings.
3. Go to Pages.
4. Set source to `main` branch and `/root`.
5. Open the published Pages URL.

## Before First Use

1. Create a Supabase project.
2. Run `schema.sql` in the Supabase SQL editor.
3. Open the app.
4. Enter the Supabase URL and anon key in the Export tab.
5. Enter the Render forecast API URL in the Upload tab.
6. Upload the core workbooks from `templates/`. The Other P&L workbook is optional, but should be used for a full P&L budget.
7. Generate the budget.
8. Export results or push to Supabase.

## Included Templates

The `templates/` folder contains FY27-ready workbooks generated from the supplied Australian venue files:

- `01_Sales_History_Template.xlsx`
- `02_Prior_PnL_Template.xlsx`
- `03_Venue_Details_Template.xlsx` - includes monthly growth modifiers, first-month zero ramp for new venues, and 17 FY27 new company venue examples
- `03_Venue_Details_Template_v2.xlsx` - compatibility copy of the same venue detail template
- `04_Avg_Ticket_Template.xlsx`
- `05_Labour_Template.xlsx` - Fast Food Award day-type rates for age 21+ casual Level 1 crew labour, with a configurable 4% scheduled increase from 1 July 2026
- `06_COGS_Template.xlsx` - FY26 actual COGS mix with a 0.5 percentage point improvement applied
- `07_Rent_Template.xlsx` - rent and outgoings uplifted by 3.5% CPI
- `08_Other_PnL_Template.xlsx` - venue-only template for uncovered GL P&L accounts, Build_NAME_L4 categories, 3.5% CPI operating cost baselines, recommendations, seasonality-annualised prior comparison, and dated adjustments

The updated zip bundle is included as `templates/frozen-yoghurt-budget-templates-fy27-v8.zip`.

The model excludes franchise/non-company venues Charlestown, Erina Fair, and Wollongong from uploads and generated assumptions.

## Backend

The frontend calls your Render forecast API at `/forecast-multi`. It sends each venue's loaded sales history, state public holidays, and historical/projected weather map so the Prophet/SARIMA API can use holiday and temperature regressors. The app can still run using the browser-only local seasonality fallback if the API URL is left blank or the API is unavailable; the venue template monthly growth modifiers are applied after either API or local forecasts.
