import type { BuildKind } from "@device-farm/core/device/types";

export const defaultPort = 5173;

export type DeviceSelection = string[] | "all";

export interface RunArgs {
  kind: BuildKind;
  version: string;
  devices: DeviceSelection;
  port: number;
}

export interface ExploreArgs {
  devices: DeviceSelection;
  port: number;
  build?: BuildKind;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const versionPattern = /^\d+\.\d+\.\d+(\+\d+)?$/;
const maxPort = 65_535;
const runOptions = ["build", "version", "devices", "port"] as const;
const exploreOptions = ["build", "devices", "port"] as const;

type Options = Map<string, string>;

/** `--key value`와 `--key=value`를 모은다. 모르는 옵션·값 없는 옵션은 오류. */
export function readOptions(argv: readonly string[], allowed: readonly string[]): ParseResult<Options> {
  const options: Options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) return { ok: false, error: `알 수 없는 인자입니다: ${token}` };
    const [rawKey, inline] = token.slice(2).split(/=(.*)/s, 2);
    if (!allowed.includes(rawKey)) return { ok: false, error: `알 수 없는 옵션입니다: --${rawKey}` };
    const value = inline ?? argv[index + 1];
    if (value === undefined || value.startsWith("--")) return { ok: false, error: `--${rawKey} 값이 없습니다.` };
    if (inline === undefined) index += 1;
    options.set(rawKey, value);
  }
  return { ok: true, value: options };
}

function parseBuild(value: string | undefined): ParseResult<BuildKind> {
  if (value === undefined) return { ok: false, error: "--build가 필요합니다. (dev | prod)" };
  if (value === "dev" || value === "prod") return { ok: true, value };
  return { ok: false, error: `--build는 dev 또는 prod여야 합니다: ${value}` };
}

function parseVersion(value: string | undefined): ParseResult<string> {
  if (value === undefined) return { ok: false, error: "--version이 필요합니다. (예: 2.1.5 또는 2.1.5+412)" };
  if (versionPattern.test(value)) return { ok: true, value };
  return { ok: false, error: `--version 형식이 아닙니다: ${value} (예: 2.1.5 또는 2.1.5+412)` };
}

function parseDevices(value: string | undefined): ParseResult<DeviceSelection> {
  if (value === undefined || value === "all") return { ok: true, value: "all" };
  const ids = value.split(",").map((id) => id.trim());
  if (ids.some((id) => id === "")) return { ok: false, error: `--devices 형식이 아닙니다: ${value} (all 또는 id,id)` };
  return { ok: true, value: ids };
}

function parsePort(value: string | undefined): ParseResult<number> {
  if (value === undefined) return { ok: true, value: defaultPort };
  const port = Number(value);
  if (/^\d+$/.test(value) && port >= 1 && port <= maxPort) return { ok: true, value: port };
  return { ok: false, error: `--port는 1~${maxPort} 정수여야 합니다: ${value}` };
}

/** `npm run device-run -- --build prod --version 2.1.5 [--devices all|id,id] [--port 5173]` */
export function parseRunArgs(argv: readonly string[]): ParseResult<RunArgs> {
  const options = readOptions(argv, runOptions);
  if (!options.ok) return options;
  const kind = parseBuild(options.value.get("build"));
  if (!kind.ok) return kind;
  const version = parseVersion(options.value.get("version"));
  if (!version.ok) return version;
  const devices = parseDevices(options.value.get("devices"));
  if (!devices.ok) return devices;
  const port = parsePort(options.value.get("port"));
  if (!port.ok) return port;
  return { ok: true, value: { kind: kind.value, version: version.value, devices: devices.value, port: port.value } };
}

/** `npm run device-explore -- [--devices all|id,id] [--port 5173] [--build dev]` */
export function parseExploreArgs(argv: readonly string[]): ParseResult<ExploreArgs> {
  const options = readOptions(argv, exploreOptions);
  if (!options.ok) return options;
  const devices = parseDevices(options.value.get("devices"));
  if (!devices.ok) return devices;
  const port = parsePort(options.value.get("port"));
  if (!port.ok) return port;
  const rawBuild = options.value.get("build");
  if (rawBuild === undefined) return { ok: true, value: { devices: devices.value, port: port.value } };
  const build = parseBuild(rawBuild);
  if (!build.ok) return build;
  return { ok: true, value: { devices: devices.value, port: port.value, build: build.value } };
}
