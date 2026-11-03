CREATE TABLE homes (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL CONSTRAINT homes_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE TABLE members (
  id      TEXT PRIMARY KEY,
  home_id TEXT NOT NULL CONSTRAINT members_home_fk REFERENCES homes(id),
  name    TEXT NOT NULL CONSTRAINT members_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE TABLE bills (
  id          TEXT PRIMARY KEY,
  home_id     TEXT NOT NULL CONSTRAINT bills_home_fk REFERENCES homes(id),
  title       TEXT NOT NULL CONSTRAINT bills_title_not_blank CHECK (length(trim(title)) > 0),
  total_cents INTEGER NOT NULL CONSTRAINT bills_total_positive
              CHECK (typeof(total_cents) = 'integer' AND total_cents > 0)
);

CREATE TABLE shares (
  id           TEXT PRIMARY KEY,
  bill_id      TEXT NOT NULL CONSTRAINT shares_bill_fk REFERENCES bills(id),
  member_id    TEXT NOT NULL CONSTRAINT shares_member_fk REFERENCES members(id),
  amount_cents INTEGER NOT NULL CONSTRAINT shares_amount_nonneg CHECK (amount_cents >= 0),
  paid_at      TEXT,
  payment_key  TEXT,
  CONSTRAINT shares_one_per_member UNIQUE (bill_id, member_id),
  CONSTRAINT shares_paid_consistent CHECK ((paid_at IS NULL) = (payment_key IS NULL))
);