CREATE TABLE IF NOT EXISTS production_batches (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  batch_number INTEGER NOT NULL CHECK (batch_number > 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  note TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(order_id, batch_number)
);

CREATE INDEX IF NOT EXISTS idx_production_batches_order
  ON production_batches(order_id, batch_number);

INSERT OR IGNORE INTO production_batches (id,order_id,batch_number,quantity,note,created_at)
SELECT lower(hex(randomblob(16))),id,1,quantity_completed,
  'Migrated previously accounted quantity; individual batch details were not stored.',updated_at
FROM orders WHERE quantity_completed > 0;
