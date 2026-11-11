import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PNG } from "pngjs";

import { buildMask, compareImages, type CompareResult, type RgbaImage } from "@device-farm/core/baseline/diff";

export const baselinesRoot = path.resolve("test-results/baselines");
export const archiveLimit = 5;

export type BaselineState = "none" | "candidate" | "ready";

function scenarioDir(root: string, name: string): string {
  const id = createHash("sha256").update(name, "utf8").digest("hex").slice(0, 16);
  return path.join(root, id);
}

function pendingPath(root: string): string {
  return path.join(root, "pending.json");
}

function readPng(file: string): RgbaImage {
  const png = PNG.sync.read(readFileSync(file));
  return { width: png.width, height: png.height, data: png.data };
}

function writeGrayMask(file: string, width: number, height: number, mask: Uint8Array): void {
  const png = new PNG({ width, height, colorType: 0 });
  for (let index = 0; index < mask.length; index += 1) {
    const value = mask[index] === 0 ? 0 : 255;
    const offset = index * 4;
    png.data[offset] = value;
    png.data[offset + 1] = value;
    png.data[offset + 2] = value;
    png.data[offset + 3] = 255;
  }
  writeFileSync(file, PNG.sync.write(png));
}

function readMask(file: string, width: number, height: number): Uint8Array | null {
  if (!existsSync(file)) return null;
  const png = PNG.sync.read(readFileSync(file));
  if (png.width !== width || png.height !== height) return null;
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index += 1) {
    mask[index] = png.data[index * 4] === 0 ? 0 : 255;
  }
  return mask;
}

type ArchiveFile = { index: number; file: string };

function archiveFiles(dir: string): ArchiveFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((name) => {
      const match = /^(\d+)\.png$/.exec(name);
      if (!match) return [];
      return [{ index: Number(match[1]), file: path.join(dir, name) }];
    })
    .sort((left, right) => left.index - right.index);
}

export function readPending(root = baselinesRoot): string[] {
  try {
    const parsed = JSON.parse(readFileSync(pendingPath(root), "utf8")) as { names?: unknown };
    if (!Array.isArray(parsed.names)) return [];
    return parsed.names.filter((name): name is string => typeof name === "string");
  } catch {
    return [];
  }
}

function writePending(root: string, names: string[]): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(pendingPath(root), JSON.stringify({ names }, null, 2));
}

export function clearPending(root = baselinesRoot): void {
  writePending(root, []);
}

function addPending(root: string, name: string): void {
  const names = readPending(root);
  if (!names.includes(name)) names.push(name);
  writePending(root, names);
}

export function hasBaseline(name: string, root = baselinesRoot): boolean {
  return existsSync(path.join(scenarioDir(root, name), "baseline.png"));
}

export function baselineState(name: string, root = baselinesRoot): BaselineState {
  if (readPending(root).includes(name)) return "candidate";
  if (hasBaseline(name, root)) return "ready";
  return "none";
}

export function saveCandidate(name: string, png: Buffer, root = baselinesRoot): void {
  const dir = scenarioDir(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "candidate.png"), png);
  addPending(root, name);
}

export function compareToBaseline(name: string, png: Buffer, root = baselinesRoot): CompareResult {
  const dir = scenarioDir(root, name);
  const current = PNG.sync.read(png);
  const baseline = readPng(path.join(dir, "baseline.png"));
  const mask = readMask(path.join(dir, "mask.png"), baseline.width, baseline.height);
  return compareImages({ width: current.width, height: current.height, data: current.data }, baseline, mask);
}

function rebuildMask(dir: string): void {
  const files = archiveFiles(path.join(dir, "archive"));
  const baseline = readPng(path.join(dir, "baseline.png"));
  const images = files
    .map((file) => readPng(file.file))
    .filter((image) => image.width === baseline.width && image.height === baseline.height);
  const mask = buildMask(images.length > 0 ? images : [baseline]);
  writeGrayMask(path.join(dir, "mask.png"), baseline.width, baseline.height, mask);
}

export function confirmScenario(name: string, root = baselinesRoot): boolean {
  if (!readPending(root).includes(name)) return false;
  const dir = scenarioDir(root, name);
  const candidate = path.join(dir, "candidate.png");
  if (!existsSync(candidate)) return false;
  const archive = path.join(dir, "archive");
  mkdirSync(archive, { recursive: true });
  const existing = archiveFiles(archive);
  const next = (existing.at(-1)?.index ?? 0) + 1;
  const archived = path.join(archive, `${String(next).padStart(4, "0")}.png`);
  writeFileSync(archived, readFileSync(candidate));
  const files = archiveFiles(archive);
  while (files.length > archiveLimit) {
    const oldest = files.shift();
    if (oldest) unlinkSync(oldest.file);
  }
  writeFileSync(path.join(dir, "baseline.png"), readFileSync(archived));
  rebuildMask(dir);
  unlinkSync(candidate);
  writePending(
    root,
    readPending(root).filter((item) => item !== name),
  );
  return true;
}

export function confirmPending(root = baselinesRoot): number {
  const names = readPending(root);
  let confirmed = 0;
  for (const name of names) {
    if (confirmScenario(name, root)) confirmed += 1;
  }
  return confirmed;
}
