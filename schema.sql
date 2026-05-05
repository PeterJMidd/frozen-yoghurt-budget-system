-- Frozen Yoghurt QSR Budget Model — Supabase Schema
-- Run this once in your Supabase SQL Editor before pushing budget data.

CREATE TABLE IF NOT EXISTS venues (
    venue_id        SERIAL PRIMARY KEY,
    venue_name      TEXT NOT NULL UNIQUE,
    state           TEXT NOT NULL,
    opening_date    DATE NOT NULL,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS venue_ramp_up (
    venue_id        INT REFERENCES venues(venue_id),
    month_number    INT NOT NULL CHECK (month_number BETWEEN 1 AND 18),
    multiplier      NUMERIC(5,4) NOT NULL,
    PRIMARY KEY (venue_id, month_number)
);

CREATE TABLE IF NOT EXISTS budget_runs (
    run_id          SERIAL PRIMARY KEY,
    run_name        TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    parameters      JSONB
);

CREATE TABLE IF NOT EXISTS sales_history (
    venue_id        INT REFERENCES venues(venue_id),
    sale_date       DATE NOT NULL,
    gross_sales     NUMERIC(12,2) NOT NULL,
    transaction_count INT,
    PRIMARY KEY (venue_id, sale_date)
);

CREATE TABLE IF NOT EXISTS weather_data (
    state           TEXT NOT NULL,
    observation_date DATE NOT NULL,
    max_temp_c      NUMERIC(4,1),
    min_temp_c      NUMERIC(4,1),
    rainfall_mm     NUMERIC(6,1),
    sunshine_hours  NUMERIC(4,1),
    PRIMARY KEY (state, observation_date)
);

CREATE TABLE IF NOT EXISTS seasonality_indices (
    run_id          INT REFERENCES budget_runs(run_id),
    venue_id        INT REFERENCES venues(venue_id),
    day_of_week     INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    month_of_year   INT NOT NULL CHECK (month_of_year BETWEEN 1 AND 12),
    is_school_holiday BOOLEAN DEFAULT FALSE,
    is_public_holiday BOOLEAN DEFAULT FALSE,
    index_value     NUMERIC(8,6) NOT NULL,
    PRIMARY KEY (run_id, venue_id, day_of_week, month_of_year, is_school_holiday, is_public_holiday)
);

CREATE TABLE IF NOT EXISTS prior_pnl (
    venue_id        INT REFERENCES venues(venue_id),
    period_month    DATE NOT NULL,
    line_item       TEXT NOT NULL,
    amount          NUMERIC(12,2) NOT NULL,
    PRIMARY KEY (venue_id, period_month, line_item)
);

CREATE TABLE IF NOT EXISTS avg_ticket_assumptions (
    run_id          INT REFERENCES budget_runs(run_id),
    venue_id        INT REFERENCES venues(venue_id),
    budget_month    DATE NOT NULL,
    avg_ticket      NUMERIC(8,2) NOT NULL,
    PRIMARY KEY (run_id, venue_id, budget_month)
);

CREATE TABLE IF NOT EXISTS labour_assumptions (
    run_id              INT REFERENCES budget_runs(run_id),
    venue_id            INT REFERENCES venues(venue_id),
    sales_per_labour_hr NUMERIC(8,2) NOT NULL,
    avg_hourly_rate     NUMERIC(8,2) NOT NULL,
    oncosts_pct         NUMERIC(5,4) NOT NULL,
    mgmt_salary_monthly NUMERIC(10,2) NOT NULL,
    mgmt_oncosts_pct    NUMERIC(5,4) NOT NULL,
    PRIMARY KEY (run_id, venue_id)
);

CREATE TABLE IF NOT EXISTS cogs_assumptions (
    run_id          INT REFERENCES budget_runs(run_id),
    venue_id        INT REFERENCES venues(venue_id),
    category        TEXT NOT NULL,
    cogs_pct        NUMERIC(5,4) NOT NULL,
    PRIMARY KEY (run_id, venue_id, category)
);

CREATE TABLE IF NOT EXISTS rent_assumptions (
    run_id          INT REFERENCES budget_runs(run_id),
    venue_id        INT REFERENCES venues(venue_id),
    base_rent_monthly    NUMERIC(10,2) NOT NULL,
    outgoings_monthly    NUMERIC(10,2) NOT NULL,
    pct_rent_threshold   NUMERIC(12,2),
    pct_rent_rate        NUMERIC(5,4),
    marketing_levy_pct   NUMERIC(5,4),
    PRIMARY KEY (run_id, venue_id)
);

CREATE TABLE IF NOT EXISTS daily_forecast (
    run_id              INT REFERENCES budget_runs(run_id),
    venue_id            INT REFERENCES venues(venue_id),
    forecast_date       DATE NOT NULL,
    forecast_transactions INT,
    avg_ticket          NUMERIC(8,2),
    gross_sales         NUMERIC(12,2),
    net_sales           NUMERIC(12,2),
    ramp_up_multiplier  NUMERIC(5,4),
    cogs_food           NUMERIC(10,2),
    cogs_packaging      NUMERIC(10,2),
    cogs_retail         NUMERIC(10,2),
    cogs_discounts      NUMERIC(10,2),
    cogs_total          NUMERIC(10,2),
    crew_labour_hours   NUMERIC(8,2),
    crew_labour_cost    NUMERIC(10,2),
    crew_oncosts        NUMERIC(10,2),
    mgmt_labour_cost    NUMERIC(10,2),
    mgmt_oncosts        NUMERIC(10,2),
    labour_total        NUMERIC(10,2),
    rent_base           NUMERIC(10,2),
    rent_outgoings      NUMERIC(10,2),
    rent_percentage     NUMERIC(10,2),
    rent_marketing_levy NUMERIC(10,2),
    occupancy_total     NUMERIC(10,2),
    gross_profit        NUMERIC(12,2),
    venue_contribution  NUMERIC(12,2),
    PRIMARY KEY (run_id, venue_id, forecast_date)
);

CREATE TABLE IF NOT EXISTS monthly_summary (
    run_id          INT REFERENCES budget_runs(run_id),
    venue_id        INT REFERENCES venues(venue_id),
    budget_month    DATE NOT NULL,
    net_sales       NUMERIC(14,2),
    cogs_total      NUMERIC(12,2),
    gross_profit    NUMERIC(14,2),
    labour_total    NUMERIC(12,2),
    occupancy_total NUMERIC(12,2),
    venue_contribution NUMERIC(14,2),
    transaction_count   INT,
    trading_days        INT,
    PRIMARY KEY (run_id, venue_id, budget_month)
);

CREATE INDEX IF NOT EXISTS idx_daily_forecast_date ON daily_forecast(run_id, forecast_date);
CREATE INDEX IF NOT EXISTS idx_daily_forecast_venue ON daily_forecast(run_id, venue_id);
CREATE INDEX IF NOT EXISTS idx_sales_history_date ON sales_history(sale_date);
CREATE INDEX IF NOT EXISTS idx_weather_state_date ON weather_data(state, observation_date);

-- Launch policies for the static app.
-- The browser app uses the Supabase anon key, so it needs explicit RLS policies.
-- Tighten these policies later if you add Supabase Auth and user-specific access.
GRANT USAGE ON SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO anon;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon;

ALTER TABLE venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_ramp_up ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasonality_indices ENABLE ROW LEVEL SECURITY;
ALTER TABLE prior_pnl ENABLE ROW LEVEL SECURITY;
ALTER TABLE avg_ticket_assumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE labour_assumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cogs_assumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rent_assumptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_forecast ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_summary ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon read venues" ON venues;
CREATE POLICY "anon read venues" ON venues FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "anon insert venues" ON venues;
CREATE POLICY "anon insert venues" ON venues FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "anon update venues" ON venues;
CREATE POLICY "anon update venues" ON venues FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon read venue_ramp_up" ON venue_ramp_up;
CREATE POLICY "anon read venue_ramp_up" ON venue_ramp_up FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "anon insert venue_ramp_up" ON venue_ramp_up;
CREATE POLICY "anon insert venue_ramp_up" ON venue_ramp_up FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "anon update venue_ramp_up" ON venue_ramp_up;
CREATE POLICY "anon update venue_ramp_up" ON venue_ramp_up FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon read budget_runs" ON budget_runs;
CREATE POLICY "anon read budget_runs" ON budget_runs FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "anon insert budget_runs" ON budget_runs;
CREATE POLICY "anon insert budget_runs" ON budget_runs FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "anon update budget_runs" ON budget_runs;
CREATE POLICY "anon update budget_runs" ON budget_runs FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon read sales_history" ON sales_history;
CREATE POLICY "anon read sales_history" ON sales_history FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "anon insert sales_history" ON sales_history;
CREATE POLICY "anon insert sales_history" ON sales_history FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "anon update sales_history" ON sales_history;
CREATE POLICY "anon update sales_history" ON sales_history FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon read weather_data" ON weather_data;
CREATE POLICY "anon read weather_data" ON weather_data FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "anon insert weather_data" ON weather_data;
CREATE POLICY "anon insert weather_data" ON weather_data FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "anon update weather_data" ON weather_data;
CREATE POLICY "anon update weather_data" ON weather_data FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon read seasonality_indices" ON seasonality_indices;
CREATE POLICY "anon read seasonality_indices" ON seasonality_indices FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "anon insert seasonality_indices" ON seasonality_indices;
CREATE POLICY "anon insert seasonality_indices" ON seasonality_indices FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "anon update seasonality_indices" ON seasonality_indices;
CREATE POLICY "anon update seasonality_indices" ON seasonality_indices FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon read prior_pnl" ON prior_pnl;
CREATE POLICY "anon read prior_pnl" ON prior_pnl FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "anon insert prior_pnl" ON prior_pnl;
CREATE POLICY "anon insert prior_pnl" ON prior_pnl FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "anon update prior_pnl" ON prior_pnl;
CREATE POLICY "anon update prior_pnl" ON prior_pnl FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon read avg_ticket_assumptions" ON avg_ticket_assumptions;
CREATE POLICY "anon read avg_ticket_assumptions" ON avg_ticket_assumptions FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "anon insert avg_ticket_assumptions" ON avg_ticket_assumptions;
CREATE POLICY "anon insert avg_ticket_assumptions" ON avg_ticket_assumptions FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "anon update avg_ticket_assumptions" ON avg_ticket_assumptions;
CREATE POLICY "anon update avg_ticket_assumptions" ON avg_ticket_assumptions FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon read labour_assumptions" ON labour_assumptions;
CREATE POLICY "anon read labour_assumptions" ON labour_assumptions FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "anon insert labour_assumptions" ON labour_assumptions;
CREATE POLICY "anon insert labour_assumptions" ON labour_assumptions FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "anon update labour_assumptions" ON labour_assumptions;
CREATE POLICY "anon update labour_assumptions" ON labour_assumptions FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon read cogs_assumptions" ON cogs_assumptions;
CREATE POLICY "anon read cogs_assumptions" ON cogs_assumptions FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "anon insert cogs_assumptions" ON cogs_assumptions;
CREATE POLICY "anon insert cogs_assumptions" ON cogs_assumptions FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "anon update cogs_assumptions" ON cogs_assumptions;
CREATE POLICY "anon update cogs_assumptions" ON cogs_assumptions FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon read rent_assumptions" ON rent_assumptions;
CREATE POLICY "anon read rent_assumptions" ON rent_assumptions FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "anon insert rent_assumptions" ON rent_assumptions;
CREATE POLICY "anon insert rent_assumptions" ON rent_assumptions FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "anon update rent_assumptions" ON rent_assumptions;
CREATE POLICY "anon update rent_assumptions" ON rent_assumptions FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon read daily_forecast" ON daily_forecast;
CREATE POLICY "anon read daily_forecast" ON daily_forecast FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "anon insert daily_forecast" ON daily_forecast;
CREATE POLICY "anon insert daily_forecast" ON daily_forecast FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "anon update daily_forecast" ON daily_forecast;
CREATE POLICY "anon update daily_forecast" ON daily_forecast FOR UPDATE TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon read monthly_summary" ON monthly_summary;
CREATE POLICY "anon read monthly_summary" ON monthly_summary FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS "anon insert monthly_summary" ON monthly_summary;
CREATE POLICY "anon insert monthly_summary" ON monthly_summary FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS "anon update monthly_summary" ON monthly_summary;
CREATE POLICY "anon update monthly_summary" ON monthly_summary FOR UPDATE TO anon USING (true) WITH CHECK (true);
