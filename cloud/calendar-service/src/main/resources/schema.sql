CREATE TABLE IF NOT EXISTS cloud_calendar_states (
 account_id VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
 version BIGINT NOT NULL,
 payload JSON NOT NULL
);
CREATE TABLE IF NOT EXISTS cloud_calendar_lock (id INT PRIMARY KEY);
INSERT IGNORE INTO cloud_calendar_lock(id) VALUES(1);
CREATE TABLE IF NOT EXISTS cloud_ai_requests (
 account_id VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 request_id VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 feature VARCHAR(24) NOT NULL,
 model VARCHAR(100) NOT NULL,
 status VARCHAR(24) NOT NULL,
 input_tokens INT NULL,
 output_tokens INT NULL,
 latency_ms BIGINT NULL,
 created_at BIGINT NOT NULL,
 finished_at BIGINT NULL,
 PRIMARY KEY(account_id,request_id),
 KEY created_time(created_at)
);
