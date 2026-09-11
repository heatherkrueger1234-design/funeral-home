/**
 * `heic-decode` ships no types. The surface used here is one call, so the
 * shape is declared rather than pulling in a dependency for it.
 */
declare module "heic-decode" {
  export type DecodedImage = {
    width: number;
    height: number;
    /** RGBA, 8 bits per channel. */
    data: Uint8ClampedArray;
  };

  export default function decode(options: {
    buffer: Uint8Array;
  }): Promise<DecodedImage>;
}
