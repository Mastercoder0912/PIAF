import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Everything under `dir`, as full paths. */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const appFiles = files("src");

describe("the weather API key stays on the server", () => {
  it("the app code never mentions the key variable or calls the provider directly", () => {
    for (const path of appFiles) {
      const text = readFileSync(path, "utf8");
      expect(text, path).not.toMatch(/WEATHERAPI_KEY/);
      expect(text, path).not.toMatch(/api\.weatherapi\.com/);
    }
  });

  it("the app code reads no environment variables at all (so nothing can leak through a VITE_ variable)", () => {
    for (const path of appFiles) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(/import\.meta\.env|process\.env/);
    }
  });

  it("only the server function reads the key", () => {
    const server = readFileSync("api/weather.ts", "utf8");
    expect(server).toMatch(/process\.env\.WEATHERAPI_KEY/);
    expect(server).not.toMatch(/VITE_/);
  });

  it("no .env file or literal key is committed, and the build config injects no variables", () => {
    const top = readdirSync(".");
    expect(top.filter((name) => name.startsWith(".env") && name !== ".env.example")).toEqual([]);
    const config = readFileSync("vite.config.ts", "utf8");
    expect(config).not.toMatch(/\bdefine\b|loadEnv|envPrefix/);
  });
});
