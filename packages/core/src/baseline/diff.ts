export const channelTolerance = 16;
export const failRatio = 0.02;

export const diffMessage = "기준 화면과 다릅니다.";
export const sizeMessage = "기준 화면과 크기가 다릅니다.";

export type RgbaImage = {
  width: number;
  height: number;
  data: Uint8Array;
};

export type CompareResult = { pass: true; ratio: number } | { pass: false; message: string };

function channelsDiffer(left: Uint8Array, right: Uint8Array, offset: number): boolean {
  const red = Math.abs(left[offset] - right[offset]);
  const green = Math.abs(left[offset + 1] - right[offset + 1]);
  const blue = Math.abs(left[offset + 2] - right[offset + 2]);
  return Math.max(red, green, blue) > channelTolerance;
}

export function buildMask(images: readonly RgbaImage[]): Uint8Array {
  const first = images[0];
  if (!first) return new Uint8Array();
  const usable = images.filter((image) => image.width === first.width && image.height === first.height);
  const count = first.width * first.height;
  const mask = new Uint8Array(count);
  mask.fill(255);
  if (usable.length < 2) return mask;
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    for (let left = 0; left < usable.length; left += 1) {
      let differed = false;
      for (let right = left + 1; right < usable.length; right += 1) {
        if (!channelsDiffer(usable[left].data, usable[right].data, offset)) continue;
        mask[index] = 0;
        differed = true;
        break;
      }
      if (differed) break;
    }
  }
  return mask;
}

export function compareImages(current: RgbaImage, baseline: RgbaImage, mask: Uint8Array | null): CompareResult {
  if (current.width !== baseline.width || current.height !== baseline.height) {
    return { pass: false, message: sizeMessage };
  }
  const count = current.width * current.height;
  const useMask = mask != null && mask.length === count;
  let compared = 0;
  let changed = 0;
  for (let index = 0; index < count; index += 1) {
    if (useMask && mask[index] === 0) continue;
    compared += 1;
    if (channelsDiffer(current.data, baseline.data, index * 4)) changed += 1;
  }
  const ratio = compared === 0 ? 0 : changed / compared;
  if (ratio > failRatio) return { pass: false, message: diffMessage };
  return { pass: true, ratio };
}
