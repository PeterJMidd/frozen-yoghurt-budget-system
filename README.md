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
- `03_Venue_Details_Template.xlsx`
- `03_Venue_Details_Template_v2.xlsx` - updated with monthly growth and new venue assumptions
- `04_Avg_Ticket_Template.xlsx`
- `05_Labour_Template.xlsx`
- `06_COGS_Template.xlsx`
- `07_Rent_Template.xlsx`
- `08_Other_PnL_Template.xlsx` - venue-only template for uncovered GL P&L accounts, Build_NAME_L4 categories, recommendations, seasonality-annualised prior comparison, and dated adjustments

The updated zip bundle is included as `templates/frozen-yoghurt-budget-templates-fy27-v6.zip`.

## Backend

The frontend calls your Render forecast API at `/forecast-multi`. The app can still run using the browser-only local seasonality fallback if the API URL is left blank or the API is unavailable.
