import { describe, expect, it } from "vitest";
import { MOCK_FILES } from "../src/llm/mockApp";
import { bundleApp } from "../src/sandbox/bundle";
import { escapeInlineScript, jsonForScript } from "../src/sandbox/shell";

const withApp = (app: string, extra: { path: string; content: string }[] = []) => [
  { path: "App.jsx", content: app },
  ...extra,
];

describe("bundleApp", () => {
  it("bundles a multi-file app that uses react and the sayship SDK", async () => {
    const result = await bundleApp(MOCK_FILES, "preview");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).toContain("window.__sayship_modules");
    expect(result.code).toContain("Task board");
    expect(result.code).toContain("/data/"); // SDK is bundled in
    expect(result.code).toContain("sourceMappingURL=data:application/json");
  });

  it("minifies live bundles and uses the production JSX runtime", async () => {
    const result = await bundleApp(MOCK_FILES, "live");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.code).not.toContain("sourceMappingURL");
    expect(result.code).not.toContain("jsx-dev-runtime");
  });

  it("requires App.jsx", async () => {
    const result = await bundleApp([{ path: "Main.jsx", content: "export default () => null" }], "preview");
    expect(result).toMatchObject({ ok: false, errors: [{ message: expect.stringContaining("App.jsx is missing") }] });
  });

  it("rejects packages other than react and sayship, pointing at the import", async () => {
    const result = await bundleApp(
      withApp(`import _ from "lodash";\nexport default function App() { return <div>{_.now()}</div>; }`),
      "preview",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ file: "App.jsx", line: 1 });
    expect(result.errors[0]!.message).toMatch(/Package "lodash" is not available/);
  });

  it("reports missing relative imports with the available files", async () => {
    const result = await bundleApp(
      withApp(`import Card from "./components/Card";\nexport default function App() { return <Card />; }`),
      "preview",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.message).toMatch(/Cannot find "\.\/components\/Card"\. Available files: App\.jsx/);
  });

  it("reports syntax errors with file and line", async () => {
    const result = await bundleApp(
      withApp(`export default function App() {\n  return (\n    <div>\n  );\n}\n`),
      "preview",
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ file: "App.jsx" });
    expect(result.errors[0]!.line).toBeGreaterThanOrEqual(3);
  });

  it("flags a missing default export", async () => {
    const result = await bundleApp(withApp(`export function App() { return null; }`), "preview");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.message).toMatch(/default/);
  });

  it("never resolves imports to the real file system", async () => {
    for (const spec of ["../../package.json", "/etc/passwd", "C:/Windows/win.ini", "../server/src/env"]) {
      const result = await bundleApp(
        withApp(`import x from ${JSON.stringify(spec)};\nexport default function App() { return <div>{String(x)}</div>; }`),
        "preview",
      );
      expect(result.ok, spec).toBe(false);
    }
  });

  it("resolves relative imports between nested files", async () => {
    const result = await bundleApp(
      withApp(`import Row from "./components/Row";\nexport default function App() { return <Row />; }`, [
        { path: "components/Row.jsx", content: `import { label } from "../lib/labels.js";\nexport default () => <p>{label}</p>;` },
        { path: "lib/labels.js", content: `export const label = "nested ok";` },
      ]),
      "preview",
    );
    expect(result.ok).toBe(true);
  });
});

describe("inline script safety", () => {
  it("cannot close the surrounding script tag", () => {
    const code = `var s = "</script><script>alert(1)</script>"; var c = "<!--<script>";`;
    const escaped = escapeInlineScript(code);
    expect(escaped).not.toMatch(/<\/script/i);
    expect(escaped).not.toContain("<!--");
    // Same string values once parsed as JavaScript.
    expect(new Function(`${escaped}; return s + c;`)()).toBe(new Function(`${code}; return s + c;`)());
  });

  it("escapes JSON for inline scripts", () => {
    expect(jsonForScript({ a: "</script>" })).toBe('{"a":"\\u003c/script>"}');
  });
});
