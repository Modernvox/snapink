-- Detailed preparation stages while retaining the existing lifecycle status.
CREATE TABLE IF NOT EXISTS production_job_progress (
  job_id TEXT PRIMARY KEY REFERENCES production_jobs(id),
  stage TEXT NOT NULL,
  message TEXT,
  updated_at TEXT NOT NULL
);
