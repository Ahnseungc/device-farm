/**
 * farm.db 스키마. 배열 순서가 곧 버전(`PRAGMA user_version`)이다. 이미 배포한 단계는 고치지 말고 뒤에 붙인다.
 * `data` 열은 읽을 때 쓰는 원본 JSON이다. 나머지 열·자식 표는 검색·통계용으로 같이 쓴다.
 */
export const migrations: readonly string[] = [
  `
  CREATE TABLE device_runs (
    run_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    version TEXT NOT NULL,
    trigger TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    data TEXT NOT NULL
  );
  CREATE INDEX device_runs_started_at ON device_runs (started_at);

  CREATE TABLE device_outcomes (
    run_id TEXT NOT NULL REFERENCES device_runs (run_id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    model TEXT NOT NULL,
    os_version TEXT NOT NULL,
    app_version TEXT,
    status TEXT NOT NULL,
    message TEXT,
    PRIMARY KEY (run_id, device_id)
  );

  CREATE TABLE device_screens (
    run_id TEXT NOT NULL REFERENCES device_runs (run_id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    position INTEGER NOT NULL,
    scenario TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    screenshot TEXT,
    log_dir TEXT,
    checks TEXT,
    steps TEXT,
    buttons TEXT,
    PRIMARY KEY (run_id, device_id, position)
  );
  CREATE INDEX device_screens_scenario ON device_screens (scenario, status);

  CREATE TABLE chaos_runs (
    run_id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL,
    seed INTEGER NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    steps INTEGER NOT NULL,
    states INTEGER NOT NULL,
    error_steps INTEGER NOT NULL,
    blocked INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX chaos_runs_started_at ON chaos_runs (started_at);

  CREATE TABLE chaos_steps (
    run_id TEXT NOT NULL REFERENCES chaos_runs (run_id) ON DELETE CASCADE,
    episode INTEGER NOT NULL,
    step INTEGER NOT NULL,
    at TEXT NOT NULL,
    from_path TEXT NOT NULL,
    to_path TEXT NOT NULL,
    chosen TEXT NOT NULL,
    new_state INTEGER NOT NULL,
    dead INTEGER NOT NULL,
    error_count INTEGER NOT NULL,
    failure TEXT,
    screenshot TEXT,
    PRIMARY KEY (run_id, episode, step)
  );
  CREATE INDEX chaos_steps_from_path ON chaos_steps (from_path);

  CREATE TABLE policy_pages (
    page_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    version INTEGER NOT NULL,
    modified_at TEXT NOT NULL,
    hash TEXT NOT NULL,
    web_url TEXT NOT NULL
  );

  CREATE TABLE policy_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    page_id TEXT NOT NULL,
    title TEXT NOT NULL,
    version INTEGER NOT NULL,
    from_version INTEGER,
    hash TEXT NOT NULL
  );
  CREATE UNIQUE INDEX policy_changes_unique ON policy_changes (at, kind, page_id, hash);

  CREATE TABLE policy_rules (
    page_id TEXT PRIMARY KEY,
    page_title TEXT NOT NULL,
    page_hash TEXT NOT NULL,
    extracted_at TEXT NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE policy_figma_cache (ref TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE policy_judge_cache (key TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE policy_screen_hashes (path TEXT PRIMARY KEY, hash TEXT NOT NULL);

  CREATE TABLE slack_alerts (
    key TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    path TEXT NOT NULL,
    finding TEXT NOT NULL,
    channel TEXT NOT NULL,
    ts TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX slack_alerts_status ON slack_alerts (status);

  CREATE TABLE screen_map_edges (
    from_path TEXT NOT NULL,
    role TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    to_path TEXT,
    seen_at TEXT NOT NULL,
    data TEXT NOT NULL,
    PRIMARY KEY (from_path, role, name)
  );

  CREATE TABLE farm_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  // 2: 아침 자동 분석(docs/operations.md). 하루 한 건, 다시 돌리면 덮어쓰고 슬랙 글은 고친다
  `
  CREATE TABLE daily_reports (
    day TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    channel TEXT,
    ts TEXT,
    data TEXT NOT NULL
  );
  `,
  // 3: 사내망 접속 세션. 세션 id 원문은 두지 않고 SHA-256만 둔다
  `
  CREATE TABLE farm_sessions (
    id_hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    ip TEXT NOT NULL
  );
  CREATE INDEX farm_sessions_expires ON farm_sessions (expires_at);
  `,
];
