//! Age gate. Port of the server-side half of `shared/age.ts`.
//!
//! The picker helpers stay in TypeScript — they are client-only. Only
//! `is_adult` runs on the server, and it must agree with the browser, so both
//! sides evaluate in UTC.

pub const MIN_ADULT_AGE: i32 = 18;

/// `birth_date` is `YYYY-MM-DD`. Anything unparseable is not an adult, matching
/// the `Number.isNaN(date.getTime())` guard.
pub fn is_adult(birth_date: &str) -> bool {
    let Some(birth) = parse_ymd(birth_date) else {
        return false;
    };
    let today = time::OffsetDateTime::now_utc().date();
    if birth > today {
        return false;
    }

    let mut age = today.year() - birth.year();
    let before_birthday = (today.month() as u8) < (birth.month() as u8)
        || ((today.month() as u8) == (birth.month() as u8) && today.day() < birth.day());
    if before_birthday {
        age -= 1;
    }
    age >= MIN_ADULT_AGE
}

/// `new Date("YYYY-MM-DDT00:00:00Z")`. Rejects malformed input rather than
/// rolling over the way some date parsers do.
fn parse_ymd(s: &str) -> Option<time::Date> {
    let mut parts = s.split('-');
    let y: i32 = parts.next()?.parse().ok()?;
    let m: u8 = parts.next()?.parse().ok()?;
    let d: u8 = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    time::Date::from_calendar_date(y, time::Month::try_from(m).ok()?, d).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_typescript_cases() {
        // From tests/auth.test.ts.
        assert!(is_adult("2000-01-01"));
        assert!(!is_adult("2015-01-01"));
    }

    #[test]
    fn rejects_unparseable_dates_instead_of_guessing() {
        for bad in ["", "not-a-date", "2000", "2000-01", "2000-13-01", "2000-02-31", "2000-01-01-01"] {
            assert!(!is_adult(bad), "{bad:?} should not read as an adult");
        }
    }

    #[test]
    fn a_future_birth_date_is_not_an_adult() {
        let next_year = time::OffsetDateTime::now_utc().year() + 1;
        assert!(!is_adult(&format!("{next_year}-01-01")));
    }

    /// The boundary: exactly 18 today is an adult, one day short is not.
    #[test]
    fn the_eighteenth_birthday_is_inclusive() {
        let today = time::OffsetDateTime::now_utc().date();
        let born_exactly_18 = today.replace_year(today.year() - 18).expect("valid date");
        assert!(is_adult(&format!(
            "{:04}-{:02}-{:02}",
            born_exactly_18.year(),
            born_exactly_18.month() as u8,
            born_exactly_18.day()
        )));

        let tomorrow = today.next_day().expect("in range");
        let one_day_short = tomorrow.replace_year(tomorrow.year() - 18).expect("valid date");
        assert!(!is_adult(&format!(
            "{:04}-{:02}-{:02}",
            one_day_short.year(),
            one_day_short.month() as u8,
            one_day_short.day()
        )));
    }
}
