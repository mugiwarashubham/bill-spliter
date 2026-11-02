CREATE TABLE homes (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE members (
  id TEXT PRIMARY KEY NOT NULL,
  home_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT fk_members_home FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE
);
CREATE INDEX idx_members_home_order ON members(home_id, created_at, id);

CREATE TABLE bills (
  id TEXT PRIMARY KEY NOT NULL,
  home_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  total_cents INTEGER NOT NULL CHECK (total_cents > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CONSTRAINT fk_bills_home FOREIGN KEY (home_id) REFERENCES homes(id) ON DELETE CASCADE
);

CREATE TABLE shares (
  id TEXT PRIMARY KEY NOT NULL,
  bill_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  paid_at TEXT,
  idempotency_key TEXT,
  CONSTRAINT fk_shares_bill FOREIGN KEY (bill_id) REFERENCES bills(id) ON DELETE CASCADE,
  CONSTRAINT fk_shares_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  CONSTRAINT uq_share_bill_member UNIQUE (bill_id, member_id)
);
