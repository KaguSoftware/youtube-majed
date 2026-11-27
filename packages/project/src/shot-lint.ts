import { parse } from "acorn";
import { transformSync } from "esbuild";

/**
 * The import rule for custom shots (docs/PLAN.md section 6): a shot may import
 * only `remotion`, `react` and the library and theme modules of
 * remotion/src/custom/kit.ts. No network, no filesystem, no other packages,
 * nothing that makes a frame depend on anything but its props. This runs
 * before a shot is typechecked or drawn.
 *
 * It parses the shot (esbuild strips the types, acorn reads the rest) and
 * walks the tree, so a banned name inside a comment or a string does not trip
 * it and a banned import cannot hide behind formatting. It is a guard against
 * a model's accidents, not a sandbox against an attacker: the shot still runs
 * in the render's browser tab, which has no access to the machine beyond it.
 */

/** Where a staged shot lives, relative to remotion/src, so a relative specifier can be resolved. */
export const STAGED_FROM = "custom/.staged";

/** Relative specifiers a shot may import, as paths under remotion/src (without extension). */
export const ALLOWED_MODULES = ["custom/kit", "theme", "scene/view"] as const;
export const ALLOWED_PREFIXES = ["rig/", "library/"] as const;
/** What a shot may take from "remotion": drawing, timing and nothing that loads a file or the network. */
export const REMOTION_ALLOWED = ["AbsoluteFill", "Sequence", "Series", "Freeze", "Loop", "interpolate", "interpolateColors", "spring", "measureSpring", "useCurrentFrame", "useVideoConfig", "random", "Easing"] as const;
export const BARE_ALLOWED = ["remotion", "react", "react/jsx-runtime"] as const;

/** Names that reach the network, the disk, the clock, the page or arbitrary code. */
const BANNED_NAMES: Record<string, string> = {
  fetch: "network",
  XMLHttpRequest: "network",
  WebSocket: "network",
  EventSource: "network",
  navigator: "network",
  Image: "loads a file",
  Audio: "loads a file",
  Worker: "arbitrary code",
  SharedWorker: "arbitrary code",
  importScripts: "arbitrary code",
  eval: "arbitrary code",
  Function: "arbitrary code",
  require: "modules",
  module: "modules",
  exports: "modules",
  process: "the host",
  Buffer: "the host",
  __dirname: "the filesystem",
  __filename: "the filesystem",
  window: "the page",
  document: "the page",
  globalThis: "the page",
  self: "the page",
  top: "the page",
  parent: "the page",
  localStorage: "storage",
  sessionStorage: "storage",
  indexedDB: "storage",
  setTimeout: "wall-clock time (a frame must depend only on its number)",
  setInterval: "wall-clock time (a frame must depend only on its number)",
  requestAnimationFrame: "wall-clock time (a frame must depend only on its number)",
  Date: "wall-clock time (a frame must depend only on its number)",
  performance: "wall-clock time (a frame must depend only on its number)",
};
const BANNED_TAGS = ["img", "image", "video", "audio", "iframe", "script", "link", "object", "embed", "foreignObject", "canvas"];

export type LintResult = { ok: boolean; imports: string[]; errors: string[]; warnings: string[] };

type Node = { type: string; start: number; [k: string]: unknown };

/** The path of a relative specifier from a staged file, as a path under remotion/src ("../kit" → "custom/kit"). */
function underSrc(spec: string): string | undefined {
  const parts = [...STAGED_FROM.split("/")];
  for (const seg of spec.replace(/\.(tsx?|jsx?)$/, "").split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

function checkSpecifier(spec: string): string | undefined {
  if (spec.startsWith(".")) {
    const target = underSrc(spec);
    if (target && ((ALLOWED_MODULES as readonly string[]).includes(target) || ALLOWED_PREFIXES.some((p) => target.startsWith(p) && !target.includes("..")))) return undefined;
    return `import "${spec}" is outside the library: a shot may import "../kit", the theme, rig/ and library/ modules`;
  }
  if ((BARE_ALLOWED as readonly string[]).includes(spec)) return undefined;
  return `import "${spec}" is not allowed: a shot may import only remotion, react and the library (../kit)`;
}

export function lintShot(source: string): LintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const imports: string[] = [];
  const lineOf = (needle: RegExp) => {
    const i = source.split("\n").findIndex((l) => needle.test(l));
    return i < 0 ? "" : ` (line ${i + 1})`;
  };

  let js: string;
  try {
    js = transformSync(source, { loader: "tsx", format: "esm", jsx: "automatic", target: "es2022", sourcefile: "shot.tsx", logLevel: "silent", tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } } }).code;
  } catch (e) {
    const first = (e as { errors?: { text: string; location?: { line: number } | null }[] }).errors?.[0];
    return { ok: false, imports, errors: [`the file does not parse: ${first ? `${first.text}${first.location ? ` (line ${first.location.line})` : ""}` : (e as Error).message}`], warnings };
  }
  let ast: Node;
  try {
    ast = parse(js, { ecmaVersion: "latest", sourceType: "module" }) as unknown as Node;
  } catch (e) {
    return { ok: false, imports, errors: [`the file does not parse: ${(e as Error).message}`], warnings };
  }

  let hasDefault = false;
  let readsTiming = false;
  const seen = new Set<string>();
  const complain = (message: string) => {
    if (!seen.has(message)) errors.push(message);
    seen.add(message);
  };

  const importOf = (node: Node) => {
    const spec = (node.source as { value?: unknown } | null)?.value;
    if (typeof spec !== "string") return;
    imports.push(spec);
    const bad = checkSpecifier(spec);
    if (bad) complain(bad + lineOf(new RegExp(`["']${spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`)));
    if (spec === "remotion") {
      if (node.type === "ExportAllDeclaration") complain('"export * from remotion" is not allowed');
      for (const s of (node.specifiers as { type: string; imported?: { name?: string; value?: string }; local: { name: string } }[]) ?? []) {
        if (s.type !== "ImportSpecifier") complain('import { named } from "remotion": namespace and default imports are not allowed');
        else {
          const name = s.imported?.name ?? s.imported?.value ?? "";
          if (!(REMOTION_ALLOWED as readonly string[]).includes(name)) complain(`remotion's "${name}" is not allowed (it can load files or the network); allowed: ${REMOTION_ALLOWED.join(", ")}`);
        }
      }
    }
  };

  // a name the shot declares itself (`const top = 40`, a parameter called `self`) is its own, not the browser's
  const declared = new Set<string>();
  const bind = (p: unknown): void => {
    const n = p as Node | null;
    if (!n) return;
    if (n.type === "Identifier") declared.add(String(n.name));
    else if (n.type === "ObjectPattern") (n.properties as Node[]).forEach((x) => bind(x.type === "Property" ? x.value : x));
    else if (n.type === "ArrayPattern") (n.elements as Node[]).forEach(bind);
    else if (n.type === "RestElement") bind(n.argument);
    else if (n.type === "AssignmentPattern") bind(n.left);
  };
  const collect = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(collect);
    const n = node as Node;
    if (n.type === "VariableDeclarator") bind(n.id);
    if (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") {
      (n.params as Node[]).forEach(bind);
      if (n.id) bind(n.id);
    }
    if (n.type === "ClassDeclaration" && n.id) bind(n.id);
    if (n.type === "CatchClause") bind(n.param);
    for (const [k, v] of Object.entries(n)) if (k !== "type" && k !== "start" && k !== "end") collect(v);
  };
  collect(ast);

  const walk = (node: unknown, parent?: Node, key?: string): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((n) => walk(n, parent, key));
    const n = node as Node;
    switch (n.type) {
      case "ImportDeclaration":
      case "ExportAllDeclaration":
        importOf(n);
        break;
      case "ExportNamedDeclaration":
        if (n.source) importOf(n);
        if ((n.specifiers as { exported?: { name?: string } }[] | undefined)?.some((x) => x.exported?.name === "default")) hasDefault = true;
        break;
      case "ExportDefaultDeclaration":
        hasDefault = true;
        break;
      case "ImportExpression":
        complain("dynamic import() is not allowed");
        break;
      case "Identifier": {
        const name = String(n.name);
        const isProp = parent && ((parent.type === "MemberExpression" && key === "property" && !parent.computed) || (parent.type === "Property" && key === "key" && !parent.computed) || (parent.type === "MethodDefinition" && key === "key") || (parent.type === "PropertyDefinition" && key === "key"));
        if (!isProp && name in BANNED_NAMES && !declared.has(name)) complain(`"${name}" is not allowed: ${BANNED_NAMES[name]}${lineOf(new RegExp(`\\b${name}\\b`))}`);
        if (name === "words" || name === "lines" || name === "wordFrame" || name === "useShot") readsTiming = true;
        break;
      }
      case "MemberExpression":
        if (!n.computed && (n.object as Node).type === "Identifier" && (n.object as { name: string }).name === "Math" && (n.property as { name: string }).name === "random") {
          complain(`Math.random() is not allowed: a frame must be the same every time it is drawn; use random("seed") from remotion${lineOf(/Math\.random/)}`);
        }
        break;
      case "Literal":
      case "TemplateElement": {
        const text = n.type === "Literal" ? (typeof n.value === "string" ? n.value : "") : String((n.value as { cooked?: string }).cooked ?? "");
        const url = text.replace(/https?:\/\/www\.w3\.org\//g, "").match(/(?:^|[^a-z])(https?:|file:|data:|blob:|ftp:)\/?\/?|:\/\//i);
        if (url) complain(`a URL or data string is not allowed ("${text.slice(0, 40)}"): a shot draws only what it computes${lineOf(/:\/\/|data:|file:/)}`);
        if (/url\(\s*(?!['"]?#)/.test(text)) complain(`css url() to a file is not allowed ("${text.slice(0, 40)}")`);
        if (/dangerouslySetInnerHTML/.test(text)) complain("dangerouslySetInnerHTML is not allowed");
        // JSX runtime calls carry the tag as a string
        break;
      }
      case "CallExpression": {
        const callee = n.callee as Node;
        const args = n.arguments as Node[];
        const name = callee.type === "Identifier" ? String(callee.name) : "";
        if (/^_?jsxs?$|^_?jsxDEV$/.test(name) && args[0]?.type === "Literal" && BANNED_TAGS.includes(String(args[0].value))) {
          complain(`<${String(args[0].value)}> is not allowed: it loads a file or embeds a page${lineOf(new RegExp(`<${String(args[0].value)}\\b`))}`);
        }
        break;
      }
    }
    for (const [k, v] of Object.entries(n)) if (k !== "type" && k !== "start" && k !== "end") walk(v, n, k);
  };
  walk(ast);

  if (!hasDefault) errors.push("the file has no default export: `export default function Shot(props: ShotProps) { … }`");
  if (!readsTiming) warnings.push("the shot never reads `words`, `lines` or `wordFrame`: it ignores the narration's word timing");
  return { ok: errors.length === 0, imports: [...new Set(imports)], errors, warnings };
}
