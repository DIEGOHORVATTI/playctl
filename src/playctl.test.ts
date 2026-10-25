import { it, expect, describe } from "bun:test";

import { parseInvocation } from "./args";
import { releaseToPromote } from "./client";

const environment = { cwd: "/tmp/nowhere", env: {}, home: "/home/me" };

describe("parseInvocation", () => {
  it("promote goes from alpha to production by default", () => {
    const invocation = parseInvocation(["promote", "18", "--package", "com.app"], environment);

    expect(invocation).toEqual({
      command: "promote",
      positional: ["18"],
      packageName: "com.app",
      keyFile: "/home/me/.config/playctl/key.json",
      from: "alpha",
      to: "production",
    });
  });

  it("reads package and key from the environment and expands ~", () => {
    const invocation = parseInvocation(["status"], {
      ...environment,
      env: { PLAY_PACKAGE_NAME: "com.env", PLAY_KEY_FILE: "~/keys/play.json" },
    });

    expect(invocation.packageName).toBe("com.env");
    expect(invocation.keyFile).toBe("/home/me/keys/play.json");
  });

  it("refuses a command without package", () => {
    expect(() => parseInvocation(["status"], environment)).toThrow();
  });
});

describe("releaseToPromote", () => {
  it("copies name and release notes and publishes it complete", () => {
    const release = releaseToPromote(
      {
        track: "alpha",
        releases: [
          {
            name: "1.14.0",
            status: "completed",
            versionCodes: ["18"],
            releaseNotes: [{ language: "en-US", text: "News" }],
          },
        ],
      },
      "18",
    );

    expect(release).toEqual({
      name: "1.14.0",
      status: "completed",
      versionCodes: ["18"],
      releaseNotes: [{ language: "en-US", text: "News" }],
    });
  });

  it("fails when the versionCode is not on the source track", () => {
    expect(() => releaseToPromote({ track: "alpha", releases: [] }, "18")).toThrow();
  });
});
