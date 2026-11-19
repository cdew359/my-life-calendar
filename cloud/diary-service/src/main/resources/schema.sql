CREATE TABLE IF NOT EXISTS cloud_diary_entries (
 account_id VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 diary_date CHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 title VARCHAR(400) NOT NULL,
 content MEDIUMTEXT NOT NULL,
 revision INT NOT NULL,
 created_at BIGINT NOT NULL,
 updated_at BIGINT NOT NULL,
 deleted BOOLEAN NOT NULL DEFAULT FALSE,
 PRIMARY KEY(account_id,diary_date)
);
CREATE TABLE IF NOT EXISTS cloud_diary_outbox (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,
 account_id VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 diary_date CHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 attempts INT NOT NULL DEFAULT 0,
 next_attempt BIGINT NOT NULL DEFAULT 0,
 UNIQUE KEY entry_key(account_id,diary_date)
);
