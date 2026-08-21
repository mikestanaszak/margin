import { describe, expect, it } from "vitest";

import {
  createChecksumManifest,
  parseChecksumManifest,
} from "./release-checksums.mjs";

const encoder = new TextEncoder();

describe("release checksum manifests", () => {
  it("hashes bytes and sorts entries by filename", () => {
    expect(
      createChecksumManifest([
        { name: "z.bin", bytes: encoder.encode("") },
        { name: "a.bin", bytes: encoder.encode("abc") },
      ]),
    ).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  a.bin\n" +
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  z.bin\n",
    );
  });

  it("changes an entry when its artifact bytes change", () => {
    const before = createChecksumManifest([
      { name: "Margin.exe", bytes: encoder.encode("before") },
    ]);
    const after = createChecksumManifest([
      { name: "Margin.exe", bytes: encoder.encode("after") },
    ]);

    expect(after).not.toBe(before);
  });

  it("uses deterministic code-unit ordering for punctuation and case", () => {
    const manifest = createChecksumManifest(
      ["a.bin", "Z.bin", "_.bin"].map((name) => ({
        name,
        bytes: encoder.encode(name),
      })),
    );

    expect(
      manifest.split("\n").filter(Boolean).map((line) => line.slice(66)),
    ).toEqual(["Z.bin", "_.bin", "a.bin"]);
  });

  it("parses a valid manifest into exact filename hashes", () => {
    const manifest =
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  Margin.exe\n";

    expect(parseChecksumManifest(manifest)).toEqual(
      new Map([
        [
          "Margin.exe",
          "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        ],
      ]),
    );
  });

  it.each([
    [
      "duplicate filename",
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  Margin.exe\n" +
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855  Margin.exe\n",
    ],
    ["unsafe filename", `${"0".repeat(64)}  ../Margin.exe\n`],
    ["path separator", `${"0".repeat(64)}  nested/Margin.exe\n`],
    ["malformed hash", "not-a-hash  Margin.exe\n"],
  ])("rejects a %s", (_name, manifest) => {
    expect(() => parseChecksumManifest(manifest)).toThrow();
  });
});
