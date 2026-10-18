// Runs submissions on a Piston API instance (self-hosted in docker-compose.yml).
// Docs: https://github.com/engineer-man/piston

const PISTON_URL = () => process.env.PISTON_URL || 'http://localhost:2000';

// Our language id -> Piston language name and main file name.
export const LANGUAGES = {
  python: { piston: 'python', file: 'main.py', label: 'Python' },
  javascript: { piston: 'javascript', file: 'main.js', label: 'JavaScript' },
  cpp: { piston: 'c++', file: 'main.cpp', label: 'C++' },
  java: { piston: 'java', file: 'Main.java', label: 'Java' },
};

// Piston package names that provide the languages above.
const PACKAGES = ['python', 'node', 'gcc', 'java'];

const norm = (s) => String(s ?? '').replace(/\r\n/g, '\n').split('\n').map((line) => line.trimEnd()).join('\n').trim();
const tail = (s, n = 600) => String(s ?? '').slice(-n);

async function piston(path, body, timeoutMs = 30000) {
  const res = await fetch(PISTON_URL() + path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Piston responded ${res.status}`);
  return data;
}

export function verdict(out, expected) {
  if (out.compile && out.compile.code !== 0) {
    return { ok: false, error: 'Compilation error', detail: tail(out.compile.stderr || out.compile.output) };
  }
  const run = out.run ?? {};
  if (run.status === 'TO' || (run.signal === 'SIGKILL' && !['OL', 'EL'].includes(run.status))) {
    return { ok: false, error: 'Time limit exceeded' };
  }
  if (run.status === 'OL' || run.status === 'EL') return { ok: false, error: 'Output limit exceeded' };
  if (run.code !== 0) return { ok: false, error: 'Runtime error', detail: tail(run.stderr), got: tail(run.stdout) };
  const got = norm(run.stdout);
  return got === norm(expected) ? { ok: true, got } : { ok: false, error: 'Wrong answer', got: tail(got) };
}

// Throws if the runner itself is unreachable, so callers can refuse to score instead of scoring 0.
export async function runCode(language, code, tests) {
  const lang = LANGUAGES[language];
  if (!lang) throw new Error(`Unsupported language: ${language}`);
  const results = await Promise.all(tests.map(async (test) => {
    const out = await piston('/api/v2/execute', {
      language: lang.piston,
      version: '*',
      files: [{ name: lang.file, content: code }],
      stdin: test.input.endsWith('\n') ? test.input : test.input + '\n',
      run_timeout: 3000,
      compile_timeout: 10000,
    });
    return verdict(out, test.output);
  }));
  return { passed: results.filter((r) => r.ok).length, total: tests.length, results };
}

export async function runnerStatus() {
  try {
    const runtimes = await piston('/api/v2/runtimes', undefined, 5000);
    return { online: true, languages: [...new Set(runtimes.map((r) => r.language))] };
  } catch {
    return { online: false, languages: [] };
  }
}

const newer = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
};

// Installs any missing language package. Retries while Piston boots.
export async function ensureRuntimes({ attempts = 40, delayMs = 3000 } = {}) {
  let packages;
  for (let i = 0; i < attempts && !packages; i++) {
    packages = await piston('/api/v2/packages', undefined, 10000).catch(() => null);
    if (!packages) await new Promise((r) => setTimeout(r, delayMs));
  }
  if (!packages) return console.warn(`Code runner not reachable at ${PISTON_URL()}. Coding rounds will return 503 until it is up.`);
  for (const name of PACKAGES) {
    const versions = packages.filter((p) => p.language === name);
    if (!versions.length || versions.some((p) => p.installed)) continue;
    const latest = versions.map((p) => p.language_version).reduce((a, b) => (newer(b, a) ? b : a));
    console.log(`Installing ${name} ${latest} in Piston (first boot only, can take a few minutes)...`);
    await piston('/api/v2/packages', { language: name, version: latest }, 15 * 60000)
      .then(() => console.log(`Installed ${name} ${latest}`))
      .catch((err) => console.warn(`Could not install ${name}: ${err.message}`));
  }
}
