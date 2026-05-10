const CALENDARS = {
    publicHolidayLabels: {
        national: {
            '2025-01-01': "New Year's Day",
            '2025-01-27': 'Australia Day',
            '2025-04-18': 'Good Friday',
            '2025-04-19': 'Easter Saturday',
            '2025-04-20': 'Easter Sunday',
            '2025-04-21': 'Easter Monday',
            '2025-04-25': 'Anzac Day',
            '2025-12-25': 'Christmas Day',
            '2025-12-26': 'Boxing Day',
            '2026-01-01': "New Year's Day",
            '2026-01-26': 'Australia Day',
            '2026-04-03': 'Good Friday',
            '2026-04-04': 'Easter Saturday',
            '2026-04-05': 'Easter Sunday',
            '2026-04-06': 'Easter Monday',
            '2026-04-25': 'Anzac Day',
            '2026-12-25': 'Christmas Day',
            '2026-12-26': 'Boxing Day',
            '2026-12-28': 'Additional public holiday for Boxing Day',
            '2027-01-01': "New Year's Day",
            '2027-01-26': 'Australia Day',
            '2027-03-26': 'Good Friday',
            '2027-03-27': 'Easter Saturday',
            '2027-03-28': 'Easter Sunday',
            '2027-03-29': 'Easter Monday',
            '2027-04-25': 'Anzac Day',
            '2027-12-25': 'Christmas Day',
            '2027-12-26': 'Boxing Day',
            '2027-12-27': 'Additional public holiday for Christmas Day',
            '2027-12-28': 'Additional public holiday for Boxing Day'
        },
        NSW: {
            '2025-06-09': "King's Birthday",
            '2025-10-06': 'Labour Day',
            '2026-04-27': 'Additional public holiday for Anzac Day',
            '2026-06-08': "King's Birthday",
            '2026-10-05': 'Labour Day',
            '2027-04-26': 'Additional public holiday for Anzac Day',
            '2027-06-14': "King's Birthday",
            '2027-10-04': 'Labour Day'
        },
        VIC: {
            '2024-11-05': 'Melbourne Cup Day',
            '2025-03-10': 'Labour Day',
            '2025-06-09': "King's Birthday",
            '2025-11-04': 'Melbourne Cup Day',
            '2026-03-09': 'Labour Day',
            '2026-06-08': "King's Birthday",
            '2026-11-03': 'Melbourne Cup Day',
            '2027-03-08': 'Labour Day',
            '2027-06-14': "King's Birthday",
            '2027-11-02': 'Melbourne Cup Day'
        },
        QLD: {
            '2025-05-05': 'Labour Day',
            '2025-08-13': 'Royal Queensland Show',
            '2025-10-06': "King's Birthday",
            '2026-05-04': 'Labour Day',
            '2026-08-12': 'Royal Queensland Show',
            '2026-10-05': "King's Birthday",
            '2027-05-03': 'Labour Day',
            '2027-08-11': 'Royal Queensland Show',
            '2027-10-04': "King's Birthday"
        },
        SA: {
            '2025-03-10': 'Adelaide Cup Day',
            '2025-06-09': "King's Birthday",
            '2025-10-06': 'Labour Day',
            '2025-12-24': 'Christmas Eve',
            '2026-03-09': 'Adelaide Cup Day',
            '2026-06-08': "King's Birthday",
            '2026-10-05': 'Labour Day',
            '2026-12-24': 'Christmas Eve',
            '2027-03-08': 'Adelaide Cup Day',
            '2027-06-14': "King's Birthday",
            '2027-10-04': 'Labour Day'
        },
        WA: {
            '2025-03-03': 'Labour Day',
            '2025-06-02': 'Western Australia Day',
            '2025-09-29': "King's Birthday",
            '2026-03-02': 'Labour Day',
            '2026-04-27': 'Additional public holiday for Anzac Day',
            '2026-06-01': 'Western Australia Day',
            '2026-09-28': "King's Birthday",
            '2027-03-01': 'Labour Day',
            '2027-04-26': 'Additional public holiday for Anzac Day',
            '2027-06-07': 'Western Australia Day',
            '2027-09-27': "King's Birthday"
        },
        TAS: {
            '2025-02-10': 'Royal Hobart Regatta',
            '2025-06-09': "King's Birthday",
            '2026-02-09': 'Royal Hobart Regatta',
            '2026-06-08': "King's Birthday",
            '2027-02-08': 'Royal Hobart Regatta',
            '2027-06-14': "King's Birthday"
        },
        NT: {
            '2025-05-05': 'May Day',
            '2025-06-09': "King's Birthday",
            '2025-08-04': 'Picnic Day',
            '2025-12-24': 'Christmas Eve',
            '2026-05-04': 'May Day',
            '2026-06-08': "King's Birthday",
            '2026-08-03': 'Picnic Day',
            '2026-12-24': 'Christmas Eve',
            '2027-05-03': 'May Day',
            '2027-06-14': "King's Birthday",
            '2027-08-02': 'Picnic Day'
        },
        ACT: {
            '2025-03-10': 'Canberra Day',
            '2025-06-02': 'Reconciliation Day',
            '2025-06-09': "King's Birthday",
            '2025-10-06': 'Labour Day',
            '2026-03-09': 'Canberra Day',
            '2026-05-25': 'Reconciliation Day',
            '2026-06-08': "King's Birthday",
            '2026-10-05': 'Labour Day',
            '2027-03-08': 'Canberra Day',
            '2027-05-31': 'Reconciliation Day',
            '2027-06-14': "King's Birthday",
            '2027-10-04': 'Labour Day'
        }
    },

    publicHolidays: {
        national: [],
        NSW: [],
        VIC: [],
        QLD: [],
        SA: [],
        WA: [],
        TAS: [],
        NT: [],
        ACT: []
    },

    schoolHolidays: {
        NSW: [
            { start: '2026-04-06', end: '2026-04-17' },
            { start: '2026-06-29', end: '2026-07-10' },
            { start: '2026-09-21', end: '2026-10-02' },
            { start: '2026-12-18', end: '2027-01-27' },
            { start: '2027-04-02', end: '2027-04-16' },
            { start: '2027-06-28', end: '2027-07-09' }
        ],
        VIC: [
            { start: '2026-03-28', end: '2026-04-14' },
            { start: '2026-06-27', end: '2026-07-13' },
            { start: '2026-09-19', end: '2026-10-05' },
            { start: '2026-12-19', end: '2027-01-29' },
            { start: '2027-03-27', end: '2027-04-13' },
            { start: '2027-06-26', end: '2027-07-12' }
        ],
        QLD: [
            { start: '2026-03-28', end: '2026-04-13' },
            { start: '2026-06-20', end: '2026-07-06' },
            { start: '2026-09-19', end: '2026-10-05' },
            { start: '2026-12-12', end: '2027-01-25' },
            { start: '2027-03-27', end: '2027-04-12' },
            { start: '2027-06-19', end: '2027-07-05' }
        ],
        SA: [
            { start: '2026-04-11', end: '2026-04-27' },
            { start: '2026-07-04', end: '2026-07-20' },
            { start: '2026-09-26', end: '2026-10-12' },
            { start: '2026-12-12', end: '2027-01-26' },
            { start: '2027-04-10', end: '2027-04-26' },
            { start: '2027-07-03', end: '2027-07-19' }
        ],
        WA: [
            { start: '2026-04-04', end: '2026-04-20' },
            { start: '2026-07-04', end: '2026-07-20' },
            { start: '2026-09-26', end: '2026-10-12' },
            { start: '2026-12-17', end: '2027-02-02' },
            { start: '2027-04-03', end: '2027-04-19' },
            { start: '2027-07-03', end: '2027-07-19' }
        ],
        TAS: [
            { start: '2026-04-11', end: '2026-04-27' },
            { start: '2026-07-04', end: '2026-07-20' },
            { start: '2026-09-26', end: '2026-10-12' },
            { start: '2026-12-18', end: '2027-02-09' },
            { start: '2027-04-10', end: '2027-04-26' },
            { start: '2027-07-03', end: '2027-07-19' }
        ],
        NT: [
            { start: '2026-04-04', end: '2026-04-13' },
            { start: '2026-06-20', end: '2026-07-20' },
            { start: '2026-09-26', end: '2026-10-05' },
            { start: '2026-12-12', end: '2027-01-26' },
            { start: '2027-04-03', end: '2027-04-12' },
            { start: '2027-06-19', end: '2027-07-19' }
        ],
        ACT: [
            { start: '2026-04-11', end: '2026-04-27' },
            { start: '2026-07-04', end: '2026-07-20' },
            { start: '2026-09-26', end: '2026-10-12' },
            { start: '2026-12-18', end: '2027-02-02' },
            { start: '2027-04-10', end: '2027-04-26' },
            { start: '2027-07-03', end: '2027-07-19' }
        ]
    },

    isPublicHoliday(dateStr, state) {
        return Boolean(this.getPublicHolidayName(dateStr, state));
    },

    getPublicHolidayName(dateStr, state) {
        return this.publicHolidayLabels[state]?.[dateStr] ||
            this.publicHolidayLabels.national[dateStr] ||
            null;
    },

    getPriorYearComparableDate(dateStr, state) {
        const current = this.parseDate(dateStr);
        if (!current) return dateStr;

        const holidayName = this.getPublicHolidayName(dateStr, state);
        if (holidayName) {
            const matchedHoliday = this.findHolidayDate(holidayName, state, current.getFullYear() - 1);
            if (matchedHoliday) return matchedHoliday;
        }

        const weekdayComparable = this.addDays(current, -364);
        const weekdayComparableStr = this.formatDate(weekdayComparable);
        if (!this.isPublicHoliday(weekdayComparableStr, state)) return weekdayComparableStr;

        for (const offset of [-7, 7, -14, 14]) {
            const candidate = this.formatDate(this.addDays(weekdayComparable, offset));
            if (!this.isPublicHoliday(candidate, state)) return candidate;
        }
        return weekdayComparableStr;
    },

    findHolidayDate(holidayName, state, year) {
        const holidayMaps = [this.publicHolidayLabels[state] || {}, this.publicHolidayLabels.national];
        for (const map of holidayMaps) {
            const match = Object.entries(map).find(([date, name]) =>
                Number(date.substring(0, 4)) === year && name === holidayName
            );
            if (match) return match[0];
        }
        return null;
    },

    getHolidayDatesForState(state, startDate, endDate) {
        const dates = new Set();
        for (const map of [this.publicHolidayLabels.national, this.publicHolidayLabels[state] || {}]) {
            for (const date of Object.keys(map)) {
                if ((!startDate || date >= startDate) && (!endDate || date <= endDate)) {
                    dates.add(date);
                }
            }
        }
        return [...dates].sort();
    },

    parseDate(dateStr) {
        const match = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!match) return null;
        return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    },

    formatDate(date) {
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0')
        ].join('-');
    },

    addDays(date, days) {
        const copy = new Date(date);
        copy.setDate(copy.getDate() + days);
        return copy;
    },

    isSchoolHoliday(dateStr, state) {
        const periods = this.schoolHolidays[state] || [];
        return periods.some(p => dateStr >= p.start && dateStr <= p.end);
    }
};
