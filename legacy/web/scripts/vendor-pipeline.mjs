// Copies the pipeline's web API into the Python function's bundle.
//
// api/pipeline.py runs pipeline/webapi.py itself, so the web app and the worker
// can never disagree about what a valid research.md or script.md is. Vercel
// bundles only this directory, and a symlink to ../pipeline arrives dangling,
// so they are copied in before the build. pyshared/ is a build
// artifact (gitignored); pipeline/docs.py stays the only source.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(web, "..", "pipeline");
const dest = join(web, "pyshared", "pipeline");

rmSync(join(web, "pyshared"), { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
// webapi.py and what it imports: docs (validators), writer (prompts),
// publish (what YouTube is told, and its limits), timeline and config
// (hashing). All stdlib + PyYAML.
for (const f of ["__init__.py", "webapi.py", "docs.py", "writer.py", "publish.py", "timeline.py", "config.py"]) {
  cpSync(join(src, f), join(dest, f));
}
console.log(`vendored the pipeline's web API from ${src} -> pyshared/pipeline`);
