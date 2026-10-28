-- Record physical unit completion separately from project handoff.
-- Existing records start at zero: opening an Orca project is not production.
ALTER TABLE orders ADD COLUMN quantity_completed INTEGER NOT NULL DEFAULT 0 CHECK (quantity_completed BETWEEN 0 AND quantity);
